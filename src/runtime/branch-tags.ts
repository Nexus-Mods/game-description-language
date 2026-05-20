export interface BranchValue {
  kind: 'storeBranch' | 'osBranch' | 'versionBranch';
  arms: Record<string, unknown>;
  default: unknown;
}

export const resolveBranch = (branch: BranchValue, ctx: Record<string, string>): unknown => {
  const key = branch.kind === 'storeBranch' ? ctx.store
            : branch.kind === 'osBranch'    ? ctx.os
            : ctx.version;
  if (key !== undefined && key in branch.arms) return branch.arms[key];
  return branch.default;
};
