import AdmZip from 'adm-zip';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flattenManifest, type PreviewDirectory } from '../nexus/client.js';

export const readZipEntries = (zipPath: string): string[] => {
  const zip = new AdmZip(zipPath);
  return zip
    .getEntries()
    .filter(e => !e.isDirectory)
    .map(e => e.entryName.replace(/\\/g, '/'))
    .sort();
};

export const readManifestEntries = (jsonPath: string): string[] => {
  const tree = JSON.parse(readFileSync(jsonPath, 'utf8')) as PreviewDirectory;
  return flattenManifest(tree).sort();
};

// Dispatch by extension: .zip → adm-zip, .json → Nexus file-metadata manifest.
export const readArchiveEntries = (path: string): string[] => {
  if (path.endsWith('.json')) return readManifestEntries(path);
  if (path.endsWith('.zip'))  return readZipEntries(path);
  throw new Error(`unsupported archive type: ${path}`);
};

export const localCachePaths = (cwd: string): string[] => {
  const cacheDir = join(cwd, 'tests', 'cache');
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter(name => name.endsWith('.zip') || name.endsWith('.json'))
    .sort()
    .map(name => join(cacheDir, name));
};
