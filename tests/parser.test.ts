import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from '../src/parser/index.js';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('parseYaml', () => {
  it('parses minimal document', () => {
    const doc = parseYaml(fixture('minimal.yaml'), 'minimal.yaml');
    expect(doc.gdl).toBe(1);
    expect(doc.game.id).toBe('helloworld');
    expect(doc.game.name).toBe('Hello World');
    expect(doc.game.executable).toBe('HelloWorld.exe');
    expect(doc.game.requiredFiles).toEqual(['HelloWorld.exe']);
  });

  it('attaches source spans to nodes', () => {
    const doc = parseYaml(fixture('minimal.yaml'), 'minimal.yaml');
    expect(doc.game.span.file).toBe('minimal.yaml');
    expect(doc.game.span.line).toBe(2);
    expect(doc.game.span.column).toBe(1);
  });

  it('parses stores block', () => {
    const doc = parseYaml(fixture('with-stores.yaml'), 'with-stores.yaml');
    expect(doc.stores).toBeDefined();
    const byId = Object.fromEntries(doc.stores!.entries.map(e => [e.id, e.value]));
    expect(byId).toEqual({
      steam: 264710,
      epic: 'Subnautica2',
      xbox: 'Unknown.Subnautica2',
    });
  });

  it('parses context bindings with interpolation', () => {
    const doc = parseYaml(fixture('with-context.yaml'), 'with-context.yaml');
    expect(doc.context).toBeDefined();
    const byName = Object.fromEntries(doc.context!.bindings.map(b => [b.name, b.value]));
    expect(byName.modsRoot).toMatchObject({ kind: 'interpolated', template: '${installPath}/Mods' });
    expect(byName.literal).toMatchObject({ kind: 'literal', raw: 'hello' });
  });

  it('parses !storeBranch values', () => {
    const doc = parseYaml(fixture('with-context.yaml'), 'with-context.yaml');
    const byName = Object.fromEntries(doc.context!.bindings.map(b => [b.name, b.value]));
    const branch = byName.paksRoot;
    expect(branch.kind).toBe('storeBranch');
    if (branch.kind !== 'storeBranch') return;
    expect(branch.arms.xbox).toMatchObject({ kind: 'interpolated' });
    expect(branch.default).toMatchObject({ kind: 'interpolated' });
  });

  it('parses modTypes block', () => {
    const doc = parseYaml(fixture('with-modtypes.yaml'), 'with-modtypes.yaml');
    expect(doc.modTypes).toHaveLength(2);
    expect(doc.modTypes![0].id).toBe('pak');
    expect(doc.modTypes![0].name).toBe('Pak Mod');
    expect(doc.modTypes![0].path).toMatchObject({ kind: 'interpolated', template: '${modsRoot}' });
  });

  it('parses installers with !hasFile predicate', () => {
    const doc = parseYaml(fixture('with-installer.yaml'), 'with-installer.yaml');
    expect(doc.installers).toHaveLength(1);
    const i = doc.installers![0]!;
    expect(i.id).toBe('pak');
    expect(i.priority).toBe(10);
    expect(i.when).toMatchObject({ kind: 'hasFile' });
    if (i.when.kind !== 'hasFile') return;
    expect(i.when.pattern).toMatchObject({ kind: 'glob', pattern: '**/*.pak' });
    expect(i.single).toBeDefined();
    expect(i.single!.anchor).toMatchObject({ kind: 'glob', pattern: '**/*.pak' });
    expect(i.single!.take).toBe('parent');
    expect(i.single!.placeAt).toMatchObject({ kind: 'interpolated', template: '${modsRoot}' });
    expect(i.modType).toBe('pak');
  });

  it('parses discovery.version hook reference', () => {
    const doc = parseYaml(fixture('with-hook.yaml'), 'with-hook.yaml');
    expect(doc.discovery).toBeDefined();
    expect(doc.discovery!.version).toMatchObject({ kind: 'hookRef', hookId: 'detectGameVersion' });
  });

  it('parses tests block with inline cases', () => {
    const doc = parseYaml(fixture('with-tests/game.yaml'), 'with-tests/game.yaml');
    expect(doc.tests).toBeDefined();
    expect(doc.tests!.corpus).toBe('off');
    expect(doc.tests!.cases).toHaveLength(1);
    const c = doc.tests!.cases[0]!;
    expect(c.name).toBe('typical pak mod');
    expect(c.archive).toEqual(['MyMod/CoolPak.pak', 'MyMod/Readme.md']);
    expect(c.expect).toBeDefined();
    expect(c.expect!.matched).toBe('pak');
    expect(c.expect!.modType).toBe('pak');
    expect(c.expect!.plan).toEqual(['${modsRoot}/CoolPak.pak', '${modsRoot}/Readme.md']);
  });
});
