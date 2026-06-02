// Runtime mock for the `vortex-api` package. Pair this with the static type
// stub in `gdl/src/types/vortex-api.d.ts` so `await import('vortex-api')` and
// `require('vortex-api')` both resolve under vitest.
//
// Downstream extensions: alias `vortex-api` in vitest.config.ts to the path of
// this file (via the gdl submodule). One mock for both GDL's internal tests
// and every downstream game extension; everyone gets the same set of fakes
// without each repo reinventing them.
//
// Only includes the parts of vortex-api that GdlRuntime actually touches plus
// the few extras (selectors, util.getSafe) that hook authors commonly need.

import { vi } from 'vitest';

export const log = vi.fn();

export const fs = {
  ensureDirWritableAsync: vi.fn((_p: string) => Promise.resolve()),
  ensureDirAsync:         vi.fn((_p: string) => Promise.resolve()),
  statAsync:              vi.fn((_p: string) => Promise.resolve({ isDirectory: () => true })),
  readdirAsync:           vi.fn((_p: string) => Promise.resolve([] as string[])),
  readFileAsync:          vi.fn((_p: string, _opts?: unknown) => Promise.resolve('')),
  writeFileAsync:         vi.fn((_p: string, _content: string) => Promise.resolve()),
};

export const util = {
  GameStoreHelper: {
    findByAppId: vi.fn<
      (ids: string | string[]) => Promise<{ gamePath: string; gameStoreId: string } | null>
    >(),
  },
  opn: vi.fn((_url: string) => Promise.resolve()),
  // Lookup helper from Vortex's util — hook authors use this to walk redux
  // state without throwing on missing keys.
  getSafe: <T>(obj: unknown, path: readonly (string | number)[], fallback: T): T => {
    let cur: unknown = obj;
    for (const seg of path) {
      if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg as string];
      } else {
        return fallback;
      }
    }
    return cur as T;
  },
};

export const selectors = {
  activeGameId:    vi.fn<(state: unknown) => string | undefined>(),
  discoveryByGame: vi.fn<
    (state: unknown, gameId: string) => { path?: string; store?: string } | undefined
  >(),
};

// Empty namespaces so `import { actions, types } from 'vortex-api'` resolves;
// downstream code typically only uses these for type annotations.
export const actions = {};
export const types = {};
