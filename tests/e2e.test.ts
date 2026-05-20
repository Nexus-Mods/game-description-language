import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExtension } from '../src/commands/build.js';


describe('end-to-end', () => {
  it('builds a hello-world extension from yaml to bundle', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-e2e-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });

    await buildExtension({ cwd: work });

    expect(existsSync(join(work, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'info.json'))).toBe(true);

    const info = JSON.parse(readFileSync(join(work, 'dist', 'info.json'), 'utf8'));
    expect(info).toMatchObject({ id: 'helloworld', name: 'Hello World', version: '0.1.0' });

    const bundle = readFileSync(join(work, 'dist', 'extension.js'), 'utf8');
    expect(bundle).toMatch(/helloworld/);
    expect(bundle).toMatch(/Pak Mod/);
    expect(bundle).toMatch(/registerInstaller/);
    expect(bundle).toMatch(/["']pak["']/);            // installer id
    expect(bundle).toMatch(/\*\*\/\*\.pak/);   // the glob made it through

    // tests.gen.ts emitted alongside the other artifacts
    const testsGenPath = join(work, '.gdl-out', 'tests.gen.ts');
    expect(existsSync(testsGenPath)).toBe(true);
    const testsGen = readFileSync(testsGenPath, 'utf8');
    expect(testsGen).toContain("describe('helloworld — generated tests'");
    expect(testsGen).toContain("it('typical pak mod'");
    expect(testsGen).toContain('/games/Hello/Mods/Paks/CoolPak.pak');
  }, 60000);
});

describe('end-to-end (subnautica2-shaped)', () => {
  it('builds a subnautica2-shaped extension', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-sub2-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'subnautica2-shaped'), work, { recursive: true });

    await buildExtension({ cwd: work });

    expect(existsSync(join(work, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'extension.js.map'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'info.json'))).toBe(true);

    const bundle = readFileSync(join(work, 'dist', 'extension.js'), 'utf8');
    expect(bundle).toMatch(/registerInstaller/);
    expect(bundle).toMatch(/['"]ue4ss-lua['"]/);
    expect(bundle).toMatch(/['"]logic-mod['"]/);
    expect(bundle).toMatch(/['"]composite-mod['"]/);
    expect(bundle).toMatch(/detectGameVersion/);

    const testsGen = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGen).toContain("describe('subnautica2-shaped — generated tests'");
    expect(testsGen).toContain("it('ue4ss lua mod'");
    expect(testsGen).toContain("it('logic-mod under LogicMods/'");
    expect(testsGen).toContain("it('plain pak mod'");
    expect(testsGen).toContain("it('composite — pak + lua picks composite installer'");
  }, 90000);
});

describe('end-to-end (corpus runner)', () => {
  it('runs all archives in tests/cache through the engine', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-corpus-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });
    const cacheDir = join(work, 'tests', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    cpSync(
      join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip'),
      join(cacheDir, 'typical-pak.zip'),
    );

    const { runTestCorpus } = await import('../src/commands/test-corpus.js');
    await runTestCorpus({ cwd: work });
    // If we got here without process.exit, the corpus run passed without failures.
  }, 30000);

  it('also runs JSON-manifest archives', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-corpus-json-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });
    const cacheDir = join(work, 'tests', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    cpSync(
      join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.json'),
      join(cacheDir, 'typical-pak.json'),
    );

    const { runTestCorpus } = await import('../src/commands/test-corpus.js');
    await runTestCorpus({ cwd: work });
  }, 30000);
});
