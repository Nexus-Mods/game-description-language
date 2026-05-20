import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
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
  }, 90000);
});
