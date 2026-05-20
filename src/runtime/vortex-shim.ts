import type { IExtensionContext, IGame } from 'vortex-api';
import type { DiscoveryFacts, ResolvedContext, ResolvableValue } from './context-resolver.js';
import { resolveContext, type ContextSpec } from './context-resolver.js';
import { interpolate } from './interpolate.js';
import { resolveBranch } from './branch-tags.js';

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

  registerGame(decl: GameDecl, stores: StoreDecl[], contextSpec: ContextSpec, modTypes: ModTypeDecl[]) {
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
    // Plan 1 stub: trust Vortex's own game-store helpers indirectly through
    // queryPath's caller. For MVP we just return null when no install is found.
    // A later plan will plug stores in to GameStoreHelper.
    void stores;
    return null;
  }
}
