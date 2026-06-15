import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, existsSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildExtension } from '../src/commands/build.js';


describe('end-to-end', () => {
  it('builds a hello-world extension from yaml to bundle', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-e2e-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });

    await buildExtension({ cwd: work });

    expect(existsSync(join(work, 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'info.json'))).toBe(true);

    const info = JSON.parse(readFileSync(join(work, 'dist', 'info.json'), 'utf8'));
    expect(info).toMatchObject({ id: 'helloworld', name: 'Hello World', version: '0.1.0' });

    const bundle = readFileSync(join(work, 'dist', 'index.js'), 'utf8');
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

    expect(existsSync(join(work, 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'index.js.map'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'info.json'))).toBe(true);

    const bundle = readFileSync(join(work, 'dist', 'index.js'), 'utf8');
    expect(bundle).toMatch(/registerInstaller/);
    expect(bundle).toMatch(/['"]ue4ss-lua['"]/);
    expect(bundle).toMatch(/['"]logic-mod['"]/);
    expect(bundle).toMatch(/['"]composite-mod['"]/);
    expect(bundle).toMatch(/detectGameVersion/);
    expect(bundle).toMatch(/registerAction/);
    expect(bundle).toMatch(/['"]open-ue4ss-settings['"]/);
    expect(bundle).toMatch(/['"]open-mods-txt['"]/);
    expect(bundle).toMatch(/['"]open-nexus-page['"]/);


    const testsGen = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGen).toContain("describe('subnautica2-shaped — generated tests'");
    expect(testsGen).toContain("it('ue4ss lua mod'");
    expect(testsGen).toContain("it('logic-mod under LogicMods/'");
    expect(testsGen).toContain("it('plain pak mod'");
    expect(testsGen).toContain("it('composite — pak + lua picks composite installer'");

    const testsGenWithUnless = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGenWithUnless).toContain("it('pak archive with LogicMods present routes to logic-mod (not pak)'");
    expect(testsGenWithUnless).toContain("it('pak archive with Scripts present routes to ue4ss-lua (not pak)'");
    expect(bundle).toMatch(/unless\s*:/);

    const testsGenInjector = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGenInjector).toContain("it('ue4ss injector — single marker at archive root'");
    expect(testsGenInjector).toContain("it('ue4ss injector — marker in a subfolder; sibling files dropped'");
    expect(testsGenInjector).toContain("it('ue4ss injector — case-insensitive marker match'");
    expect(bundle).toMatch(/['"]ue4ss-injector['"]/);

    const testsGenRoot = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGenRoot).toContain("it('enabled.txt-only ue4ss mod preserves mod-name in destination'");
    expect(testsGenRoot).toContain("it('ue4ss lua with Scripts preserves mod-name in destination'");
    expect(testsGenRoot).toContain("it('root installer takes whole game-folder archives as-is'");
    expect(bundle).toMatch(/['"]root['"]/);
    expect(bundle).toMatch(/['"]ue4ss-lua-enabled['"]/);
    expect(bundle).toMatch(/archive-root/);

    expect(bundle).toMatch(/ensureDirWritableAsync/);
    expect(bundle).toMatch(/events\.on\(['"]did-deploy['"]/);
    expect(bundle).toMatch(/regenerateModsTxt/);

    expect(bundle).toMatch(/['"]xbox-injector-placeholder['"]/);
    expect(bundle).toMatch(/scope:\s*\{\s*stores:\s*\[\s*['"]xbox['"]\s*\]\s*\}/);
  }, 90000);
});

describe('end-to-end (generated tests run)', () => {
  it('vitest can execute the generated tests.gen.ts and the inline cases pass', async (ctx) => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-run-tests-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });

    // Symlink <work>/gdl → the GDL repo root so the relative
    // `../gdl/src/runtime/index.js` import in tests.gen.ts resolves.
    const gdlRoot = resolve(import.meta.dirname, '..');
    try {
      symlinkSync(gdlRoot, join(work, 'gdl'), 'dir');
    } catch (e) {
      // Windows requires admin/Developer Mode to create symlinks. Skip there
      // rather than fail; this test still runs fully in (Linux) CI.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return ctx.skip();
      throw e;
    }

    // Build the extension; this emits .gdl-out/tests.gen.ts.
    await buildExtension({ cwd: work });
    expect(existsSync(join(work, '.gdl-out', 'tests.gen.ts'))).toBe(true);

    // Vitest needs a config in the work dir; create a minimal one.
    const vitestConfig = `import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['.gdl-out/tests.gen.ts'], globals: false },
});
`;
    writeFileSync(join(work, 'vitest.config.ts'), vitestConfig);

    // Run vitest using the GDL repo's vitest binary (reachable via the gdl symlink).
    const vitestBin = join(work, 'gdl', 'node_modules', '.bin', 'vitest');
    const result = spawnSync(vitestBin, ['run'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    // Diagnostics on failure
    if (result.status !== 0) {
      console.error('vitest stdout:\n' + (result.stdout ?? ''));
      console.error('vitest stderr:\n' + (result.stderr ?? ''));
    }
    expect(result.status).toBe(0);
  }, 60000);
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

describe('end-to-end (package)', () => {
  it('gdl package produces out/<id>-vortex-v<version>.zip', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-package-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });

    const { packageExtension } = await import('../src/commands/package.js');
    const result = await packageExtension({ cwd: work });
    expect(result.archivePath.endsWith('helloworld-vortex-v0.1.0.zip')).toBe(true);
    expect(existsSync(result.archivePath)).toBe(true);

    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(result.archivePath);
    const names = zip.getEntries().map(e => e.entryName).sort();
    // dist/ contains index.js + index.js.map + info.json (per current emit).
    expect(names).toContain('index.js');
    expect(names).toContain('info.json');
  }, 60000);
});
