import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readZipEntries } from '../src/corpus/archive.js';

describe('readZipEntries', () => {
  it('returns sorted POSIX paths from a zip file', () => {
    const archivePath = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const entries = readZipEntries(archivePath);
    expect(entries).toEqual([
      'MyMod/CoolPak.pak',
      'MyMod/Readme.md',
    ]);
  });
});

describe('localCachePaths', () => {
  it('lists *.zip files in tests/cache/', async () => {
    const { localCachePaths } = await import('../src/corpus/archive.js');
    const dir = mkdtempSync(join(tmpdir(), 'gdl-cache-'));
    mkdirSync(join(dir, 'tests', 'cache'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'cache', 'a.zip'), Buffer.from([]));
    writeFileSync(join(dir, 'tests', 'cache', 'b.zip'), Buffer.from([]));
    writeFileSync(join(dir, 'tests', 'cache', 'c.txt'), Buffer.from([])); // ignored
    const paths = localCachePaths(dir);
    expect(paths.map(p => p.split('/').pop())).toEqual(['a.zip', 'b.zip']);
  });

  it('returns empty list if cache dir does not exist', async () => {
    const { localCachePaths } = await import('../src/corpus/archive.js');
    const dir = mkdtempSync(join(tmpdir(), 'gdl-cache-empty-'));
    expect(localCachePaths(dir)).toEqual([]);
  });
});
