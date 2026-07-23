import type { IExtensionContext, IGame, TestSupportedFn, InstallFn, ActionVisibilityFn, ActionRunFn, IModHealthCheck } from 'vortex-api';
import type { DiscoveryFacts, ResolvedContext, ResolvableValue } from './context-resolver.js';
import { resolveContext, windowsAppDataFacts, type ContextSpec } from './context-resolver.js';

// Vortex's IDiscoveryResult isn't re-exported from the package, but its shape
// is stable. We only consume the two fields we need. The appData* fields are
// NOT part of the real Vortex result — they exist only so the test harness can
// inject deterministic sentinels; in production these are always undefined and
// factsFromDiscovery derives them from the environment.
interface IDiscoveryResult {
  path?: string;
  store?: string;
  appDataLocal?: string;
  appDataLocalLow?: string;
  appDataRoaming?: string;
}
import { interpolate } from './interpolate.js';
import { resolveBranch } from './branch-tags.js';
import type { InstallerRule } from './installer-engine.js';
import { buildInstallPlan, ruleSupports } from './installer-engine.js';

const normaliseArchivePath = (path: string): string => path.replace(/\\/g, '/');

// `stores:` is the single source of truth for store ids. Project each one into
// `game.details` under a conventional `<storeId>AppId` key so authors don't repeat
// it under `game.details`. Only `steamAppId` is read by Vortex today (Steam launch
// in util/Steam.ts + the gameinfo-steam panel); the rest are inert metadata kept in
// case they're needed. Numeric ids (steam, gog) become numbers — matching the
// `steamAppId: number` convention Vortex expects — while GUID/identity-name ids
// (epic, xbox) stay strings. `manual` is not a real store id, so it gets no key.
// Explicit `game.details` entries still override these (see registerGame).
const STORES_WITHOUT_DETAIL_KEY = new Set(['manual']);

