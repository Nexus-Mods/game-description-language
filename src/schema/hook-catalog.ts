// Each entry declares the hook id and the exact TS signature the user's src/hooks.ts must export.
export interface HookCatalogEntry {
  id: string;
  // Human-readable expected signature for error messages.
  expectedSignature: string;
  // Names of the parameter types and return type — used for structural matching by hook-resolver.
  parameterTypes: string[];
  returnType: string;
}

export const HOOK_CATALOG: HookCatalogEntry[] = [
  {
    id: 'detectGameVersion',
    expectedSignature: '(ctx: GameContext) => Promise<string | null>',
    parameterTypes: ['GameContext'],
    returnType: 'Promise<string | null>',
  },
];

export const findHook = (id: string): HookCatalogEntry | undefined =>
  HOOK_CATALOG.find(h => h.id === id);
