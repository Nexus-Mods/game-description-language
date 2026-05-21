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

describe('emit installer with unless', () => {
  const WITH_UNLESS = `
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
    when: !hasFile "**/*.pak"
    unless: !hasFile "**/LogicMods/**"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`;

  it('emits unless field on installer when present', () => {
    const doc = parseYaml(WITH_UNLESS, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).toMatch(/unless:\s*\{ kind: 'hasFile', glob: '\*\*\/LogicMods\/\*\*' \}/);
  });

  it('does not emit unless when the YAML omits it', () => {
    const noUnless = `
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: pak
    priority: 30
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`;
    const doc = parseYaml(noUnless, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).not.toMatch(/\bunless\s*:/);
  });
});

describe('emit installer with take: archive-root', () => {
  const WITH_ARCHIVE_ROOT = `
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
    when: !hasFile "**/Subnautica2/**"
    anchor: "**/*"
    take: archive-root
    placeAt: /game
    modType: root
`;

  it("emits take: 'archive-root' as a single-quoted string literal", () => {
    const doc = parseYaml(WITH_ARCHIVE_ROOT, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).toMatch(/take:\s*'archive-root'/);
  });
});

describe('emit setup + events', () => {
  it('emits setupDirs array when setup.ensureDirs is present', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  paksRoot: \${installPath}/Mods/Paks
setup:
  ensureDirs:
    - \${paksRoot}
    - \${installPath}/Mods/Logic
`, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain("'${paksRoot}'");
    expect(ext.contents).toContain("'${installPath}/Mods/Logic'");
  });

  it('emits eventHooks.didDeploy as a reference to the imported hook', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
events:
  did-deploy: !hook regenerateMetadata
`, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toMatch(/import\s+\{[^}]*regenerateMetadata[^}]*\}\s+from\s+['"]\.\.\/src\/hooks/);
    expect(ext.contents).toMatch(/didDeploy:\s*regenerateMetadata/);
  });

  it('emits empty setupDirs and empty eventHooks when neither block is present', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    // Should still build cleanly with empty 8th/9th args
    expect(ext.contents).toMatch(/\[\s*\]/);   // empty array somewhere (setupDirs)
    expect(ext.contents).toMatch(/\{\s*\}/);   // empty object somewhere (eventHooks)
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
