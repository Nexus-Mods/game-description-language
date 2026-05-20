const API_BASE = 'https://api.nexusmods.com';

export interface NexusAuth {
  apiKey: string;
}

export interface ListModIdsParams extends NexusAuth {
  gameDomain: string;
}

export interface ListModFilesParams extends NexusAuth {
  gameDomain: string;
  modId: number;
}

export interface DownloadUrlParams extends NexusAuth {
  gameDomain: string;
  modId: number;
  fileId: number;
}

export interface NexusFile {
  fileId: number;
  fileName: string;
  version: string;
  sizeKb: number;
}

const headers = (apiKey: string) => ({
  apikey: apiKey,
  accept: 'application/json',
});

const expectOk = async (res: Response, ctx: string): Promise<void> => {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Nexus ${ctx}: ${res.status} ${res.statusText} ${body}`);
  }
};

export const listGameModIds = async (p: ListModIdsParams): Promise<number[]> => {
  // updated.json with period=1m enumerates mods touched in the last month.
  // A future plan can broaden coverage via the v2 GraphQL API.
  const url = `${API_BASE}/v1/games/${p.gameDomain}/mods/updated.json?period=1m`;
  const res = await fetch(url, { headers: headers(p.apiKey) });
  await expectOk(res, 'listGameModIds');
  const body = (await res.json()) as { mod_id: number }[];
  const ids = new Set<number>();
  for (const m of body) ids.add(m.mod_id);
  return [...ids].sort((a, b) => a - b);
};

export const listModFiles = async (p: ListModFilesParams): Promise<NexusFile[]> => {
  const url = `${API_BASE}/v1/games/${p.gameDomain}/mods/${p.modId}/files.json`;
  const res = await fetch(url, { headers: headers(p.apiKey) });
  await expectOk(res, 'listModFiles');
  const body = (await res.json()) as { files: { file_id: number; file_name: string; version: string; size_kb: number }[] };
  return body.files.map(f => ({
    fileId: f.file_id, fileName: f.file_name, version: f.version, sizeKb: f.size_kb,
  }));
};

export const getDownloadUrl = async (p: DownloadUrlParams): Promise<string> => {
  // Premium-class API keys get CDN URLs directly. Non-premium keys may 403; the test
  // suite doesn't exercise that path.
  const url = `${API_BASE}/v1/games/${p.gameDomain}/mods/${p.modId}/files/${p.fileId}/download_link.json`;
  const res = await fetch(url, { headers: headers(p.apiKey) });
  await expectOk(res, 'getDownloadUrl');
  const body = (await res.json()) as { URI: string; name?: string }[];
  if (body.length === 0) throw new Error(`no download URLs returned for file ${p.fileId}`);
  return body[0]!.URI;
};
