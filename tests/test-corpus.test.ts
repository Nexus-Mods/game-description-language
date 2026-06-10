import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { lowerRule } from '../src/commands/test-corpus.js';
import { buildInstallPlan } from '../src/runtime/installer-engine.js';

// A pak-iostore-shaped installer: matches .utoc, but `unless` excludes archives that
// also ship a .pak (those belong to the lower-priority `pak` installer). Regression
// guard: `lowerRule` must carry `unless` through, or the corpus mis-routes .pak+.utoc
// archives and every validator built on it sees the wrong installer.
const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: pak-iostore
    priority: 29
    when: { hasFile: "**/*.utoc" }
    unless: { hasFile: "**/*.pak" }
    anchor: "**/*.utoc"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');

describe('lowerRule', () => {
  it('carries `unless` through so the corpus honors it', () => {
    const rule = lowerRule(doc.installers![0]!);
    expect(rule.unless).toBeDefined();

    const ctx = { archivePaths: [], vars: {} };

    // .utoc alone → `when` matches, `unless` does not → installs.
    const utocOnly = buildInstallPlan(rule, ['Mod/x.utoc'], { ...ctx, archivePaths: ['Mod/x.utoc'] });
    expect(utocOnly.length).toBeGreaterThan(0);

    // .utoc + .pak → `unless` fires → no plan (defers to the pak installer).
    const withPak = ['Mod/x.utoc', 'Mod/x.pak'];
    const excluded = buildInstallPlan(rule, withPak, { ...ctx, archivePaths: withPak });
    expect(excluded).toEqual([]);
  });
});
