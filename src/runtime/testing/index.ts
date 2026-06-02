// Public entry point for GDL's testing helpers. Downstream game extensions
// can import everything they need to drive lifecycle tests from here:
//
//   import { createFakeContext, fakeDiscovery } from '@gdl/runtime';
//
// (The `testing/` submodule is re-exported through `runtime/index.ts`, so the
// public alias `@gdl/runtime` is enough — no extra path needed.)
export * from './fake-context.js';
