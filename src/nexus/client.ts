const NEXUS_GAMES_URL    = 'https://data.nexusmods.com/file/nexus-data/games.json';
const NEXUS_GRAPHQL_URL  = 'https://api.nexusmods.com/v2/graphql';
const NEXUS_FILE_META    = 'https://file-metadata.nexusmods.com/file/nexus-files-s3-meta';

export interface NexusGameEntry {
  id: number;
  domain_name: string;
  name: string;
}

export interface NexusModFile {
  uid: string;
  uri: string;          // file name as used in the S3 metadata URL
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
  gameId: number,
  modId: number,
  fileUri: string,
): Promise<PreviewDirectory> => {
  const url = `${NEXUS_FILE_META}/${gameId}/${modId}/${encodeURIComponent(fileUri)}.json`;
  return fetchJson<PreviewDirectory>(url);
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

export const flattenManifest = (dir: PreviewDirectory): string[] => {
  const out: string[] = [];
  for (const child of dir.children) {
    if (child.type === 'file') out.push(child.path);
    else out.push(...flattenManifest(child));
  }
  return out;
};
