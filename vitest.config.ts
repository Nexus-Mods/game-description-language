import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    alias: {
      // The static type stub lives in src/types/vortex-api.d.ts; the runtime
      // mock here is what `await import('vortex-api')` actually loads when the
      // runtime is exercised under vitest.
      'vortex-api': resolve(root, 'src/runtime/testing/vortex-api-mock.ts'),
      // Native module; the real one only loads on Windows. The mock lets the
      // registry-discovery path run under vitest on any platform.
      'winapi-bindings': resolve(root, 'src/runtime/testing/winapi-mock.ts'),
    },
  },
});
