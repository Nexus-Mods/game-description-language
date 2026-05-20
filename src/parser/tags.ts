import type { Tags } from 'yaml';

export type BranchTagName = '!storeBranch' | '!osBranch' | '!versionBranch';
export const BRANCH_TAG_NAMES: ReadonlySet<BranchTagName> =
  new Set(['!storeBranch', '!osBranch', '!versionBranch']);

export type PatternTagName = '!hasFile' | '!hasFiles' | '!matches';
export const PATTERN_TAG_NAMES: ReadonlySet<PatternTagName> =
  new Set(['!hasFile', '!hasFiles', '!matches']);

export type PredicateTagName = '!when' | '!any' | '!all' | '!not';
export const PREDICATE_TAG_NAMES: ReadonlySet<PredicateTagName> =
  new Set(['!when', '!any', '!all', '!not']);

export const HOOK_TAG = '!hook';

export const customTags: Tags = [
  // Branch tags (collection: map).
  { tag: '!storeBranch',   collection: 'map', resolve: (value: unknown) => value },
  { tag: '!osBranch',      collection: 'map', resolve: (value: unknown) => value },
  { tag: '!versionBranch', collection: 'map', resolve: (value: unknown) => value },

  // Predicate combinators.
  { tag: '!when', collection: 'map', resolve: (value: unknown) => value },
  { tag: '!any',  collection: 'seq', resolve: (value: unknown) => value },
  { tag: '!all',  collection: 'seq', resolve: (value: unknown) => value },
  { tag: '!not',  collection: 'seq', resolve: (value: unknown) => value },

  // Pattern tags — applied to scalars (a glob string) or sequences (list of globs for !hasFiles).
  { tag: '!hasFile',  resolve: (value: unknown) => value },
  { tag: '!hasFiles', resolve: (value: unknown) => value },
  { tag: '!matches',  resolve: (value: unknown) => value },

  // Hook reference — scalar carrying the hook id.
  { tag: HOOK_TAG, resolve: (value: unknown) => value },
];
