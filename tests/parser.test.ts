import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from '../src/parser/index.js';
import type { FileVersionNode } from '../src/parser/ast.js';

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

  it('parses toolbarActions with !openFile and !openUrl', () => {
    const doc = parseYaml(fixture('with-toolbar/game.yaml'), 'with-toolbar/game.yaml');
    expect(doc.toolbarActions).toHaveLength(2);
    const [a, b] = doc.toolbarActions!;
    expect(a!.id).toBe('open-settings');
    expect(a!.title).toBe('Open Settings');
    expect(a!.priority).toBe(200);
    expect(a!.target).toEqual({ kind: 'openFile', template: '${modsRoot}/settings.ini' });
    expect(b!.target).toEqual({ kind: 'openUrl', template: 'https://example.com/${gameId}' });
  });

  it('parses nexus block with modId, fileGroupId, displayName', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: Hello World Support for Vortex
`, 'inline.yaml');
    expect(doc.nexus).toBeDefined();
    expect(doc.nexus!.modId).toBe(1234);
    expect(doc.nexus!.fileGroupId).toBe(7418978);
    expect(doc.nexus!.displayName).toBe('Hello World Support for Vortex');
  });

  it('parses installer with unless predicate', () => {
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
  - id: pak
    priority: 30
    when: { hasFile: "**/*.pak" }
    unless:
      any:
        - { hasFile: "**/LogicMods/**" }
        - { hasFile: "**/Scripts/*.lua" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.unless).toBeDefined();
    expect(inst.unless!.kind).toBe('any');
    if (inst.unless!.kind !== 'any') return;
    expect(inst.unless!.arms).toHaveLength(2);
    expect(inst.unless!.arms[0]).toMatchObject({ kind: 'hasFile' });
    expect(inst.unless!.arms[1]).toMatchObject({ kind: 'hasFile' });
  });

  it('leaves unless undefined when the YAML omits it', () => {
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
  - id: pak
    priority: 30
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    expect(doc.installers![0]!.unless).toBeUndefined();
  });

  it('parses take: archive-root', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: root, name: Root, path: /game }
installers:
  - id: root
    priority: 23
    when: { hasFile: "**/Subnautica2/**" }
    anchor: "**/*"
    take: archive-root
    placeAt: /game
    modType: root
`, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.single!.take).toBe('archive-root');
  });

  it('parses setup.ensureDirs', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  paksRoot:  \${installPath}/Mods/Paks
  logicRoot: \${installPath}/Mods/Logic
setup:
  ensureDirs:
    - \${paksRoot}
    - \${logicRoot}
`, 'inline.yaml');
    expect(doc.setup).toBeDefined();
    expect(doc.setup!.ensureDirs).toEqual(['${paksRoot}', '${logicRoot}']);
  });

  it('parses events.did-deploy with !hook reference', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
events:
  did-deploy: { hook: regenerateMetadata }
`, 'inline.yaml');
    expect(doc.events).toBeDefined();
    expect(doc.events!.didDeploy).toBeDefined();
    expect(doc.events!.didDeploy!.kind).toBe('hookRef');
    expect(doc.events!.didDeploy!.hookId).toBe('regenerateMetadata');
  });

  it('parses installer with scope.stores', () => {
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
  - id: xbox-only
    priority: 30
    when: { hasFile: "**/*.pak" }
    scope:
      stores: [xbox]
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.scope).toBeDefined();
    expect(inst.scope!.stores).toEqual(['xbox']);
  });

  it('leaves installer.scope undefined when the YAML omits it', () => {
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
  - id: pak
    priority: 30
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    expect(doc.installers![0]!.scope).toBeUndefined();
  });

  it('parses object-form { hasFile: pattern }', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak, path: /a }
installers:
  - id: pak
    priority: 30
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    expect(doc.installers![0]!.when.kind).toBe('hasFile');
  });

  it('parses object-form { any: [...] } combinator', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak, path: /a }
installers:
  - id: pak
    priority: 30
    when:
      any:
        - { hasFile: "**/a" }
        - { hasFile: "**/b" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    const w = doc.installers![0]!.when;
    expect(w.kind).toBe('any');
    if (w.kind !== 'any') return;
    expect(w.arms).toHaveLength(2);
    expect(w.arms[0]!.kind).toBe('hasFile');
  });

  it('parses object-form { not: <predicate> } combinator', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak, path: /a }
