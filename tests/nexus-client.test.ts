import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listGameModIds, listModFiles, getDownloadUrl, type NexusFile } from '../src/nexus/client.js';

const mkRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Nexus client', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(()  => { vi.restoreAllMocks(); });

  it('listGameModIds: collects mod ids from updated.json paginated requests', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('updated.json?period=1m')) {
        return mkRes([
          { mod_id: 100, latest_file_update: 1 },
          { mod_id: 101, latest_file_update: 1 },
        ]);
      }
      return mkRes([], 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const ids = await listGameModIds({ gameDomain: 'subnautica2', apiKey: 'k' });
    expect(ids).toEqual([100, 101]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/games/subnautica2/mods/updated.json?period=1m'),
      expect.objectContaining({ headers: expect.objectContaining({ apikey: 'k' }) }),
    );
  });

  it('listModFiles: returns the files array for a mod', async () => {
    const fetchMock = vi.fn(async () =>
      mkRes({ files: [{ file_id: 7, file_name: 'CoolPak-1.0.zip', version: '1.0', size_kb: 12 }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const files: NexusFile[] = await listModFiles({ gameDomain: 'subnautica2', apiKey: 'k', modId: 100 });
    expect(files).toEqual([{ fileId: 7, fileName: 'CoolPak-1.0.zip', version: '1.0', sizeKb: 12 }]);
  });

  it('getDownloadUrl: returns the first CDN URL', async () => {
    const fetchMock = vi.fn(async () =>
      mkRes([{ URI: 'https://cdn.example/CoolPak.zip', name: 'CDN1' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await getDownloadUrl({ gameDomain: 'subnautica2', apiKey: 'k', modId: 100, fileId: 7 });
    expect(url).toBe('https://cdn.example/CoolPak.zip');
  });

  it('returns empty arrays / throws on auth failures', async () => {
    const fetchMock = vi.fn(async () => mkRes({ message: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listModFiles({ gameDomain: 'x', apiKey: 'bad', modId: 1 }))
      .rejects.toThrow(/401|unauthor/i);
  });
});
