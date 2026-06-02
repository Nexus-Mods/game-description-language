export * from './context-resolver.js';
export * from './interpolate.js';
export * from './branch-tags.js';
export * from './vortex-shim.js';
export * from './glob.js';
export * from './pattern-matcher.js';
export * from './predicate.js';
export * from './installer-engine.js';
export * from './test-harness.js';

// NOTE: testing helpers (FakeContext, fakeDiscovery) are intentionally NOT
// re-exported here. They depend on `vitest` which would then be pulled into
// every production extension bundle. Downstream tests should import from
// `@gdl/runtime/testing` (or its aliased path), keeping the production
// `@gdl/runtime` import free of test-time dependencies.

// Public type alias for hook authors.
export type { DiscoveryFacts as GameContext } from './context-resolver.js';
