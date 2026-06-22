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
  documents?: string;         // user Documents folder (Vortex getVortexPath('documents'))
  home?: string;              // user home folder (Vortex getVortexPath('home'))
  version?: string;
}

export type ResolvedContext = Record<string, string | number | boolean>;

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
