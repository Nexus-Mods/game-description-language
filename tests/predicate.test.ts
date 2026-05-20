import { describe, it, expect } from 'vitest';
import { evalPredicateExpr, type PredicateExpr, type EvalContext } from '../src/runtime/predicate.js';

const ctx: EvalContext = {
  archivePaths: ['a.pak', 'Scripts/main.lua'],
  vars: { store: 'steam', os: 'windows', version: '1.2.3' },
};

describe('evalPredicateExpr', () => {
  it('hasFile glob true', () => {
    const p: PredicateExpr = { kind: 'hasFile', glob: '**/*.pak' };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('any: true if any arm true', () => {
    const p: PredicateExpr = {
      kind: 'any',
      arms: [
        { kind: 'hasFile', glob: '**/*.never' },
        { kind: 'hasFile', glob: '**/*.lua' },
      ],
    };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('all: false if any arm false', () => {
    const p: PredicateExpr = {
      kind: 'all',
      arms: [
        { kind: 'hasFile', glob: '**/*.pak' },
        { kind: 'hasFile', glob: '**/*.never' },
      ],
    };
    expect(evalPredicateExpr(p, ctx)).toBe(false);
  });

  it('not: negates', () => {
    const p: PredicateExpr = { kind: 'not', arm: { kind: 'hasFile', glob: '**/*.never' } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('when: ==', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: '==', left: { kind: 'ref', name: 'store' }, right: { kind: 'literal', raw: 'steam' } } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('when: in list', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: 'in', left: { kind: 'ref', name: 'os' }, right: [{ kind: 'literal', raw: 'windows' }, { kind: 'literal', raw: 'linux' }] } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('when: semver >=', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: '>=', left: { kind: 'ref', name: 'version' }, right: { kind: 'literal', raw: '1.0.0' } } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('throws on unbound variable', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: '==', left: { kind: 'ref', name: 'missing' }, right: { kind: 'literal', raw: 'x' } } };
    expect(() => evalPredicateExpr(p, ctx)).toThrow(/unbound/);
  });
});
