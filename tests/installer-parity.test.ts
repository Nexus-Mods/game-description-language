import { describe, it, expect } from 'vitest';
import { evalPredicateExpr, type PredicateExpr, type EvalContext } from '../src/runtime/predicate.js';
import { buildInstallPlan, type InstallerRule } from '../src/runtime/installer-engine.js';
import { parseYaml } from '../src/parser/index.js';
import { emit } from '../src/codegen/emit.js';

// Phase 1.3: predicate + installer primitives added so a hand-written Vortex
// extension's IInstallerSpec table (extensions/stopPatterns matches +
// stripCommonRoot copy) can be expressed declaratively in GDL.

describe('extensions predicate', () => {
  const ctx = (paths: string[]): EvalContext => ({ archivePaths: paths, vars: {} });

  it('mode any: true when at least one data file has the extension', () => {
    const p: PredicateExpr = { kind: 'extensions', list: ['.exe'], mode: 'any' };
    expect(evalPredicateExpr(p, ctx(['tool.exe', 'readme.txt']))).toBe(true);
    expect(evalPredicateExpr(p, ctx(['readme.txt']))).toBe(false);
  });

  it('mode all: true only when every data file matches', () => {
    const p: PredicateExpr = { kind: 'extensions', list: ['.pdf', '.md'], mode: 'all' };
    expect(evalPredicateExpr(p, ctx(['a.pdf', 'docs/b.md']))).toBe(true);
    expect(evalPredicateExpr(p, ctx(['a.pdf', 'mod.dll']))).toBe(false);
  });

  it('is case-insensitive', () => {
    const p: PredicateExpr = { kind: 'extensions', list: ['.exe'], mode: 'any' };
    expect(evalPredicateExpr(p, ctx(['Tool.EXE']))).toBe(true);
  });

  it('ignores directory entries and is false for an all-directory list', () => {
    const p: PredicateExpr = { kind: 'extensions', list: ['.txt'], mode: 'all' };
    // Only data files are considered; the dir entry is filtered out.
    expect(evalPredicateExpr(p, ctx(['mod/', 'mod/a.txt']))).toBe(true);
    // No data files -> false (mirrors Vortex's empty-dataFiles guard).
    expect(evalPredicateExpr(p, ctx(['mod/']))).toBe(false);
  });
});

describe('matches predicate with inline (?i) flag', () => {
  const ctx = (paths: string[]): EvalContext => ({ archivePaths: paths, vars: {} });

  it('matches case-insensitively when the source starts with (?i)', () => {
    const p: PredicateExpr = { kind: 'matches', regex: '(?i)(^|/)(quicksave|save_\\d+)\\.xml$' };
    expect(evalPredicateExpr(p, ctx(['Save_001.XML']))).toBe(true);
    expect(evalPredicateExpr(p, ctx(['QuickSave.xml']))).toBe(true);
    expect(evalPredicateExpr(p, ctx(['notes.txt']))).toBe(false);
  });

  it('is case-sensitive without the flag', () => {
    const p: PredicateExpr = { kind: 'matches', regex: '(^|/)save_\\d+\\.xml$' };
    expect(evalPredicateExpr(p, ctx(['save_001.xml']))).toBe(true);
    expect(evalPredicateExpr(p, ctx(['SAVE_001.XML']))).toBe(false);
  });
});

describe('copy installer form', () => {
  const ctx = (paths: string[]): { archivePaths: string[]; vars: Record<string, never> } =>
    ({ archivePaths: paths, vars: {} });

  const rule = (stripCommonRoot: boolean): InstallerRule => ({
    id: 'dropin',
    priority: 75,
    when: { kind: 'hasFile', glob: '**/*' },
    copy: { stripCommonRoot },
    modType: 'xrebirth-dropin',
  });

  it('stripCommonRoot=false keeps full archive-relative paths', () => {
    const files = ['Mod/data/01.cat', 'Mod/readme.txt'];
    const plan = buildInstallPlan(rule(false), files, ctx(files));
    expect(plan.map(p => p.relative).sort()).toEqual(['Mod/data/01.cat', 'Mod/readme.txt']);
    expect(plan.every(p => p.modType === 'xrebirth-dropin')).toBe(true);
  });

  it('stripCommonRoot=true drops a single shared wrapper dir', () => {
    const files = ['Mod/data/01.cat', 'Mod/readme.txt'];
    const plan = buildInstallPlan(rule(true), files, ctx(files));
    expect(plan.map(p => p.relative).sort()).toEqual(['data/01.cat', 'readme.txt']);
  });

  it('stripCommonRoot=true is a no-op when files live at the archive root', () => {
    const files = ['01.cat', 'readme.txt'];
    const plan = buildInstallPlan(rule(true), files, ctx(files));
    expect(plan.map(p => p.relative).sort()).toEqual(['01.cat', 'readme.txt']);
  });

  it('stripCommonRoot=true is a no-op when top-level dirs differ', () => {
    const files = ['A/x.cat', 'B/y.cat'];
    const plan = buildInstallPlan(rule(true), files, ctx(files));
    expect(plan.map(p => p.relative).sort()).toEqual(['A/x.cat', 'B/y.cat']);
  });

  it('excludes directory entries from the plan', () => {
    const files = ['Mod/', 'Mod/01.cat'];
    const plan = buildInstallPlan(rule(true), files, ctx(files));
    expect(plan.map(p => p.relative)).toEqual(['01.cat']);
  });
});

describe('custom installer hook (parse + emit)', () => {
  const yaml = `
gdl: 1
game:
  id: xrebirth
  name: X Rebirth
  executable: XRebirth.exe
  requiredFiles: [XRebirth.exe]
installers:
  - id: content-xml
    priority: 50
    when: { hasFile: "**/content.xml" }
    install: { hook: installContentXml }
`;

  it('parses install: { hook } into installHook', () => {
    const doc = parseYaml(yaml, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.installHook).toBe('installContentXml');
    expect(inst.single).toBeUndefined();
    expect(inst.copy).toBeUndefined();
    expect(inst.route).toBeUndefined();
  });

  it('emits installers.gen.ts that imports hooks and references the hook', () => {
    const doc = parseYaml(yaml, 'inline.yaml');
    const files = emit(doc);
    const installers = files.find(f => f.path === 'installers.gen.ts')!;
    expect(installers.contents).toContain("import * as hooks from '../src/hooks.js'");
    expect(installers.contents).toContain('installHook: hooks.installContentXml');
  });
});
