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

describe('emit installers', () => {
  const TINY_INSTALLER = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: ${'${installPath}'}/Mods
modTypes:
  - { id: pak, name: Pak Mod, path: "${'${modsRoot}'}" }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: "${'${modsRoot}'}"
    modType: pak
`;

  it('emits installer registration in installers.gen.ts', () => {
    const doc = parseYaml(TINY_INSTALLER, 'tiny.yaml');
    const files = emit(doc);
    const installersGen = files.find(f => f.path === 'installers.gen.ts')!;
    expect(installersGen).toBeDefined();
    expect(installersGen.contents).toContain("id: 'pak'");
    expect(installersGen.contents).toContain("priority: 10");
    expect(installersGen.contents).toContain("kind: 'hasFile'");
    expect(installersGen.contents).toContain("pattern: '**/*.pak'");
    expect(installersGen.contents).toContain("take: 'parent'");
    expect(installersGen.contents).toContain("modType: 'pak'");
    // extension.ts should import rules from the generated file
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain("import { rules } from './installers.gen.js'");
    expect(ext.contents).toContain("rules,");
  });
});

describe('emit hooks', () => {
  const HOOKED = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
discovery:
  version: !hook detectGameVersion
`;

  it('emits hook import and passes version hook to registerGame', () => {
    const doc = parseYaml(HOOKED, 'hooked.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path.endsWith('extension.ts'))!;
    expect(ext.contents).toContain(`import * as hooks from '../src/hooks.js'`);
    expect(ext.contents).toContain(`versionHook: hooks.detectGameVersion`);
  });
});

describe('emit toolbar actions', () => {
  const TINY = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - id: open-settings
    title: Open Settings
    priority: 200
    target: !openFile /games/Hello/settings.ini
  - id: open-website
    title: Open Website
    priority: 201
    target: !openUrl https://example.com/x
`;

  it('emits toolbar action registrations in extension.ts', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain("id: 'open-settings'");
    expect(ext.contents).toContain("title: 'Open Settings'");
    expect(ext.contents).toContain("priority: 200");
    expect(ext.contents).toContain("kind: 'openFile'");
    expect(ext.contents).toContain("template: '/games/Hello/settings.ini'");
    expect(ext.contents).toContain("kind: 'openUrl'");
    expect(ext.contents).toContain("template: 'https://example.com/x'");
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
