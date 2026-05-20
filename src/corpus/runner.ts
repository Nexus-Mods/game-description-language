import { readZipEntries } from './archive.js';
import { buildInstallPlan, type InstallerRule, type InstallInstruction } from '../runtime/installer-engine.js';

export interface CorpusEntry {
  archive: string;
  matchedInstaller?: string;
  planSize: number;
  error?: string;
}

export interface CorpusReport {
  total: number;
  matched: number;
  unmatched: number;
  failed: number;
  entries: CorpusEntry[];
}

export interface CorpusOptions {
  vars: Record<string, string | number | boolean>;
}

export const runCorpus = (
  rules: readonly InstallerRule[],
  archivePaths: readonly string[],
  opts: CorpusOptions,
): CorpusReport => {
  const entries: CorpusEntry[] = [];
  let matched = 0, unmatched = 0, failed = 0;

  // Lower priority number = earlier; same convention as the engine.
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const archive of archivePaths) {
    try {
      const files = readZipEntries(archive);
      const ctx = { archivePaths: files, vars: opts.vars };
      let matchedRule: InstallerRule | undefined;
      let plan: InstallInstruction[] = [];
      for (const rule of sortedRules) {
        const result = buildInstallPlan(rule, files, ctx);
        if (result.length > 0) { matchedRule = rule; plan = result; break; }
      }
      if (matchedRule) {
        entries.push({
          archive,
          planSize: plan.length,
          ...(matchedRule && { matchedInstaller: matchedRule.id }),
        });
        matched++;
      } else {
        entries.push({ archive, planSize: 0 });
        unmatched++;
      }
    } catch (e) {
      entries.push({
        archive,
        planSize: 0,
        ...(e instanceof Error ? { error: e.message } : { error: String(e) }),
      });
      failed++;
    }
  }

  return {
    total: archivePaths.length,
    matched,
    unmatched,
    failed,
    entries,
  };
};
