import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { emit } from '../src/codegen/emit.js';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TINY = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
stores:
  steam: 264710
modTypes:
  - { id: pak, name: Pak Mod, path: "${'${installPath}'}/Mods" }
`;

describe('emit', () => {
  it('emits an extension.ts that registers the game and a mod type', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path.endsWith('extension.ts'));
    expect(ext).toBeDefined();
    expect(ext!.contents).toContain("import { GdlRuntime } from '@gdl/runtime'");
    expect(ext!.contents).toContain("id: 'helloworld'");
    expect(ext!.contents).toContain("name: 'Pak Mod'");
    expect(ext!.contents).toContain("template: '${installPath}/Mods'");
  });

  it('emits info.json with id, name, version', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc, { extensionVersion: '0.1.0' });
    const info = files.find(f => f.path.endsWith('info.json'));
    expect(info).toBeDefined();
    const parsed = JSON.parse(info!.contents);
    expect(parsed).toMatchObject({ id: 'helloworld', name: 'Hello World', version: '0.1.0' });
  });
});

describe('writeEmittedFiles', () => {
  it('writes files to .gdl-out under the target dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-emit-'));
    const doc = parseYaml(TINY, 'tiny.yaml');
    const { writeEmittedFiles } = await import('../src/codegen/emit.js');
    await writeEmittedFiles(dir, emit(doc, { extensionVersion: '0.1.0' }));
    expect(existsSync(join(dir, '.gdl-out', 'extension.ts'))).toBe(true);
    const info = JSON.parse(readFileSync(join(dir, '.gdl-out', 'info.json'), 'utf8'));
    expect(info.version).toBe('0.1.0');
  });
});
