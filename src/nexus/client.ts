const NEXUS_GAMES_URL    = 'https://data.nexusmods.com/file/nexus-data/games.json';
const NEXUS_GRAPHQL_URL  = 'https://api.nexusmods.com/v2/graphql';
const NEXUS_V3_URL       = 'https://api.nexusmods.com/v3';

export interface NexusGameEntry {
  id: number;
  domain_name: string;
  name: string;
}

export interface NexusModFile {
  uid: string;
  uri: string;          // legacy file name, or a UUID path for uploads since June 2026
  fileId: number;
  name: string;
  version: string;
  category: string;     // typically 'MAIN', 'OPTIONAL', 'OLD_VERSION', ...
  date: number;         // epoch seconds
}

export interface PreviewDirectory {
  name: string;
  path: string;
  type: 'directory';
  children: (PreviewDirectory | PreviewFile)[];
}

export interface PreviewFile {
  name: string;
  path: string;
  type: 'file';
  size: string;
}

// The manifest behind v3 `manifest_url`: a flat file list with sizes and hashes.
// PreviewDirectory above is the older tree format; caches may still hold it.
export interface ModFileManifest {
  version: number;
  files: {
    file_path: string;
    file_size: number;
    file_hashes?: Record<string, string>;
  }[];
}

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${url} returned ${res.status}. Set NEXUS_API_KEY env var if this endpoint requires authentication.`);
  }
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
};

export const fetchGames = async (): Promise<NexusGameEntry[]> =>
  fetchJson<NexusGameEntry[]>(NEXUS_GAMES_URL);

const MOD_FILES_QUERY = `query($modId: ID!, $gameId: ID!) {
  modFiles(modId: $modId, gameId: $gameId) {
    uid uri fileId name version category date
  }
}`;

export const fetchModFiles = async (gameId: number, modId: number): Promise<NexusModFile[]> => {
  const apiKey = process.env.NEXUS_API_KEY;
  const result = await fetchJson<{
    data?: { modFiles: NexusModFile[] };
    errors?: { message: string }[];
  }>(NEXUS_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { apikey: apiKey } : {}),
    },
    body: JSON.stringify({
      query: MOD_FILES_QUERY,
      variables: { modId: String(modId), gameId: String(gameId) },
    }),
  });
  if (result.errors?.length) {
    throw new Error(`GraphQL modFiles error: ${result.errors.map(e => e.message).join('; ')}`);
  }
  if (!result.data?.modFiles) {
    throw new Error('GraphQL modFiles returned no data');
  }
  return result.data.modFiles;
};

export const fetchArchiveManifest = async (
  gameDomain: string,
  fileId: number,
): Promise<ModFileManifest> => {
  const apiKey = process.env.NEXUS_API_KEY;
  if (!apiKey) throw new Error('NEXUS_API_KEY is required to look up a manifest');
  const version = await fetchJson<{ data: { manifest_url: string | null } }>(
    `${NEXUS_V3_URL}/games/${encodeURIComponent(gameDomain)}/mod-file-versions/${fileId}`,
    { headers: { apikey: apiKey } },
  );
  const manifestUrl = version.data.manifest_url;
  if (!manifestUrl) throw new Error(`file ${fileId} has no manifest`);
  // The manifest host is public; don't send the key there.
  return fetchJson<ModFileManifest>(manifestUrl);
};

const PUBLISHED_MODS_QUERY = `query($domain: String!, $count: Int!, $offset: Int!) {
  mods(
    filter: {
      gameDomainName: { value: $domain, op: EQUALS }
      status: { value: "published", op: EQUALS }
    }
    count: $count
    offset: $offset
  ) { totalCount nodes { modId } }
}`;

/** Page size for the paginated published-mods query. */
const MODS_PAGE_SIZE = 50;

export const fetchPublishedModIds = async (gameDomain: string): Promise<number[]> => {
  const apiKey = process.env.NEXUS_API_KEY;
  if (!apiKey) throw new Error('NEXUS_API_KEY is required to list mods');

  // The Nexus GraphQL `mods` connection is paginated (offset/count). Without a
  // loop we'd only ever see the first page, so walk pages until we've collected
  // `totalCount` mods (or a page comes back empty as a safety stop).
  const modIds: number[] = [];
  let offset = 0;
  for (;;) {
    const result = await fetchJson<{
      data?: { mods: { totalCount: number; nodes: { modId: number }[] } };
      errors?: { message: string }[];
    }>(NEXUS_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        query: PUBLISHED_MODS_QUERY,
        variables: { domain: gameDomain, count: MODS_PAGE_SIZE, offset },
      }),
    });
    if (result.errors?.length) {
      throw new Error(`GraphQL mods query error: ${result.errors.map(e => e.message).join('; ')}`);
    }
    const page = result.data?.mods.nodes ?? [];
    for (const n of page) modIds.push(n.modId);
    const total = result.data?.mods.totalCount ?? 0;
    offset += page.length;
    if (page.length === 0 || offset >= total) break;
  }
  return modIds;
};

const flattenTree = (dir: PreviewDirectory): string[] => {
  const out: string[] = [];
  for (const child of dir.children) {
    if (child.type === 'file') out.push(child.path);
    else out.push(...flattenTree(child));
  }
  return out;
};

// Accepts either manifest format. The v1 format lists macOS resource forks
// (`__MACOSX/`) that the older tree dropped; drop them too so they don't show up
// as unmatched files.
export const flattenManifest = (manifest: PreviewDirectory | ModFileManifest): string[] => {
  if (!('files' in manifest)) return flattenTree(manifest);
  return manifest.files
    .map(f => f.file_path.replace(/\\/g, '/'))
    .filter(p => !p.startsWith('__MACOSX/'));
};
