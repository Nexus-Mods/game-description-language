import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { zipDist, type ZipDistOptions } from '../src/packaging/zip.js';

describe('zipDist', () => {
  it('produces a zip containing dist/* at the archive root', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gdl-zip-'));
    mkdirSync(join(cwd, 'dist'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'extension.js'), 'console.log("x");');
    writeFileSync(join(cwd, 'dist', 'extension.js.map'), '{"version":3}');
    writeFileSync(join(cwd, 'dist', 'info.json'),     '{"id":"x","name":"X","version":"0.1.0"}');

    const opts: ZipDistOptions = { cwd, archiveName: 'x-v0.1.0.zip', outDir: 'out' };
    const path = await zipDist(opts);
    expect(path.endsWith('x-v0.1.0.zip')).toBe(true);
    expect(existsSync(path)).toBe(true);

    const zip = new AdmZip(path);
    const names = zip.getEntries().map(e => e.entryName).sort();
    expect(names).toEqual([
      'extension.js',
      'extension.js.map',
      'info.json',
    ]);
  });

  it('throws when dist/ does not exist', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gdl-zip-empty-'));
    await expect(
      zipDist({ cwd, archiveName: 'x.zip', outDir: 'out' })
    ).rejects.toThrow(/dist/);
  });
});
