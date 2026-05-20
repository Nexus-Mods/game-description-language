import type { Tags } from 'yaml';

export type BranchTagName = '!storeBranch' | '!osBranch' | '!versionBranch';

export const BRANCH_TAG_NAMES: ReadonlySet<BranchTagName> =
  new Set(['!storeBranch', '!osBranch', '!versionBranch']);

// Identity resolvers so the parser accepts these tags without warning;
// the rest of the parser detects them via `node.tag`.
export const customTags: Tags = [
  { tag: '!storeBranch',   collection: 'map', resolve: (value: unknown) => value },
  { tag: '!osBranch',      collection: 'map', resolve: (value: unknown) => value },
  { tag: '!versionBranch', collection: 'map', resolve: (value: unknown) => value },
];
