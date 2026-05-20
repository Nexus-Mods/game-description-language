import { compileGlob, matchAny } from './glob.js';

export type PatternPredicate =
  | { kind: 'hasFile';  glob: string }
  | { kind: 'hasFiles'; globs: string[] }
  | { kind: 'matches';  regex: string };

const globCache = new Map<string, ReturnType<typeof compileGlob>>();
const cachedGlob = (g: string) => {
  let m = globCache.get(g);
  if (!m) { m = compileGlob(g); globCache.set(g, m); }
  return m;
};

const regexCache = new Map<string, RegExp>();
const cachedRegex = (r: string) => {
  let re = regexCache.get(r);
  if (!re) { re = new RegExp(r); regexCache.set(r, re); }
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
  const re = cachedRegex(pred.regex);
  for (const p of paths) if (re.test(p)) return true;
  return false;
};
