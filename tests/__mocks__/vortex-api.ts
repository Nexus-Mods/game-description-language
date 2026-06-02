// Runtime mock for vortex-api used by GDL's own tests. The static type stub
// lives in src/types/vortex-api.d.ts; this is the runtime counterpart so
// `await import('vortex-api')` from inside vortex-shim works under vitest.
//
// Only includes what GDL's runtime actually touches.

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
    findByAppId: vi.fn<(ids: string | string[]) => Promise<{ gamePath: string; gameStoreId: string } | null>>(),
  },
  opn: vi.fn((_url: string) => Promise.resolve()),
};

export const selectors = {
  activeGameId:    vi.fn<(state: unknown) => string | undefined>(),
  discoveryByGame: vi.fn<(state: unknown, gameId: string) => { path?: string; store?: string } | undefined>(),
};
