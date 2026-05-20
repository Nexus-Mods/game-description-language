import { evalPredicate, type PatternPredicate } from './pattern-matcher.js';

export type ValueRef =
  | { kind: 'literal'; raw: string | number | boolean }
  | { kind: 'ref';     name: string };

export type ComparisonExpr =
  | { op: '==' | '!=';                left: ValueRef; right: ValueRef }
  | { op: 'in';                       left: ValueRef; right: ValueRef[] }
  | { op: '>=' | '<=' | '>' | '<';    left: ValueRef; right: ValueRef };

export type PredicateExpr =
  | PatternPredicate
  | { kind: 'when'; expr: ComparisonExpr }
  | { kind: 'any';  arms: PredicateExpr[] }
  | { kind: 'all';  arms: PredicateExpr[] }
  | { kind: 'not';  arm:  PredicateExpr };

export interface EvalContext {
  archivePaths: readonly string[];
  vars: Readonly<Record<string, string | number | boolean>>;
}

const resolveRef = (ref: ValueRef, vars: EvalContext['vars']): string | number | boolean => {
  if (ref.kind === 'literal') return ref.raw;
  if (!(ref.name in vars)) throw new Error(`unbound variable \`${ref.name}\``);
  return vars[ref.name]!;
};

const cmpSemver = (a: string, b: string): number => {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
};

const evalComparison = (expr: ComparisonExpr, ctx: EvalContext): boolean => {
  const l = resolveRef(expr.left, ctx.vars);
  if (expr.op === 'in') {
    return expr.right.some(r => resolveRef(r, ctx.vars) === l);
  }
  const r = resolveRef(expr.right, ctx.vars);
  if (expr.op === '==') return l === r;
  if (expr.op === '!=') return l !== r;
  // Comparison ops use semver if both sides are strings; numeric otherwise.
  if (typeof l === 'string' && typeof r === 'string') {
    const c = cmpSemver(l, r);
    if (expr.op === '>=') return c >= 0;
    if (expr.op === '<=') return c <= 0;
    if (expr.op === '>')  return c >  0;
    return c < 0;
  }
  const lf = Number(l);
  const rf = Number(r);
  if (expr.op === '>=') return lf >= rf;
  if (expr.op === '<=') return lf <= rf;
  if (expr.op === '>')  return lf >  rf;
  return lf < rf;
};

export const evalPredicateExpr = (
  pred: PredicateExpr,
  ctx: EvalContext,
): boolean => {
  if (pred.kind === 'hasFile' || pred.kind === 'hasFiles' || pred.kind === 'matches') {
    return evalPredicate(pred, ctx.archivePaths);
  }
  if (pred.kind === 'when') return evalComparison(pred.expr, ctx);
  if (pred.kind === 'any')  return pred.arms.some(a => evalPredicateExpr(a, ctx));
  if (pred.kind === 'all')  return pred.arms.every(a => evalPredicateExpr(a, ctx));
  return !evalPredicateExpr(pred.arm, ctx);
};
