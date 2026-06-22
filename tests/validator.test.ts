import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { validate } from '../src/schema/validator.js';

const tinyDoc = (yaml: string) => parseYaml(yaml, 'inline.yaml');

describe('validate', () => {
  it('accepts a minimal valid document', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
`);
    expect(validate(doc)).toEqual([]);
  });

  it('rejects unsupported schema version', () => {
    const doc = tinyDoc(`
gdl: 99
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
`);
    const errors = validate(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('GDL100');
  });

  it('rejects malformed game id', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: Hello_World
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL101')).toBe(true);
  });

  it('rejects duplicate modType ids', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: A, path: /a }
  - { id: pak, name: B, path: /b }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL102')).toBe(true);
  });

  it('rejects installer with undeclared modType', () => {
    const doc = tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: ue4ss-lua
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL110')).toBe(true);
  });

  it('rejects duplicate installer ids', () => {
    const doc = tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
  - id: pak
    priority: 20
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL111')).toBe(true);
  });

  it('rejects installer that has both single form and route form', () => {
    // Built by mutating a parsed doc since the parser picks one based on `route:` presence.
    const doc = tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`);
    (doc.installers![0]! as { route?: unknown }).route = [];
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL112')).toBe(true);
  });

  it('rejects test case with empty name', () => {
    const doc = tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
tests:
  corpus: off
  cases:
    - name: ""
      archive: ["x.pak"]
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL120')).toBe(true);
  });

  it('rejects test case with empty archive', () => {
    const doc = tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
tests:
  corpus: off
  cases:
    - name: case1
      archive: []
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL121')).toBe(true);
  });

  it('rejects expect.matched referencing undeclared installer', () => {
    const doc = tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
tests:
  corpus: off
  cases:
    - name: case1
      archive: [a.pak]
      expect: { matched: ue4ss-lua }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL122')).toBe(true);
  });

  it('rejects nexus block with missing modId', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 0
  fileGroupId: 7418978
  displayName: Hello
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL130')).toBe(true);
  });

  it('rejects nexus block with missing displayName', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: ""
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL132')).toBe(true);
  });

  it('rejects toolbar action with empty title', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - id: x
    title: ""
    priority: 100
    target: { openUrl: "https://x" }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL142')).toBe(true);
  });

  it('rejects duplicate toolbar action ids', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - { id: dup, title: A, priority: 100, target: { openUrl: "https://a" } }
  - { id: dup, title: B, priority: 101, target: { openUrl: "https://b" } }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL143')).toBe(true);
  });

  it('rejects malformed toolbar action id', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - { id: "Bad Id", title: A, priority: 100, target: { openUrl: "https://a" } }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL144')).toBe(true);
  });

  it('rejects setup.ensureDirs with empty entry', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
setup:
  ensureDirs:
    - ""
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL152')).toBe(true);
  });

  it('accepts setup.ensureDirs with non-empty templates', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
setup:
  ensureDirs:
    - \${installPath}/Mods
`);
    const errors = validate(doc);
    expect(errors).toEqual([]);
  });

  const docWithValidator = (assertYaml: string) => tinyDoc(`
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
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
validators:
  - id: pak-placement
    name: pak placement
    when: { hasFile: "**/*.pak" }
    assert:
${assertYaml}
`);

  it('accepts a validator with a well-formed placement assertion', () => {
    const doc = docWithValidator(`      placement:
        - files: "**/*.pak"
          mustMatch: "**/Paks/**"
          mustNotMatch: "\${installPath}/*"`);
    expect(validate(doc)).toEqual([]);
  });

  it('rejects a placement entry missing files (GDL174)', () => {
    const doc = docWithValidator(`      placement:
        - mustMatch: "**/Paks/**"`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL174')).toBe(true);
  });

  it('rejects a placement entry with neither mustMatch nor mustNotMatch (GDL175)', () => {
    const doc = docWithValidator(`      placement:
        - files: "**/*.pak"`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL175')).toBe(true);
  });

  it('accepts events.did-deploy with hook reference', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
events:
  did-deploy: { hook: regenerateMetadata }
`);
    const errors = validate(doc);
    expect(errors).toEqual([]);
  });

  // GDL114: an installer's placeAt is only the TEST-time deploy root; at runtime
  // Vortex deploys to the matched modType's `path` (+ the stripped relative path).
  // If they resolve differently the test harness passes while the real install
  // lands in the wrong folder (e.g. a doubled LogicMods/LogicMods). Catch it at
  // build time.
  it('rejects an installer whose placeAt resolves differently from its modType path', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
context:
  paksPath: \${installPath}/Content/Paks
  logicPath: \${installPath}/Content/Paks/LogicMods
modTypes:
  - { id: logic, name: Logic, path: "\${logicPath}" }
installers:
  - id: logicmods
    priority: 20
    when: { hasFile: "**/LogicMods/**" }
    anchor: "**/LogicMods/"
    take: self
    placeAt: "\${paksPath}"
    modType: logic
`);
    const errors = validate(doc);
    expect(errors.map(e => e.code)).toContain('GDL114');
  });

  it('accepts an installer whose placeAt matches its modType path', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
context:
  logicPath: \${installPath}/Content/Paks/LogicMods
modTypes:
  - { id: logic, name: Logic, path: "\${logicPath}" }
installers:
  - id: logicmods
    priority: 20
    when: { hasFile: "**/LogicMods/**" }
    anchor: "**/LogicMods/"
    take: self
    placeAt: "\${logicPath}"
    modType: logic
`);
    expect(validate(doc).map(e => e.code)).not.toContain('GDL114');
  });

  // placeAt "." (or empty) means "defer to the modType path" — the runtime
  // already deploys to the modType path, so "." can never disagree with it. It
  // only opts the test out of asserting an absolute destination, so it must NOT
  // trip GDL114 (unlike a concrete placeAt that resolves to a different folder).
  it('does not flag GDL114 when placeAt is "." (defers to the modType path)', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
context:
  modRoot: \${appDataLocalLow}/Game/Game
modTypes:
  - { id: mod, name: Mod, path: "\${modRoot}" }
installers:
  - id: mod
    priority: 20
    when: { hasFile: "**/Main.mod/**" }
    anchor: "**/Main.mod/"
    take: parent
    placeAt: "."
    modType: mod
`);
    expect(validate(doc).map(e => e.code)).not.toContain('GDL114');
  });
});

describe('validate — discovery', () => {
  const head = `
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`;

  it('accepts well-formed registry probes and steamName', () => {
    const doc = tinyDoc(`${head}
discovery:
  steamName: "Legend of Grimrock"
  registry:
    - { hive: HKLM, key: 'Software\\Foo', value: 'Path' }
`);
    expect(validate(doc)).toEqual([]);
  });

  it('rejects a registry probe with an empty key', () => {
    const doc = tinyDoc(`${head}
discovery:
  registry:
    - { hive: HKLM, key: '', value: 'Path' }
`);
    expect(validate(doc).map(e => e.code)).toContain('GDL065');
  });

  it('rejects a registry probe with an empty value', () => {
    const doc = tinyDoc(`${head}
discovery:
  registry:
    - { hive: HKLM, key: 'Software\\Foo', value: '' }
`);
    expect(validate(doc).map(e => e.code)).toContain('GDL066');
  });

  it('rejects an empty steamName', () => {
    const doc = tinyDoc(`${head}
discovery:
  steamName: "  "
`);
    expect(validate(doc).map(e => e.code)).toContain('GDL068');
  });
});
