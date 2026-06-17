import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the Nexus client so the corpus fetch never hits the network.
const mocks = vi.hoisted(() => ({
  fetchGames: vi.fn(),
  fetchPublishedModIds: vi.fn(),
  fetchModFiles: vi.fn(),
  fetchArchiveManifest: vi.fn(),
}));
vi.mock('../src/nexus/client.js', () => mocks);

import { fetchCorpus } from '../src/nexus/fetch-corpus.js';

describe('fetchCorpus --limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchGames.mockResolvedValue([{ id: 100, domain_name: 'testgame', name: 'Test' }]);
    mocks.fetchPublishedModIds.mockResolvedValue([1, 2, 3, 4, 5]);
    mocks.fetchModFiles.mockResolvedValue([
      { uid: 'u', uri: 'a.zip', fileId: 7, name: 'a', version: '1', category: 'MAIN', date: 1 },
    ]);
    mocks.fetchArchiveManifest.mockResolvedValue({ name: '', path: '', type: 'directory', children: [] });
  });

  const cache = (): string => mkdtempSync(join(tmpdir(), 'gdl-corpus-limit-'));

  it('caps the auto-discovered catalog to the limit', async () => {
    await fetchCorpus({ gameDomain: 'testgame', cacheDir: cache(), limit: 2 });
    expect(mocks.fetchPublishedModIds).toHaveBeenCalledTimes(1);
    // Only the first 2 of the 5 discovered mods are fetched.
    expect(mocks.fetchModFiles).toHaveBeenCalledTimes(2);
  });

  it('fetches the whole catalog when no limit is given', async () => {
    await fetchCorpus({ gameDomain: 'testgame', cacheDir: cache() });
    expect(mocks.fetchModFiles).toHaveBeenCalledTimes(5);
  });

  it('a limit larger than the catalog fetches everything', async () => {
    await fetchCorpus({ gameDomain: 'testgame', cacheDir: cache(), limit: 99 });
    expect(mocks.fetchModFiles).toHaveBeenCalledTimes(5);
  });

  it('limit also caps an explicit --mods list', async () => {
    await fetchCorpus({ gameDomain: 'testgame', cacheDir: cache(), modIds: [10, 11, 12], limit: 1 });
    expect(mocks.fetchPublishedModIds).not.toHaveBeenCalled();
    expect(mocks.fetchModFiles).toHaveBeenCalledTimes(1);
  });
});
