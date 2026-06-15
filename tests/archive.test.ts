import { describe, it, expect } from 'vitest';
import { join, basename } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readZipEntries } from '../src/corpus/archive.js';
import { readManifestEntries, readArchiveEntries } from '../src/corpus/archive.js';

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
    // localCachePaths returns native paths (they feed filesystem reads); use
    // basename rather than splitting on '/' so this passes on Windows too.
    expect(paths.map(p => basename(p))).toEqual(['a.zip', 'b.zip']);
  });

  it('returns empty list if cache dir does not exist', async () => {
    const { localCachePaths } = await import('../src/corpus/archive.js');
    const dir = mkdtempSync(join(tmpdir(), 'gdl-cache-empty-'));
    expect(localCachePaths(dir)).toEqual([]);
  });
});

describe('readManifestEntries', () => {
  it('parses a PreviewDirectory JSON manifest into a sorted file list', async () => {
    const manifestPath = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.json');
    expect(readManifestEntries(manifestPath)).toEqual([
      'MyMod/CoolPak.pak',
      'MyMod/Readme.md',
    ]);
  });
});

describe('readArchiveEntries (dispatch)', () => {
  it('dispatches .zip to readZipEntries', async () => {
    const zipPath = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    expect(readArchiveEntries(zipPath)).toEqual([
      'MyMod/CoolPak.pak',
      'MyMod/Readme.md',
    ]);
  });

  it('dispatches .json to readManifestEntries', async () => {
    const jsonPath = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.json');
    expect(readArchiveEntries(jsonPath)).toEqual([
      'MyMod/CoolPak.pak',
      'MyMod/Readme.md',
    ]);
  });
});
