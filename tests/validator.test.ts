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
});
