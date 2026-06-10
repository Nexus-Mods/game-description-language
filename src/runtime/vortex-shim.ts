import type { IExtensionContext, IGame, TestSupportedFn, InstallFn, ActionVisibilityFn, ActionRunFn } from 'vortex-api';
import type { DiscoveryFacts, ResolvedContext, ResolvableValue } from './context-resolver.js';
import { resolveContext, type ContextSpec } from './context-resolver.js';

// Vortex's IDiscoveryResult isn't re-exported from the package, but its shape
// is stable. We only consume the two fields we need.
interface IDiscoveryResult {
  path?: string;
  store?: string;
}
import { interpolate } from './interpolate.js';
import { resolveBranch } from './branch-tags.js';
import type { InstallerRule } from './installer-engine.js';
import { buildInstallPlan, ruleSupports } from './installer-engine.js';

const normaliseArchivePath = (path: string): string => path.replace(/\\/g, '/');

export interface GameDecl {
  id: string;
  name: string;
  executable: string;
  requiredFiles: string[];
  logo?: string;
  nexusDomain?: string;
  details?: Record<string, unknown>;
  // Template like `${pakModsPath}` resolved against the runtime context to
  // produce the "default mods folder" Vortex uses for the "Open Game Mods
  // folder" action and as the install destination when no modtype matches.
  // Omitted -> fall back to Vortex's relative-`.` default (== the game root).
  queryModPath?: string;
}

export interface ModTypeDecl {
  id: string;
  name: string;
  path: ResolvableValue;
}

export interface StoreDecl {
  id: string;
  value: string | number;
}

export interface ToolbarActionDecl {
  id: string;
  title: string;
  priority: number;
  target:
    | { kind: 'openFile'; template: string }
    | { kind: 'openUrl';  template: string };
}

export type DidDeployHook = (ctx: {
  profileId: string;
  deployment: unknown;
  api: unknown;
}) => Promise<void>;

export interface EventHooks {
  didDeploy?: DidDeployHook;
}

export class GdlRuntime {
  private resolvedCtx?: ResolvedContext;
  private cachedFacts?: DiscoveryFacts;
  private discoveredStore: string | undefined;

  constructor(private readonly api: IExtensionContext) {}

  setDiscoveredStore(store: string | undefined): void {
    this.discoveredStore = store;
  }

  // Build DiscoveryFacts from a Vortex IDiscoveryResult.
  //
  // Vortex passes a discovery to setup/getGameVersion that already contains the
  // installPath and store id — every concrete path the extension cares about
  // can be resolved from that. We must NOT fall back to GameStoreHelper here:
  // Vortex's own discovery includes sideloaded games and user-edited paths that
  // findByAppId can't see, and silently falling back was the root cause of
  // Nexus bug 1086633 ("unbound variable `pakModsPath`").
  private factsFromDiscovery(discovery: IDiscoveryResult): DiscoveryFacts {
    const os = process.platform === 'win32' ? 'windows' as const
             : process.platform === 'darwin' ? 'macos' as const
             : 'linux' as const;
    const facts: DiscoveryFacts = {
      store: discovery.store ?? '',
      os,
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      installPath: discovery.path ?? '',
      executablePath: discovery.path ?? '',
    };
    if (os === 'windows') {
      // Mirror the Windows-only AppData paths populated by discover(); kept in
      // sync there so both code paths produce the same facts shape.
      const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
      facts.appDataLocal    = process.env.LOCALAPPDATA ?? `${home}/AppData/Local`;
      facts.appDataLocalLow = `${facts.appDataLocal}/../LocalLow`;
      facts.appDataRoaming  = process.env.APPDATA ?? `${home}/AppData/Roaming`;
    }
    return facts;
  }

