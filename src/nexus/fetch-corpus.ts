import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchGames, fetchModFiles, fetchArchiveManifest, fetchPublishedModIds, type NexusModFile } from './client.js';

export interface FetchCorpusOptions {
  gameDomain: string;          // e.g. "subnautica2"
  cacheDir: string;            // typically <cwd>/tests/cache
  onProgress?: (event:
    | { kind: 'fetched'; archive: string }
    | { kind: 'skipped'; archive: string; reason: string }
    | { kind: 'error';   archive: string; reason: string }
  ) => void;
}

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch { return false; }
};

// Safe filename: keep ASCII letters/digits/dot/dash/underscore; replace rest with '_'.
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, '_');

const pickDefaultFile = (files: NexusModFile[]): NexusModFile | undefined => {
  const main = files.filter(f => f.category === 'MAIN').sort((a, b) => b.date - a.date);
  if (main.length > 0) return main[0];
  // Fall back to most recent file of any category.
  return [...files].sort((a, b) => b.date - a.date)[0];
};

// Download each mod's default-file manifest into cacheDir.
// When modIds is omitted, auto-discovers all published mods via the Nexus API.
export interface FetchCorpusInputs extends FetchCorpusOptions {
  modIds?: number[];     // empty/undefined = auto-discover all published mods
  limit?: number;        // cap the number of mods fetched (after discovery)
}

export const fetchCorpus = async (opts: FetchCorpusInputs): Promise<void> => {
  await mkdir(opts.cacheDir, { recursive: true });

  const games = await fetchGames();
  const game = games.find(g => g.domain_name === opts.gameDomain);
  if (!game) throw new Error(`Unknown Nexus game domain: ${opts.gameDomain}`);

  const discovered = opts.modIds && opts.modIds.length > 0
    ? opts.modIds
    : await fetchPublishedModIds(opts.gameDomain);
  // Cap the catalog so `--fetch` on a large game doesn't pull thousands of
  // manifests. `--mods` still scopes explicitly; `--limit` bounds the rest.
  const modIds = opts.limit !== undefined && opts.limit >= 0
    ? discovered.slice(0, opts.limit)
    : discovered;

  for (const modId of modIds) {
    try {
      const files = await fetchModFiles(game.id, modId);
      const file = pickDefaultFile(files);
      if (!file) {
        opts.onProgress?.({ kind: 'skipped', archive: String(modId), reason: 'no files' });
        continue;
      }
      const cachedName = `${game.id}_${modId}_${file.fileId}_${safe(file.uri)}.json`;
      const cachedPath = join(opts.cacheDir, cachedName);
      if (await exists(cachedPath)) {
        opts.onProgress?.({ kind: 'skipped', archive: cachedName, reason: 'cache hit' });
        continue;
      }
      const manifest = await fetchArchiveManifest(game.id, modId, file.uri);
      await writeFile(cachedPath, JSON.stringify(manifest), 'utf8');
      opts.onProgress?.({ kind: 'fetched', archive: cachedName });
    } catch (e) {
      opts.onProgress?.({
        kind: 'error',
        archive: `mod-${modId}`,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
};
