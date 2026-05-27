import { compileGlob, findShallowest } from './glob.js';
import { interpolate } from './interpolate.js';
import { evalPredicateExpr, type PredicateExpr, type EvalContext } from './predicate.js';

export type TakeStrategy = 'self' | 'parent' | 'parent.parent' | 'archive-root' | { depth: number };

export interface Pattern {
  kind: 'glob' | 'regex';
  pattern: string;
}

export interface SingleForm {
  anchor: Pattern;
  take: TakeStrategy;
  placeAt: string;          // template
}

export interface RouteEntry {
  match: Pattern;
  anchor: Pattern;
  take: TakeStrategy;
  placeAt: string;          // template
  modType: string;
}

export interface InstallerRule {
  id: string;
  priority: number;
  when: PredicateExpr;
  unless?: PredicateExpr;
  scope?: { stores?: string[] };
  single?: SingleForm;
  route?: RouteEntry[];
  modType?: string;          // single only
}

export interface InstallInstruction {
  source: string;
  destination: string;        // absolute: placeAt + relative (for tests/corpus)
  relative: string;           // relative to placeAt (for Vortex copy instructions)
  modType: string;
}

const splitSegments = (p: string): string[] => p.split('/').filter(s => s.length > 0);
const joinSegments = (segs: readonly string[]): string => segs.join('/');

const takeOffset = (take: TakeStrategy): number =>
  take === 'self' ? 0
  : take === 'parent' ? 1
  : take === 'parent.parent' ? 2
  : take === 'archive-root' ? Number.MAX_SAFE_INTEGER
  : take.depth;

// stripPath: compute the relative path for `path` given the resolved anchor match and strategy.
//
// For directory-shaped anchors (pattern ends with '/'):
//   Locate the literal directory name in the path and keep from that segment onward.
//   Files not under the anchor directory return '' (caller should exclude them).
//
// For file-shaped anchors:
//   Use the non-doublestar depth of the anchor pattern to determine how many leading
//   segments to strip.  This correctly handles patterns like "**/Scripts/ *.lua" with
//   take: parent.parent where the doublestar resolves to multiple segments.
//
//   Formula: dropCount = (starStarExpansionDepth + 1) - offset
//     where starStarExpansionDepth = anchorSegs.length - patternNonStarStarDepth
//     and   patternNonStarStarDepth = count of non-'**' segments in the pattern.
//
//   With take: parent (offset=1):  dropCount = starStarExpansionDepth + 1 - 1 = depth
//   With take: parent.parent (offset=2): dropCount = starStarExpansionDepth - 1
const stripPath = (
  path: string,
  take: TakeStrategy,
  anchorMatch: string,
  anchorPattern: string,
): string => {
  if (take === 'archive-root') {
    // Keep the path as-is from the archive root — no segments stripped, no filtering.
    return path;
  }
  if (anchorPattern.endsWith('/')) {
    // Directory-shaped anchor: find the literal dir name (last non-glob segment).
    const literalDir = anchorPattern
      .slice(0, -1)
      .split('/')
      .filter(s => s.length > 0 && !s.includes('*'))
      .pop();
    if (literalDir) {
      const pathSegs = splitSegments(path);
      const literalDirLower = literalDir.toLowerCase();
      const dirIdx = pathSegs.findIndex(s => s.toLowerCase() === literalDirLower);
      if (dirIdx === -1) {
        // File is not under the anchor directory; exclude it.
        return '';
      }
      // Keep from dirIdx so the anchor directory name appears in the output.
      return joinSegments(pathSegs.slice(dirIdx));
    }
  }

  // File-shaped anchor: derive dropCount from the anchor pattern structure.
  const anchorSegs = splitSegments(anchorMatch);
  const offset = takeOffset(take);
  const patternNonStarStarDepth = anchorPattern
    .split('/')
    .filter(s => s !== '**' && s.length > 0).length;
  const starStarExpansionDepth = anchorSegs.length - patternNonStarStarDepth;
  const dropCount = Math.max(0, starStarExpansionDepth + 1 - offset);

  // Install root: the first `dropCount` segments of the anchor match.
  // Files not under the install root are excluded (same contract as the directory-anchor branch).
  const installRootSegs = anchorSegs.slice(0, dropCount);
  const pathSegs = splitSegments(path);
  if (installRootSegs.length > 0) {
    if (pathSegs.length < installRootSegs.length) return '';
    for (let i = 0; i < installRootSegs.length; i++) {
      if (pathSegs[i] !== installRootSegs[i]) return '';
    }
  }
  return joinSegments(pathSegs.slice(dropCount));
};

const matches = (p: Pattern, path: string): boolean => {
  if (p.kind === 'glob') return compileGlob(p.pattern)(path);
  return new RegExp(p.pattern).test(path);
};

export const buildInstallPlan = (
  rule: InstallerRule,
  archivePaths: readonly string[],
  ctx: EvalContext,
): InstallInstruction[] => {
  if (!evalPredicateExpr(rule.when, ctx)) return [];
  if (rule.unless !== undefined && evalPredicateExpr(rule.unless, ctx)) return [];

  if (rule.single) {
    const matcher = compileGlob(rule.single.anchor.pattern);
    const anchorHit = findShallowest(archivePaths, matcher);
    if (!anchorHit) return [];
    const destRoot = interpolate(rule.single.placeAt, ctx.vars);
    const results: InstallInstruction[] = [];
    for (const src of archivePaths) {
      const relative = stripPath(src, rule.single.take, anchorHit, rule.single.anchor.pattern);
      if (relative === '') continue; // excluded by directory-anchor filter
      results.push({
        source: src,
        destination: joinSegments(
          [destRoot, relative].filter(s => s.length > 0),
        ),
        relative,
        modType: rule.modType!,
      });
    }
    return results;
  }

  const plan: InstallInstruction[] = [];
  for (const src of archivePaths) {
    for (const r of rule.route ?? []) {
      if (!matches(r.match, src)) continue;
      const matcher = compileGlob(r.anchor.pattern);
      const anchorHit = findShallowest(archivePaths, matcher);
      if (!anchorHit) break;
      const destRoot = interpolate(r.placeAt, ctx.vars);
      const relative = stripPath(src, r.take, anchorHit, r.anchor.pattern);
      if (relative === '') break; // no valid placement; treat as unmatched
      plan.push({
        source: src,
        destination: joinSegments(
          [destRoot, relative].filter(s => s.length > 0),
        ),
        relative,
        modType: r.modType,
      });
      break;
    }
  }
  return plan;
};