  registerGame(
    decl: GameDecl,
    stores: StoreDecl[],
    contextSpec: ContextSpec,
    modTypes: ModTypeDecl[],
    installers: InstallerRule[] = [],
    discovery: { versionHook?: (ctx: DiscoveryFacts) => Promise<string | null> } = {},
    toolbarActions: ToolbarActionDecl[] = [],
    setupDirs: string[] = [],
    eventHooks: EventHooks = {},
  ) {
    const game: IGame = {
      id: decl.id,
      name: decl.name,
      executable: () => decl.executable,
      requiredFiles: decl.requiredFiles,
      ...(decl.logo          !== undefined && { logo:        decl.logo }),
      details: {
        ...(decl.nexusDomain !== undefined && { nexusPageId: decl.nexusDomain }),
        ...decl.details,
      },
      queryPath: async () => {
        const facts = await this.discover(stores);
        if (!facts) return '';
        if (discovery.versionHook) {
          try {
            const v = await discovery.versionHook(facts);
            if (v) (facts as { version?: string }).version = v;
          } catch {
            // Version detection failure is non-fatal — resolver omits `version`
            // from the resolved context, and `versionBranch:` falls through to default.
          }
        }
        this.cachedFacts = facts;
        this.resolvedCtx = resolveContext(contextSpec, facts);
        return facts.installPath;
      },
      mergeMods: true,
      queryModPath: (gamePath: string) => {
        // Without a configured template, fall back to '.' (Vortex resolves
        // that against gamePath — same as a no-op).
        if (!decl.queryModPath) return '.';
        try {
          // Prefer the live gamePath Vortex hands us; fall back to whatever
          // discovery already populated. This makes the action work even if
          // setup() hasn't run yet (Vortex calls queryModPath at various
          // points in its lifecycle).
          const ctx = {
            ...this.resolvedCtx ?? {},
            ...(gamePath !== undefined && gamePath !== '' && { installPath: gamePath }),
          };
          return interpolate(decl.queryModPath, ctx as ResolvedContext);
        } catch {
          // Template references vars not yet bound. Return '.' rather than
          // crashing — Vortex will fall back to gamePath, same as old default.
          return '.';
        }
      },
    };
    if (discovery.versionHook) {
      const versionHook = discovery.versionHook;
      game.getGameVersion = async (_gamePath: string) => {
        const facts = this.cachedFacts ?? await this.discover(stores);
        if (!facts) return '0.0.0';
        return await versionHook(facts) ?? '0.0.0';
      };
    }
    if (setupDirs.length > 0) {
      game.setup = async (discovery: IDiscoveryResult) => {
        const { fs } = await import('vortex-api');
        // Vortex's discovery is the authoritative source for installPath at
        // setup time; trust it over our cached/store-helper view so manual and
        // sideloaded installs resolve correctly. We still cache for later
        // installer/modtype calls.
        const facts = this.factsFromDiscovery(discovery);
        this.cachedFacts = facts;
        this.resolvedCtx = resolveContext(contextSpec, facts);
        if (discovery.store) this.discoveredStore = discovery.store;
        for (const tpl of setupDirs) {
          const path = interpolate(tpl, this.resolvedCtx);
          await fs.ensureDirWritableAsync(path);
        }
      };
    }
    this.api.registerGame(game);

    for (const mt of modTypes) {
      this.api.registerModType(
        mt.id,
        50,
        (gameId) => gameId === decl.id,
        () => {
          const { selectors } = require('vortex-api') as typeof import('vortex-api');
          const state = this.api.api.getState();
          const discovery = selectors.discoveryByGame(state, decl.id);
          const ctx = {
            ...this.resolvedCtx ?? {},
            ...(discovery?.path !== undefined && { installPath: discovery.path }),
          };
          return this.resolveModTypePath(mt, ctx as ResolvedContext);
        },
        async () => true,
        { name: mt.name },
      );
    }

    for (const inst of installers) {
      this.registerInstallerRule(decl.id, inst);
    }

    for (const action of toolbarActions) {
      this.registerToolbarAction(decl.id, action);
    }

    if (eventHooks.didDeploy) {
      const userHook = eventHooks.didDeploy;
      // Per IExtensionContext docs, `api` is only fully initialised once the
      // `once()` callback fires — accessing `api.events` synchronously here
      // throws "Cannot read properties of undefined (reading 'on')" on some
      // Vortex builds (GH issue #6 against game-subnautica2 1.1.0).
      this.api.once(() => {
        this.api.api.events.on('did-deploy', (...args: unknown[]) => {
          const [profileId, deployment] = args as [string, unknown];
          void userHook({ profileId, deployment, api: this.api.api });
        });
      });
    }
  }

  private registerInstallerRule(gameId: string, rule: InstallerRule): void {
    const testSupported: TestSupportedFn = async (files, gid) => {
      if (gid !== gameId) return { supported: false };
      if (rule.scope?.stores && rule.scope.stores.length > 0) {
        if (!this.discoveredStore || !rule.scope.stores.includes(this.discoveredStore)) {
          return { supported: false };
        }
      }
      const normalisedFiles = files.map(normaliseArchivePath);
      const ctx = {
        archivePaths: normalisedFiles,
        vars: this.resolvedCtx ?? {},
      };
      // Honor `unless` here too: otherwise a higher-priority rule whose `when`
      // matches but whose `unless` excludes the archive would claim support and
      // then build an empty plan, which Vortex reports as a canceled install.
      return { supported: ruleSupports(rule, ctx) };
    };

    const install: InstallFn = async (files, _destinationPath, gid) => {
      const normalisedFiles = files.map(normaliseArchivePath);
      const ctx = {
        archivePaths: normalisedFiles,
        vars: this.resolvedCtx ?? {},
      };
      if (gid !== gameId) return { instructions: [] };
      const rawByNormalised = new Map(files.map(file => [normaliseArchivePath(file), file]));
      const plan = buildInstallPlan(rule, normalisedFiles, ctx);
      const instructions = plan.flatMap(p => {
        const dest = p.relative;
        if (/^[a-zA-Z]:/.test(dest) || dest.startsWith('/')) {
          // eslint-disable-next-line no-console
          console.error(
            `[gdl] BUG: installer "${rule.id}" produced absolute destination "${dest}" — ` +
            'Vortex copy destinations must be relative. This is a GDL bug.',
          );
        }
        return [
          { type: 'copy' as const, source: rawByNormalised.get(p.source) ?? p.source, destination: dest },
          { type: 'setmodtype' as const, value: p.modType },
        ];
      });
      return { instructions };
    };

    this.api.registerInstaller(rule.id, rule.priority, testSupported, install);
  }

