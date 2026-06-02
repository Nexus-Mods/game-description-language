// Public entry point for GDL's testing helpers. Downstream game extensions
// import from this subpath (NOT from `@gdl/runtime`):
//
//   import { createFakeContext, fakeDiscovery } from '@gdl/runtime/testing';
//
// This is intentionally NOT re-exported through `runtime/index.ts`. The
// testing module imports `vitest` at the top level; if it were re-exported,
// webpack would pull the entire vitest runtime (~280 KB plus vi.fn() spy
// machinery instantiated at module-init time) into every downstream
// extension's production bundle. Downstream test files alias `@gdl/runtime/
// testing` to this file in their vitest config; production `extension.ts`
// imports only from `@gdl/runtime` and never sees this module.
//
// If you're tempted to "simplify" this by re-exporting from runtime/index.ts:
// don't. Run `wc -c dist/index.js && grep -c vitest dist/index.js` before
// and after to see the impact.
export * from './fake-context.js';
