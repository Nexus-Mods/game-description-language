import picomatch from 'picomatch';

export type GlobMatcher = (path: string) => boolean;

export const compileGlob = (pattern: string): GlobMatcher => {
  // Trailing slash means "this directory" — match any file under it.
  const normalised = pattern.endsWith('/') ? `${pattern}**/*` : pattern;
  const m = picomatch(normalised, { dot: true, nocase: true });
  return (path: string) => m(path);
};

export const matchAny = (paths: readonly string[], matcher: GlobMatcher): boolean => {
  for (const p of paths) if (matcher(p)) return true;
  return false;
};

export const findFirst = (
  paths: readonly string[],
  matcher: GlobMatcher,
): string | undefined => {
  for (const p of paths) if (matcher(p)) return p;
  return undefined;
};

export const findShallowest = (
  paths: readonly string[],
  matcher: GlobMatcher,
): string | undefined => {
  let best: string | undefined;
  let bestDepth = Infinity;
  for (const p of paths) {
    if (!matcher(p)) continue;
    const depth = p.split('/').length;
    if (depth < bestDepth) {
      best = p;
      bestDepth = depth;
    }
  }
  return best;
};
