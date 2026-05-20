import { describe, it, expect } from 'vitest';
import { evalPredicate, type PatternPredicate } from '../src/runtime/pattern-matcher.js';

describe('evalPredicate', () => {
  it('hasFile: returns true if any path matches the glob', () => {
    const p: PatternPredicate = { kind: 'hasFile', glob: '**/*.pak' };
    expect(evalPredicate(p, ['a.pak', 'b.txt'])).toBe(true);
    expect(evalPredicate(p, ['a.txt', 'b.lua'])).toBe(false);
  });

  it('hasFiles: requires every glob to match at least one path', () => {
    const p: PatternPredicate = {
      kind: 'hasFiles',
      globs: ['**/*.pak', '**/*.lua'],
    };
    expect(evalPredicate(p, ['a.pak', 'b.lua'])).toBe(true);
    expect(evalPredicate(p, ['a.pak', 'b.txt'])).toBe(false);
  });

  it('matches: regex over paths', () => {
    const p: PatternPredicate = { kind: 'matches', regex: '^Scripts/.+\\.lua$' };
    expect(evalPredicate(p, ['Scripts/main.lua'])).toBe(true);
    expect(evalPredicate(p, ['Lib/main.lua'])).toBe(false);
  });
});
