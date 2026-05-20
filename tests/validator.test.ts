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
    when: !hasFile "**/*.pak"
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
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
  - id: pak
    priority: 20
    when: !hasFile "**/*.pak"
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
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`);
    (doc.installers![0]! as { route?: unknown }).route = [];
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL112')).toBe(true);
  });
});