function deriveStoreDetails(stores: StoreDecl[]): Record<string, string | number> {
  const details: Record<string, string | number> = {};
  for (const { id, value } of stores) {
    if (STORES_WITHOUT_DETAIL_KEY.has(id)) continue;
    const str = String(value);
    details[`${id}AppId`] = /^\d+$/.test(str) ? Number(str) : str;
  }
  return details;
}

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
  // Captured at registerGame time so installer/modtype callbacks can lazily
  // resolve context from Vortex's live discovery — even when the game has no
  // `setup:` block (setup() is the only place that eagerly populates
  // resolvedCtx). See ensureResolvedCtx().
  private contextSpec?: ContextSpec;
  private gameId?: string;
  // Overridable Vortex live-discovery lookup; see liveDiscovery().
  private liveDiscoveryFn?: (gameId: string) => IDiscoveryResult | undefined;

  constructor(private readonly api: IExtensionContext) {}

  setDiscoveredStore(store: string | undefined): void {
    this.discoveredStore = store;
  }

  // Read Vortex's own discovery for a game. This is the authoritative source
  // (covers manual/sideloaded installs) and feeds ensureResolvedCtx() and the
  // modType getPath. Overridable via setLiveDiscoveryForTesting() so tests can
  // drive it without the CJS `require('vortex-api')` that vitest's ESM alias
  // doesn't intercept.
  private liveDiscovery(gameId: string): IDiscoveryResult | undefined {
    if (this.liveDiscoveryFn) return this.liveDiscoveryFn(gameId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { selectors } = require('vortex-api') as typeof import('vortex-api');
      return selectors.discoveryByGame(this.api.api.getState(), gameId);
    } catch {
      // vortex-api not resolvable (unit tests without the seam set). Callers
      // treat undefined as "not discovered yet".
      return undefined;
    }
  }

  // Return a resolved context for installer/modtype use. Prefer the context
  // eagerly built by setup()/queryPath(); if neither has run yet, resolve it
  // from Vortex's own discovery — the authoritative source that also covers
  // manual/sideloaded installs. Without this, a game with no `setup:` block
  // whose installers reference a custom `context:` binding (e.g. `${runtimeRoot}`)
  // threw "unbound variable" at install time because resolvedCtx was never
  // populated (the 007firstlight report).
  private ensureResolvedCtx(): ResolvedContext {
    if (this.resolvedCtx) return this.resolvedCtx;
    if (!this.contextSpec || !this.gameId) return {};
    try {
      const discovery = this.liveDiscovery(this.gameId);
      if (!discovery?.path) return {};
      const facts = this.factsFromDiscovery(discovery);
      this.cachedFacts = facts;
      if (discovery.store) this.discoveredStore = discovery.store;
      this.resolvedCtx = resolveContext(this.contextSpec, facts);
      return this.resolvedCtx;
    } catch {
      // Discovery not ready / resolution failed — fall back to whatever we
      // have. Installer interpolate() may still throw, but that is the
      // pre-existing behavior for a genuinely-undiscovered game.
      return this.resolvedCtx ?? {};
    }
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
      // AppData roots aren't in a real Vortex IDiscoveryResult, so derive them
      // from the environment via the shared helper (single source of truth with
      // discover() and the codegen test harness). A test may inject sentinels on
      // the discovery object to make generated assertions deterministic; honor
      // those over the environment when present.
      const env = windowsAppDataFacts();
      facts.appDataLocal    = discovery.appDataLocal    ?? env.appDataLocal;
      facts.appDataLocalLow = discovery.appDataLocalLow ?? env.appDataLocalLow;
      facts.appDataRoaming  = discovery.appDataRoaming  ?? env.appDataRoaming;
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
    diagnostics: IModHealthCheck[] = [],
  ) {
    // Captured for ensureResolvedCtx(), which lazily rebuilds the context from
    // live discovery when setup()/queryPath() haven't populated it.
    this.contextSpec = contextSpec;
    this.gameId = decl.id;
    // Mirror Vortex's environment.SteamAPPId auto-derivation: queryArgs.steam
    // would set it so the launched game sees the right app id. GDL discovers via
    // GameStoreHelper, so derive it from the declared steam store. The matching
    // details.steamAppId (and other store ids) come from deriveStoreDetails below.
    const steamId = stores.find(s => s.id === 'steam')?.value;
    const steamAppId = steamId !== undefined ? String(steamId) : undefined;

    const game: IGame = {
      id: decl.id,
      name: decl.name,
      executable: () => decl.executable,
      requiredFiles: decl.requiredFiles,
      ...(decl.logo          !== undefined && { logo:        decl.logo }),
      ...(steamAppId !== undefined && { environment: { SteamAPPId: steamAppId } }),
      details: {
        ...(decl.nexusDomain !== undefined && { nexusPageId: decl.nexusDomain }),
        ...deriveStoreDetails(stores),
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
          const discovery = this.liveDiscovery(decl.id);
          const ctx = {
            ...this.ensureResolvedCtx(),
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

    // Register runtime diagnostics as in-game health checks. Each entry is a
    // user-defined IModHealthCheck from src/hooks.ts, passed straight through.
    for (const check of diagnostics) {
      this.api.registerHealthCheck(check);
    }
  }

  private registerInstallerRule(gameId: string, rule: InstallerRule): void {
    const testSupported: TestSupportedFn = async (files, gid) => {
      if (gid !== gameId) return { supported: false };
      // Resolve context first: ensureResolvedCtx() also populates
      // discoveredStore from Vortex's live discovery, which the scope check
      // below depends on. A setup-less game whose store is known only via live
      // discovery would otherwise fail the scope gate before it was populated.
      const vars = this.ensureResolvedCtx();
      if (rule.scope?.stores && rule.scope.stores.length > 0) {
        if (!this.discoveredStore || !rule.scope.stores.includes(this.discoveredStore)) {
          return { supported: false };
        }
      }
      const normalisedFiles = files.map(normaliseArchivePath);
      const ctx = { archivePaths: normalisedFiles, vars };
      // A rule whose `placeAt` references a context var we can't resolve (e.g.
      // the game is genuinely undiscovered, so there is no installPath) must not
      // claim support — otherwise install() throws an unbound-variable error
      // into Vortex. Building the plan here surfaces that as "unsupported".
      // (installHook rules don't build a declarative plan, so they're exempt.)
      if (!rule.installHook && !this.rulePlanIsResolvable(rule, normalisedFiles, ctx)) {
        return { supported: false };
      }
      // Honor `unless` here too: otherwise a higher-priority rule whose `when`
      // matches but whose `unless` excludes the archive would claim support and
      // then build an empty plan, which Vortex reports as a canceled install.
      return { supported: ruleSupports(rule, ctx) };
    };

    const install: InstallFn = async (files, destinationPath, gid) => {
      if (gid !== gameId) return { instructions: [] };

      // Custom installer hook: the archive is already extracted under
      // destinationPath, so the hook reads files itself and returns raw Vortex
      // instructions (including attribute instructions the declarative engine
      // can't express). Pass the raw Vortex paths through unchanged.
      if (rule.installHook) {
        const result = await rule.installHook(files, destinationPath, gid);
        return { instructions: result.instructions as Awaited<ReturnType<InstallFn>>['instructions'] };
      }

      const normalisedFiles = files.map(normaliseArchivePath);
      const ctx = {
        archivePaths: normalisedFiles,
        vars: this.ensureResolvedCtx(),
      };
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

  // Whether a rule can actually build a plan for these files with the current
  // context — i.e. its `placeAt` templates resolve. Returns false (rather than
  // letting the error escape) when a referenced context var is unbound, which
  // happens for a genuinely-undiscovered game (no installPath). Used by
  // testSupported so such a rule declines support instead of crashing Vortex
  // from install().
  private rulePlanIsResolvable(
    rule: InstallerRule,
    normalisedFiles: string[],
    ctx: { archivePaths: string[]; vars: ResolvedContext },
  ): boolean {
    if (!ruleSupports(rule, ctx)) return true; // rule won't match; nothing to resolve
    try {
      buildInstallPlan(rule, normalisedFiles, ctx);
      return true;
    } catch {
      return false;
    }
  }

  // Test-only seam.
  registerInstallerRulePublic(gameId: string, rule: InstallerRule): void {
    this.registerInstallerRule(gameId, rule);
  }

  // Test-only seam.
  setResolvedCtxForTesting(ctx: Record<string, string>): void {
    this.resolvedCtx = ctx;
  }

  // Test-only seam: inject Vortex's live discovery lookup so lifecycle tests can
  // exercise ensureResolvedCtx()/modType getPath without the CJS
  // `require('vortex-api')` that vitest's ESM alias doesn't intercept.
  setLiveDiscoveryForTesting(fn: (gameId: string) => IDiscoveryResult | undefined): void {
    this.liveDiscoveryFn = fn;
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

      // Compute platform-specific AppData paths (Windows only for now) via the
      // shared helper — single source of truth with factsFromDiscovery and the
      // codegen test harness. homedir() is the fallback when %LOCALAPPDATA%/
      // %APPDATA% are unset, matching this path's historical behavior.
      let appDataLocal: string | undefined;
      let appDataLocalLow: string | undefined;
      let appDataRoaming: string | undefined;
      if (os === 'windows') {
        const { homedir } = await import('node:os');
        ({ appDataLocal, appDataLocalLow, appDataRoaming } = windowsAppDataFacts({
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          APPDATA: process.env.APPDATA,
          USERPROFILE: homedir(),
        }));
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
