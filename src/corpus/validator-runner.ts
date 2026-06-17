import { evalPredicateExpr, type PredicateExpr } from '../runtime/predicate.js';
import { compileGlob } from '../runtime/glob.js';
import { interpolate } from '../runtime/interpolate.js';
import type { CorpusEntry } from './runner.js';

/** A single placement assertion: files matching `files` must (not) land at a destination. */
export interface PlacementAssert {
  files: string;          // glob over each plan instruction's source path
  mustMatch?: string;     // resolved destination must match this glob (var-interpolated)
  mustNotMatch?: string;  // resolved destination must NOT match this glob (var-interpolated)
}

export interface ValidatorDef {
  id: string;
  name: string;
  when: PredicateExpr;
  assert: {
    matched?: string;
    modType?: string;
    placement?: readonly PlacementAssert[];
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

    const ctx = {
      archivePaths: files,
      vars,
    };

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

      for (const rule of v.assert.placement ?? []) {
        const fileMatcher = compileGlob(rule.files);
        const targeted = (entry.plan ?? []).filter(i => fileMatcher(i.source));

        if (rule.mustMatch !== undefined) {
          const want = compileGlob(interpolate(rule.mustMatch, vars));
          if (targeted.length === 0) {
            failures.push(
              `placement[\`${rule.files}\`]: no installed file matches \`${rule.files}\`, expected destination under \`${rule.mustMatch}\``,
            );
          }
          for (const i of targeted) {
            if (!want(i.destination)) {
              failures.push(
                `placement[\`${rule.files}\`]: \`${i.destination}\` must match \`${rule.mustMatch}\``,
              );
            }
          }
        }

        if (rule.mustNotMatch !== undefined) {
          const forbidden = compileGlob(interpolate(rule.mustNotMatch, vars));
          for (const i of targeted) {
            if (forbidden(i.destination)) {
              failures.push(
                `placement[\`${rule.files}\`]: \`${i.destination}\` must not match \`${rule.mustNotMatch}\``,
              );
            }
          }
        }
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
