import { evalPredicateExpr, type PredicateExpr } from '../runtime/predicate.js';
import type { CorpusEntry } from './runner.js';

export interface ValidatorDef {
  id: string;
  name: string;
  when: PredicateExpr;
  assert: {
    matched?: string;
    modType?: string;
  };
}

export interface ValidatorResult {
  validatorId: string;
  archive: string;
  passed: boolean;
  message?: string;
}

export interface ValidatorReport {
  total: number;
  passed: number;
  failed: number;
  results: ValidatorResult[];
}

/**
 * Run validators against corpus results.
 *
 * For each archive, check every validator whose `when` predicate matches the
 * archive's file list. If a validator applies, assert that the corpus result
 * (matched installer, mod type) matches expectations.
 */
export const runValidators = (
  validators: readonly ValidatorDef[],
  corpusEntries: readonly CorpusEntry[],
  archiveContents: ReadonlyMap<string, readonly string[]>,
  vars: Record<string, string | number | boolean>,
): ValidatorReport => {
  const results: ValidatorResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const entry of corpusEntries) {
    const files = archiveContents.get(entry.archive);
    if (!files) continue;

    const ctx = { archivePaths: files, vars };

    for (const v of validators) {
      if (!evalPredicateExpr(v.when, ctx)) continue;

      const failures: string[] = [];

      if (v.assert.matched !== undefined && entry.matchedInstaller !== v.assert.matched) {
        failures.push(
          `expected installer \`${v.assert.matched}\`, got \`${entry.matchedInstaller ?? '<none>'}\``,
        );
      }

      if (v.assert.modType !== undefined && entry.matchedModType !== v.assert.modType) {
        failures.push(
          `expected modType \`${v.assert.modType}\`, got \`${entry.matchedModType ?? '<none>'}\``,
        );
      }

      if (failures.length === 0) {
        results.push({ validatorId: v.id, archive: entry.archive, passed: true });
        passed++;
      } else {
        results.push({
          validatorId: v.id,
          archive: entry.archive,
          passed: false,
          message: failures.join('; '),
        });
        failed++;
      }
    }
  }

  return { total: passed + failed, passed, failed, results };
};
