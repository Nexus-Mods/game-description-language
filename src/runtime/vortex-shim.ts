import type { IExtensionContext, IGame, TestSupportedFn, InstallFn } from 'vortex-api';
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

export class GdlRuntime {
  private resolvedCtx?: ResolvedContext;

  constructor(private readonly api: IExtensionContext) {}

  registerGame(
    decl: GameDecl,
    stores: StoreDecl[],
    contextSpec: ContextSpec,
    modTypes: ModTypeDecl[],
    installers: InstallerRule[] = [],
    discovery: { versionHook?: (ctx: DiscoveryFacts) => Promise<string | null> } = {},
  ) {
    const game: IGame = {
      id: decl.id,
      name: decl.name,
      executable: () => decl.executable,
      requiredFiles: decl.requiredFiles,
      ...(decl.logo          !== undefined && { logo:        decl.logo }),
      ...(decl.contributedBy !== undefined && { contributed: decl.contributedBy }),
      queryPath: async () => {
        const facts = await this.discover(stores);
        if (!facts) return '';
        if (discovery.versionHook) {
          try {
            const v = await discovery.versionHook(facts);
            if (v) (facts as { version?: string }).version = v;
          } catch {
            // Version detection failure is non-fatal — resolver omits `version`
            // from the resolved context, and !versionBranch falls through to default.
          }
        }
        this.resolvedCtx = resolveContext(contextSpec, facts);
        return { path: facts.installPath, store: facts.store };
      },
      queryModPath: () => '.',
    };
    this.api.registerGame(game);

    for (const mt of modTypes) {
      this.api.registerModType(
        mt.id,
        50,
        (gameId) => gameId === decl.id,
        () => this.resolveModTypePath(mt),
        async () => true,
        { name: mt.name },
      );
    }

    for (const inst of installers) {
      this.registerInstallerRule(decl.id, inst);
    }
  }

  private registerInstallerRule(gameId: string, rule: InstallerRule): void {
    const testSupported: TestSupportedFn = async (files, gid) => {
      if (gid !== gameId) return { supported: false };
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

  private resolveModTypePath(mt: ModTypeDecl): string {
    if (!this.resolvedCtx) return '';
    if (mt.path.kind === 'literal') return String(mt.path.raw);
    if (mt.path.kind === 'interpolated') {
      return interpolate(mt.path.template, this.resolvedCtx);
    }
    // Branch value: dispatch then recursively resolve the chosen arm against ctx.
    const arm = resolveBranch(mt.path, this.resolvedCtx as Record<string, string>) as ResolvableValue;
    if (arm.kind === 'literal') return String(arm.raw);
    if (arm.kind === 'interpolated') return interpolate(arm.template, this.resolvedCtx);
    // Nested branches are uncommon for modType paths but supported for symmetry.
    return String(resolveBranch(arm, this.resolvedCtx as Record<string, string>));
  }

  private async discover(stores: StoreDecl[]): Promise<DiscoveryFacts | null> {
    const { GameStoreHelper } = await import('vortex-api');
    for (const s of stores) {
      const appId = String(s.value);
      try {
        const found = await GameStoreHelper.findByAppId(appId, s.id);
        if (found) {
          return {
            store: found.gameStoreId,
            os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
            arch: process.arch === 'arm64' ? 'arm64' : 'x64',
            installPath: found.gamePath,
            executablePath: found.gamePath,   // refined by Vortex later via game.executable()
          };
        }
      } catch {
        // Helper threw — try the next store.
      }
    }
    return null;
  }
}
