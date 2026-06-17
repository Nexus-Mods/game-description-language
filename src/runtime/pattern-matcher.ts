import { compileGlob, matchAny } from './glob.js';

export type PatternPredicate =
  | { kind: 'hasFile';  glob: string }
  | { kind: 'hasFiles'; globs: string[] }
  | { kind: 'matches';  regex: string }
  | { kind: 'extensions'; list: string[]; mode: 'any' | 'all' };

/** A directory entry is one whose normalised path ends with a slash. */
const isDataFile = (p: string): boolean => !p.endsWith('/');

const globCache = new Map<string, ReturnType<typeof compileGlob>>();
const cachedGlob = (g: string) => {
  let m = globCache.get(g);
  if (!m) { m = compileGlob(g); globCache.set(g, m); }
  return m;
};

/**
 * Compile a regex source, honoring a leading inline-flag group like `(?i)` or
 * `(?im)`. JS doesn't support global inline flags, so we extract them and pass
 * them to the RegExp flags argument instead. This lets game.yaml authors write
 * case-insensitive matchers (`(?i)...`) the way Vortex extensions do with `/i`.
 */
export const compileRegex = (source: string): RegExp => {
  const m = /^\(\?([a-z]+)\)/.exec(source);
  if (m) return new RegExp(source.slice(m[0].length), m[1]);
  return new RegExp(source);
};

const regexCache = new Map<string, RegExp>();
const cachedRegex = (r: string) => {
  let re = regexCache.get(r);
  if (!re) { re = compileRegex(r); regexCache.set(r, re); }
  return re;
};

export const evalPredicate = (
  pred: PatternPredicate,
  paths: readonly string[],
): boolean => {
  if (pred.kind === 'hasFile') {
    return matchAny(paths, cachedGlob(pred.glob));
  }
  if (pred.kind === 'hasFiles') {
    return pred.globs.every(g => matchAny(paths, cachedGlob(g)));
  }
  if (pred.kind === 'extensions') {
    // Mirror Vortex's IInstallerSpec `extensions` match: operate on data files
    // only (directory entries excluded), case-insensitive suffix test. `all`
    // requires every data file to match; `any` requires at least one.
    const dataFiles = paths.filter(isDataFile);
    if (dataFiles.length === 0) return false;
    const lowerExts = pred.list.map(e => e.toLowerCase());
    const test = (f: string): boolean => lowerExts.some(ext => f.toLowerCase().endsWith(ext));
    return pred.mode === 'all' ? dataFiles.every(test) : dataFiles.some(test);
  }
  const re = cachedRegex(pred.regex);
  for (const p of paths) if (re.test(p)) return true;
  return false;
};