  // Test-only seam.
  registerInstallerRulePublic(gameId: string, rule: InstallerRule): void {
    this.registerInstallerRule(gameId, rule);
  }

  // Test-only seam.
  setResolvedCtxForTesting(ctx: Record<string, string>): void {
    this.resolvedCtx = ctx;
  }

  // Test-only seam: register a single mod type with a plain string template.
  registerModTypePublic(id: string, name: string, pathTemplate: string): void {
    this.api.registerModType(
      id,
      100,
      () => true,
      (game) => {
        const gamePath = (game as { gamePath?: string } | null)?.gamePath;
        const ctx = {
          ...this.resolvedCtx ?? {},
          ...(gamePath !== undefined && { installPath: gamePath }),
        };
        return interpolate(pathTemplate, ctx);
      },
      async () => true,
      { name },
    );
  }

  private registerToolbarAction(gameId: string, action: ToolbarActionDecl): void {
    const isThisGameActive: ActionVisibilityFn = () => {
      try {
        // Late import to keep this code path inert when vortex-api isn't on disk (e.g., unit tests).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { selectors } = require('vortex-api') as typeof import('vortex-api');
        const state = this.api.api.getState();
        return selectors.activeGameId(state) === gameId;
      } catch {
        // If something goes wrong reading state, fail open (show the action).
        return true;
      }
    };

    const run: ActionRunFn = () => {
      try {
        const ctx = this.resolvedCtx ?? {};
        const target = interpolate(action.target.template, ctx);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { util } = require('vortex-api') as typeof import('vortex-api');
        void util.opn(target);
      } catch (err) {
        // Don't crash Vortex over a misbehaving toolbar action.
        // eslint-disable-next-line no-console
        console.error(`gdl toolbar action ${action.id} failed:`, err);
      }
    };

    this.api.registerAction(
      'mod-icons',
      action.priority,
      'open-ext',
      {},
      action.title,
      run,
      isThisGameActive,
    );
  }

  private resolveModTypePath(mt: ModTypeDecl, ctx: ResolvedContext = this.resolvedCtx ?? {}): string {
    try {
      if (mt.path.kind === 'literal') return String(mt.path.raw);
      if (mt.path.kind === 'interpolated') {
        return interpolate(mt.path.template, ctx);
      }
      // Branch value: dispatch then recursively resolve the chosen arm against ctx.
      const arm = resolveBranch(mt.path, ctx as Record<string, string>) as ResolvableValue;
      if (arm.kind === 'literal') return String(arm.raw);
      if (arm.kind === 'interpolated') return interpolate(arm.template, ctx);
      // Nested branches are uncommon for modType paths but supported for symmetry.
      return String(resolveBranch(arm, ctx as Record<string, string>));
    } catch {
      // Context not yet resolved (getPath called before discovery); return empty.
      return '';
    }
  }

  private async discover(stores: StoreDecl[]): Promise<DiscoveryFacts | null> {
    const appIds = stores.map(s => String(s.value));
    if (appIds.length === 0) return null;
    const { util } = await import('vortex-api');
    try {
      const found = await util.GameStoreHelper.findByAppId(appIds);
      if (!found) return null;
      this.discoveredStore = found.gameStoreId;
      const os = process.platform === 'win32' ? 'windows' as const
               : process.platform === 'darwin' ? 'macos' as const
               : 'linux' as const;

      // Compute platform-specific AppData paths (Windows only for now).
      let appDataLocal: string | undefined;
      let appDataLocalLow: string | undefined;
      let appDataRoaming: string | undefined;
      if (os === 'windows') {
        const { homedir } = await import('node:os');
        const { join, resolve } = await import('node:path');
        const home = homedir();
        appDataLocal    = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
        appDataLocalLow = resolve(appDataLocal, '..', 'LocalLow');
        appDataRoaming  = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      }

      return {
        store: found.gameStoreId,
        os,
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
        installPath: found.gamePath,
        executablePath: found.gamePath,   // refined by Vortex later via game.executable()
        ...(appDataLocal    !== undefined && { appDataLocal }),
        ...(appDataLocalLow !== undefined && { appDataLocalLow }),
        ...(appDataRoaming  !== undefined && { appDataRoaming }),
      };
    } catch {
      return null;
    }
  }
}
