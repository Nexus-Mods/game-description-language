import { describe, it, expect } from 'vitest';
import { compileGlob, matchAny } from '../src/runtime/glob.js';

describe('compileGlob', () => {
  it('matches single-star wildcards inside one path segment', () => {
    const m = compileGlob('*.pak');
    expect(m('MyMod.pak')).toBe(true);
    expect(m('subdir/MyMod.pak')).toBe(false);
  });

  it('matches double-star across segments', () => {
    const m = compileGlob('**/*.pak');
    expect(m('MyMod.pak')).toBe(true);
    expect(m('Mod/Sub/MyMod.pak')).toBe(true);
    expect(m('MyMod.txt')).toBe(false);
  });

  it('matches trailing slash anchors against directory prefixes', () => {
    const m = compileGlob('**/Scripts/');
    expect(m('a/Scripts/x.lua')).toBe(true);
    expect(m('Scripts/x.lua')).toBe(true);
    expect(m('a/Scripts')).toBe(false);
  });

  it('matches brace expansion', () => {
    const m = compileGlob('**/*.{pak,lua}');
    expect(m('a/x.pak')).toBe(true);
    expect(m('a/x.lua')).toBe(true);
    expect(m('a/x.txt')).toBe(false);
  });

  it('compiles once, evaluates many', () => {
    const m = compileGlob('**/*.pak');
    expect(typeof m).toBe('function');
    expect(m('a.pak')).toBe(true);
    expect(m('b.pak')).toBe(true);
  });
});

describe('matchAny', () => {
  it('returns true if any file matches the glob', () => {
    const m = compileGlob('**/*.pak');
    expect(matchAny(['a.txt', 'b.pak'], m)).toBe(true);
    expect(matchAny(['a.txt', 'b.lua'], m)).toBe(false);
  });
});
