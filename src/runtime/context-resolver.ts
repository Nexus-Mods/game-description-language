import { interpolate, referencedNames } from './interpolate.js';
import { resolveBranch, type BranchValue } from './branch-tags.js';

export type ResolvableValue =
  | { kind: 'literal'; raw: string | number | boolean }
  | { kind: 'interpolated'; template: string }
  | BranchValue;

export interface ContextSpec {
  bindings: { name: string; value: ResolvableValue }[];
}

export interface DiscoveryFacts {
  store: string;
  os: 'windows' | 'linux' | 'macos';
  arch: 'x64' | 'arm64';
  installPath: string;
  executablePath: string;
  appDataLocal?: string;      // Windows: %LOCALAPPDATA%
  appDataLocalLow?: string;   // Windows: %LOCALAPPDATA%/../LocalLow
  appDataRoaming?: string;    // Windows: %APPDATA%
  version?: string;
}

export type ResolvedContext = Record<string, string | number | boolean>;

// The Windows AppData roots Vortex never puts in its IDiscoveryResult, derived
// from the environment. Three call sites used to compute these inline with
// subtly different formulas — factsFromDiscovery left a literal '/../LocalLow'
// in the path, discover() normalised it away, and the codegen test harness
// hardcoded a third sentinel — so a setup dir under ${appDataLocalLow} resolved
// to a different string in each, and the generated lifecycle test could never
// match the runtime (Paralives, 2026-07). This is the single source of truth.
//
// Paths use forward slashes and no unresolved '..' segment so that string
// assertions in generated tests are stable. `env` is injectable so codegen and
// tests can force deterministic sentinels instead of the host's real env.
export interface WindowsAppDataEnv {
  LOCALAPPDATA?: string | undefined;
  APPDATA?: string | undefined;
  USERPROFILE?: string | undefined;
  HOME?: string | undefined;
}

export const windowsAppDataFacts = (
  env: WindowsAppDataEnv = process.env,
): { appDataLocal: string; appDataLocalLow: string; appDataRoaming: string } => {
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const appDataLocal = (env.LOCALAPPDATA || `${home}/AppData/Local`).replace(/\\/g, '/');
  const appDataRoaming = (env.APPDATA || `${home}/AppData/Roaming`).replace(/\\/g, '/');
  // LocalLow is Local's sibling. Replace the final path segment with 'LocalLow'
  // rather than appending '/../LocalLow', so the result carries no '..' segment
  // to normalise and string assertions in generated tests stay stable. Works
  // regardless of what the final segment is named on a customised %LOCALAPPDATA%.
  const appDataLocalLow = appDataLocal.replace(/\/[^/]*$/, '/LocalLow');
  return { appDataLocal, appDataLocalLow, appDataRoaming };
};

const resolveValue = (
  value: ResolvableValue,
  ctx: ResolvedContext,
): string | number | boolean => {
  if (value.kind === 'literal') return value.raw;
  if (value.kind === 'interpolated') return interpolate(value.template, ctx);
  const resolved = resolveBranch(value, ctx as Record<string, string>);
  // Branch arms are themselves ResolvableValues — recurse.
  return resolveValue(resolved as ResolvableValue, ctx);
};

const topologicalOrder = (spec: ContextSpec): string[] => {
  const indegree = new Map<string, number>();
  const edges = new Map<string, Set<string>>();
  for (const b of spec.bindings) {
    indegree.set(b.name, 0);
    edges.set(b.name, new Set());
  }
  for (const b of spec.bindings) {
    const deps =
      b.value.kind === 'interpolated' ? referencedNames(b.value.template) :
      b.value.kind === 'literal'      ? [] :
      // Branch values may reference vars in arms — collect from interpolated arms.
      Object.values(b.value.arms).concat([b.value.default]).flatMap(arm => {
        const a = arm as ResolvableValue;
        return a?.kind === 'interpolated' ? referencedNames(a.template) : [];
      });
    for (const dep of deps) {
      if (!indegree.has(dep)) continue;       // built-in; no ordering needed
      edges.get(dep)!.add(b.name);
      indegree.set(b.name, (indegree.get(b.name) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const ready = spec.bindings.filter(b => indegree.get(b.name) === 0).map(b => b.name);
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    for (const succ of edges.get(n) ?? []) {
      indegree.set(succ, indegree.get(succ)! - 1);
      if (indegree.get(succ) === 0) ready.push(succ);
    }
  }
  if (order.length !== spec.bindings.length) {
    throw new Error('context bindings have a cycle');
  }
  return order;
};

export const resolveContext = (
  spec: ContextSpec,
  facts: DiscoveryFacts,
): ResolvedContext => {
  const ctx: ResolvedContext = { ...(facts as unknown as Record<string, string | number | boolean>) };
  const byName = new Map(spec.bindings.map(b => [b.name, b.value]));
  for (const name of topologicalOrder(spec)) {
    ctx[name] = resolveValue(byName.get(name)!, ctx);
  }
  return Object.freeze(ctx);
};
