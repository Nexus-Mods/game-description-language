import type { IExtensionContext, IGame, TestSupportedFn, InstallFn, ActionVisibilityFn, ActionRunFn } from 'vortex-api';
import type { DiscoveryFacts, ResolvedContext, ResolvableValue } from './context-resolver.js';
import { resolveContext, type ContextSpec } from './context-resolver.js';
import { interpolate } from './interpolate.js';
import { resolveBranch } from './branch-tags.js';
import type { InstallerRule } from './installer-engine.js';
import { buildInstallPlan } from './installer-engine.js';
import { evalPredicateExpr } from './predicate.js';

export interface GameDecl {
  id: string;
  name: string;
  executable: string;
  requiredFiles: string[];
  logo?: string;
  contributedBy?: string;
  nexusDomain?: string;
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
  private discoveredStore: string | undefined;

  constructor(private readonly api: IExtensionContext) {}

  setDiscoveredStore(store: string | undefined): void {
    this.discoveredStore = store;
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
      ...(decl.contributedBy !== undefined && { contributed: decl.contributedBy }),
      ...(decl.nexusDomain   !== undefined && { details:     { nexusPageId: decl.nexusDomain } }),
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
        this.resolvedCtx = resolveContext(contextSpec, facts);
        return facts.installPath;
      },
      queryModPath: () => '.',
    };
    if (setupDirs.length > 0) {
      game.setup = async () => {
        const { util } = await import('vortex-api');
        const ctx = this.resolvedCtx ?? {};
        for (const tpl of setupDirs) {
          const path = interpolate(tpl, ctx);
          await util.fs.ensureDirWritableAsync(path);
        }
      };
    }
    this.api.registerGame(game);

    for (const mt of modTypes) {
      this.api.registerModType(
        mt.id,
        50,
        (gameId) => gameId === decl.id,
        (game) => {
          const gamePath = (game as { gamePath?: string } | null)?.gamePath;
          const ctx = {
            ...this.resolvedCtx ?? {},
            ...(gamePath !== undefined && { installPath: gamePath }),
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
      this.api.api.events.on('did-deploy', (...args: unknown[]) => {
        const [profileId, deployment] = args as [string, unknown];
        void userHook({ profileId, deployment, api: this.api.api });
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
      const ctx = {
        archivePaths: files,
        vars: this.resolvedCtx ?? {},
      };
      return { supported: evalPredicateExpr(rule.when, ctx) };
    };

    const install: InstallFn = async (files, _destinationPath, gid) => {
      const ctx = {
        archivePaths: files,
        vars: this.resolvedCtx ?? {},
      };
      if (gid !== gameId) return { instructions: [] };
      const plan = buildInstallPlan(rule, files, ctx);
      const instructions = plan.flatMap(p => [
        { type: 'copy' as const, source: p.source, destination: p.destination },
        { type: 'setmodtype' as const, value: p.modType },
      ]);
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
  }

  private async discover(stores: StoreDecl[]): Promise<DiscoveryFacts | null> {
    const appIds = stores.map(s => String(s.value));
    if (appIds.length === 0) return null;
    const { util, log } = await import('vortex-api');
    try {
      log('info', '[gdl] discover: calling findByAppId', { appIds, hasGSH: !!util.GameStoreHelper });
      const found = await util.GameStoreHelper.findByAppId(appIds);
      log('info', '[gdl] discover: findByAppId returned', { found: JSON.stringify(found) });
      if (!found) return null;
      this.discoveredStore = found.gameStoreId;
      return {
        store: found.gameStoreId,
        os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
        installPath: found.gamePath,
        executablePath: found.gamePath,   // refined by Vortex later via game.executable()
      };
    } catch (err: unknown) {
      const { log: vlog } = await import('vortex-api');
      vlog('error', '[gdl] discover: findByAppId threw', { error: String(err), stack: (err as Error)?.stack });
      return null;
    }
  }
}
