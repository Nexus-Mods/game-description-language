import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
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
