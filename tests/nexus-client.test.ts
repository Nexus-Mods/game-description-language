import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchGames, fetchModFiles, fetchArchiveManifest, flattenManifest, fetchPublishedModIds,
  type NexusGameEntry, type NexusModFile, type PreviewDirectory, type ModFileManifest,
} from '../src/nexus/client.js';

const mkRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Nexus client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(()  => vi.restoreAllMocks());

  it('fetchGames hits the games.json endpoint and returns the array', async () => {
    const fetchMock = vi.fn(async () => mkRes([
      { id: 3333, domain_name: 'subnautica2', name: 'Subnautica 2' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const games: NexusGameEntry[] = await fetchGames();
    expect(games).toEqual([{ id: 3333, domain_name: 'subnautica2', name: 'Subnautica 2' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://data.nexusmods.com/file/nexus-data/games.json',
      undefined,
    );
  });

  it('fetchModFiles posts GraphQL with modId/gameId variables and apikey header', async () => {
    const fetchMock = vi.fn(async () => mkRes({
      data: { modFiles: [
        { uid: 'u1', uri: 'CoolPak.zip', fileId: 7, name: 'CoolPak', version: '1.0', category: 'MAIN', date: 100 },
      ] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXUS_API_KEY = 'k';
    try {
      const files: NexusModFile[] = await fetchModFiles(3333, 100);
      expect(files).toHaveLength(1);
      expect(files[0]!.uri).toBe('CoolPak.zip');
      expect(files[0]!.category).toBe('MAIN');
      const call = fetchMock.mock.calls[0]!;
      expect(call[0]).toBe('https://api.nexusmods.com/v2/graphql');
      expect((call[1] as RequestInit).method).toBe('POST');
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers.apikey).toBe('k');
      expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({
        variables: { modId: '100', gameId: '3333' },
      });
    } finally {
      delete process.env.NEXUS_API_KEY;
    }
  });

  it('fetchArchiveManifest looks up manifest_url on v3, then fetches it', async () => {
    const manifest: ModFileManifest = {
      version: 1,
      files: [{ file_path: 'MyMod/CoolPak.pak', file_size: 1024, file_hashes: { MD5: 'abc' } }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mkRes({ data: { manifest_url: 'https://mod-file-manifests.nexusmods.com/0b/88/96/x' } }))
      .mockResolvedValueOnce(mkRes(manifest));
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXUS_API_KEY = 'k';
    try {
      expect(await fetchArchiveManifest('subnautica2', 7)).toEqual(manifest);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.nexusmods.com/v3/games/subnautica2/mod-file-versions/7');
      expect((init as RequestInit).headers).toMatchObject({ apikey: 'k' });
      expect(fetchMock.mock.calls[1]![0]).toBe('https://mod-file-manifests.nexusmods.com/0b/88/96/x');
    } finally {
      delete process.env.NEXUS_API_KEY;
    }
  });

  it('fetchArchiveManifest throws when the file has no manifest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ data: { manifest_url: null } })));
    process.env.NEXUS_API_KEY = 'k';
    try {
      await expect(fetchArchiveManifest('subnautica2', 7)).rejects.toThrow(/no manifest/);
    } finally {
      delete process.env.NEXUS_API_KEY;
    }
  });

  it('flattenManifest reads the flat v1 manifest and drops __MACOSX entries', () => {
    const manifest: ModFileManifest = {
      version: 1,
      files: [
        { file_path: 'MyMod\\CoolPak.pak', file_size: 1024 },
        { file_path: '__MACOSX/MyMod/._CoolPak.pak', file_size: 176 },
        { file_path: 'MyMod/Readme.md', file_size: 200 },
      ],
    };
    expect(flattenManifest(manifest)).toEqual(['MyMod/CoolPak.pak', 'MyMod/Readme.md']);
  });

  it('flattenManifest collects file leaves in tree order', () => {
    const tree: PreviewDirectory = {
      name: '', path: '', type: 'directory',
      children: [
        { name: 'MyMod', path: 'MyMod', type: 'directory', children: [
          { name: 'CoolPak.pak', path: 'MyMod/CoolPak.pak', type: 'file', size: '1024' },
          { name: 'Readme.md',   path: 'MyMod/Readme.md',   type: 'file', size: '200' },
        ]},
      ],
    };
    expect(flattenManifest(tree)).toEqual([
      'MyMod/CoolPak.pak',
      'MyMod/Readme.md',
    ]);
  });

  it('fetchPublishedModIds walks every page until totalCount is reached', async () => {
    // totalCount = 3 with a page size larger than 1, returned across two pages.
    const pages = [
      { data: { mods: { totalCount: 3, nodes: [{ modId: 1 }, { modId: 2 }] } } },
      { data: { mods: { totalCount: 3, nodes: [{ modId: 3 }] } } },
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => mkRes(pages[call++]!));
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXUS_API_KEY = 'k';
    try {
      const ids = await fetchPublishedModIds('xrebirth');
      expect(ids).toEqual([1, 2, 3]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Second call advances the offset past the first page.
      const body2 = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
      expect(body2.variables).toMatchObject({ domain: 'xrebirth', offset: 2 });
    } finally {
      delete process.env.NEXUS_API_KEY;
    }
  });

  it('fetchPublishedModIds stops on a single full page (offset >= totalCount)', async () => {
    const fetchMock = vi.fn(async () =>
      mkRes({ data: { mods: { totalCount: 2, nodes: [{ modId: 10 }, { modId: 11 }] } } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXUS_API_KEY = 'k';
    try {
      const ids = await fetchPublishedModIds('xrebirth');
      expect(ids).toEqual([10, 11]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.NEXUS_API_KEY;
    }
  });

  it('throws a useful error on 401 with API-key hint', async () => {
    const fetchMock = vi.fn(async () => mkRes({ message: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchModFiles(3333, 100)).rejects.toThrow(/NEXUS_API_KEY|401/i);
  });
});
