import { readArchiveEntries } from './archive.js';
import { buildInstallPlan, ruleSupports, type InstallerRule, type InstallInstruction } from '../runtime/installer-engine.js';

export interface CorpusEntry {
  archive: string;
  matchedInstaller?: string;
  matchedModType?: string;
  planSize: number;
  /** Full install plan of the matched installer; used by placement validators. */
  plan?: readonly InstallInstruction[];
  /** True when the match is a custom install hook whose plan was not computed statically. */
  viaHook?: boolean;
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

  // Drop installers whose `scope.stores` excludes the active store — mirrors the
  // Vortex shim's `testSupported` gate (vortex-shim.ts) so the corpus reflects what
  // the published extension would actually do for this store. An unscoped rule always
  // applies; a scoped rule applies only when the active store is one it lists (and is
  // dropped entirely when no store is set, matching the shim's no-`discoveredStore` path).
  const activeStore = opts.vars.store;
  const inScope = (r: InstallerRule): boolean => {
    const stores = r.scope?.stores;
    if (!stores || stores.length === 0) return true;
    return typeof activeStore === 'string' && stores.includes(activeStore);
  };
  // Lower priority number = earlier; same convention as the engine.
  const sortedRules = [...rules].filter(inScope).sort((a, b) => a.priority - b.priority);

  for (const archive of archivePaths) {
    try {
      const files = readArchiveEntries(archive);
      const ctx = {
        archivePaths: files,
        vars: opts.vars,
      };
      let matchedRule: InstallerRule | undefined;
      let plan: InstallInstruction[] = [];
      let viaHook = false;
      for (const rule of sortedRules) {
        if (rule.hookName !== undefined) {
          // Custom install hook: can't build a plan statically, so match on the
          // `when`/`unless` predicate (the same gate the runtime shim applies).
          if (ruleSupports(rule, ctx)) { matchedRule = rule; plan = []; viaHook = true; break; }
          continue;
        }
        const result = buildInstallPlan(rule, files, ctx);
        if (result.length > 0) { matchedRule = rule; plan = result; break; }
      }
      if (matchedRule) {
        const modType = plan[0]?.modType ?? matchedRule.modType;
        entries.push({
          archive,
          planSize: plan.length,
          matchedInstaller: matchedRule.id,
          plan,
          ...(modType !== undefined && { matchedModType: modType }),
          ...(viaHook && { viaHook: true }),
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