installers:
  - id: pak
    priority: 30
    when:
      not:
        hasFile: "**/skip"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    const w = doc.installers![0]!.when;
    expect(w.kind).toBe('not');
  });

  it('rejects object-form predicates with multiple discriminator keys', () => {
    expect(() => parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak, path: /a }
installers:
  - id: pak
    priority: 30
    when:
      hasFile: "**/*.pak"
      any:
        - { hasFile: a }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml')).toThrow();
  });

  it('parses object-form { storeBranch: {...} } in context', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
context:
  archRoot:
    storeBranch:
      xbox: /xbox/path
      default: /default/path
`, 'inline.yaml');
    const binding = doc.context!.bindings.find(b => b.name === 'archRoot')!;
    expect(binding.value.kind).toBe('storeBranch');
  });

  it('parses object-form { osBranch: {...} } in context', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
context:
  modRoot:
    osBranch:
      windows: /win
      macos: /mac
      linux: /lin
      default: /lin
`, 'inline.yaml');
    const binding = doc.context!.bindings.find(b => b.name === 'modRoot')!;
    expect(binding.value.kind).toBe('osBranch');
  });

  it('parses object-form { hook: name } in discovery.version', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
discovery:
  version: { hook: detectGameVersion }
`, 'inline.yaml');
    expect(doc.discovery?.version?.kind).toBe('hookRef');
  });

  it('parses file+regex form in discovery.version', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
discovery:
  version:
    file: "\${installPath}/Main.mod/Settings/GameVersion.setting"
    regex: "=VersionPrefix:(\\\\d+\\\\.\\\\d+\\\\.\\\\d+)"
`, 'inline.yaml');
    expect(doc.discovery?.version?.kind).toBe('fileVersion');
    const v = doc.discovery!.version! as FileVersionNode;
    expect(v.file).toBe('${installPath}/Main.mod/Settings/GameVersion.setting');
    expect(v.regex).toBe('=VersionPrefix:(\\d+\\.\\d+\\.\\d+)');
  });

  it('rejects discovery.version with neither hook nor file', () => {
    expect(() => parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
discovery:
  version: { unknown: foo }
`, 'inline.yaml')).toThrow();
  });

  it('rejects discovery.version with file but no regex', () => {
    expect(() => parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
discovery:
  version:
    file: "some/path.txt"
`, 'inline.yaml')).toThrow();
  });

  it('parses discovery.steamName', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
stores:
  steam: "207170"
discovery:
  steamName: "Legend of Grimrock"
`, 'inline.yaml');
    expect(doc.discovery?.steamName).toBe('Legend of Grimrock');
  });

  it('parses discovery.registry probes in declared order', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
discovery:
  registry:
    - { hive: HKLM, key: 'Software\\CD Project Red\\Witcher', value: 'InstallFolder' }
    - { hive: HKCU, key: 'Software\\Foo', value: 'Path' }
`, 'inline.yaml');
    expect(doc.discovery?.registry).toHaveLength(2);
    expect(doc.discovery?.registry?.[0]).toMatchObject({
      hive: 'HKLM', key: 'Software\\CD Project Red\\Witcher', value: 'InstallFolder',
    });
    expect(doc.discovery?.registry?.[1]).toMatchObject({ hive: 'HKCU', key: 'Software\\Foo', value: 'Path' });
  });

  it('rejects discovery.registry with an unknown hive', () => {
    expect(() => parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
discovery:
  registry:
    - { hive: HKEY_LOCAL_MACHINE, key: 'Software\\Foo', value: 'Path' }
`, 'inline.yaml')).toThrow();
  });

  it('parses object-form { hook: name } in events.did-deploy', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
events:
  did-deploy: { hook: regenerateModsTxt }
`, 'inline.yaml');
    expect(doc.events?.didDeploy?.kind).toBe('hookRef');
  });

  it('parses object-form { openFile: path } in toolbar action target', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
toolbarActions:
  - id: open-settings
    title: Open Settings
    priority: 100
    target: { openFile: "/path/to/settings.ini" }
`, 'inline.yaml');
    expect(doc.toolbarActions![0]!.target).toEqual({
      kind: 'openFile',
      template: '/path/to/settings.ini',
    });
  });

  it('parses object-form { openUrl: url } in toolbar action target', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
toolbarActions:
  - id: open-nexus
    title: Open Nexus
    priority: 100
    target: { openUrl: "https://nexusmods.com" }
`, 'inline.yaml');
    expect(doc.toolbarActions![0]!.target).toEqual({
      kind: 'openUrl',
      template: 'https://nexusmods.com',
    });
  });

  it('parses game.nexusDomain when present', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
  nexusDomain: subnautica2
`, 'inline.yaml');
    expect(doc.game.nexusDomain).toBe('subnautica2');
  });

  it('leaves game.nexusDomain undefined when omitted', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`, 'inline.yaml');
    expect(doc.game.nexusDomain).toBeUndefined();
  });

  it('rejects tag-form YAML (tags no longer supported)', () => {
    expect(() => parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak, path: /a }
installers:
  - id: pak
    priority: 30
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml')).toThrow();
  });
});
