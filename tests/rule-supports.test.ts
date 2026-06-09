import { describe, it, expect } from 'vitest';
import { ruleSupports, buildInstallPlan, type InstallerRule } from '../src/runtime/installer-engine.js';

// Regression: the Vortex `testSupported` shim and `buildInstallPlan` must agree on
// whether a rule applies. If `testSupported` ignored `unless`, a higher-priority
// rule (e.g. pak-iostore: when *.utoc, unless *.pak) would claim support for a
// pak+utoc archive, then build an empty plan — which Vortex reports as a canceled
// install, instead of falling through to the correct rule (pak).
describe('ruleSupports honors unless', () => {
  const vars = { pakModsPath: '/games/Hello/Content/Paks/~mods' };
  const files = ['Mod/x_P.pak', 'Mod/x_P.ucas', 'Mod/x_P.utoc'];
  const ctx = { archivePaths: files, vars };

  const pakIostore: InstallerRule = {
    id: 'pak-iostore', priority: 29,
    when: { kind: 'hasFile', glob: '**/*.utoc' },
    unless: { kind: 'hasFile', glob: '**/*.pak' },
    single: { anchor: { kind: 'glob', pattern: '**/*.utoc' }, take: 'parent', placeAt: '${pakModsPath}' },
    modType: 'pak',
  };
  const pak: InstallerRule = {
    id: 'pak', priority: 30,
    when: { kind: 'hasFile', glob: '**/*.pak' },
    single: { anchor: { kind: 'glob', pattern: '**/*.pak' }, take: 'parent', placeAt: '${pakModsPath}' },
    modType: 'pak',
  };

  it('rejects a rule whose unless matches the archive', () => {
    expect(ruleSupports(pakIostore, ctx)).toBe(false);
  });

  it('accepts the rule whose when matches and has no excluding unless', () => {
    expect(ruleSupports(pak, ctx)).toBe(true);
  });

  it('priority selection (when AND not unless) picks the rule that yields a non-empty plan', () => {
    const selected = [pakIostore, pak]
      .sort((a, b) => a.priority - b.priority)
      .find((r) => ruleSupports(r, ctx))!;
    expect(selected.id).toBe('pak');
    expect(buildInstallPlan(selected, files, ctx)).toHaveLength(3);
  });
});
