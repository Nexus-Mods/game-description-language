// Runtime mock for the native `winapi-bindings` module. Aliased in
// vitest.config.ts so `await import('winapi-bindings')` resolves under vitest
// on every platform (the real native module only loads on Windows). Mirrors the
// vortex-api mock: one fake for GDL's tests and every downstream extension.
//
// Only `RegGetValue` is faked — the single winapi call GDL discovery uses.

import { vi } from 'vitest';

export const RegGetValue = vi.fn<
  (hive: string, key: string, value: string) => { type?: string; value?: unknown } | undefined
>();
