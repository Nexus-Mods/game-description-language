import type { InstallInstruction } from './installer-engine.js';

export interface ExpectShape {
  matched?: string;
  modType?: string;
  plan?: string[];
}

export type AssertResult =
  | { ok: true }
  | { ok: false; message: string };

const fmt = (paths: readonly string[]): string =>
  paths.map(p => `  ${p}`).join('\n');

export const assertPlan = (
  plan: readonly InstallInstruction[],
  matchedId: string,
  expected: ExpectShape,
): AssertResult => {
  if (expected.matched !== undefined && expected.matched !== matchedId) {
    return {
      ok: false,
      message: `matched installer mismatch: expected \`${expected.matched}\`, got \`${matchedId}\``,
    };
  }
  if (expected.modType !== undefined) {
    const actual = plan[0]?.modType;
    if (actual !== expected.modType) {
      return {
        ok: false,
        message: `modType mismatch: expected \`${expected.modType}\`, got \`${actual ?? '<none>'}\``,
      };
    }
  }
  if (expected.plan !== undefined) {
    const actual = [...plan.map(p => p.destination)].sort();
    const want   = [...expected.plan].sort();
    if (actual.length !== want.length || actual.some((d, i) => d !== want[i])) {
      return {
        ok: false,
        message: `destination plan mismatch.\nexpected:\n${fmt(want)}\nactual:\n${fmt(actual)}`,
      };
    }
  }
  return { ok: true };
};
