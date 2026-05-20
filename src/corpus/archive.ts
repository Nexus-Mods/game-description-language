import AdmZip from 'adm-zip';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const readZipEntries = (zipPath: string): string[] => {
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter(e => !e.isDirectory)
    .map(e => e.entryName.replace(/\\/g, '/'));
  return entries.sort();
};

export const localCachePaths = (cwd: string): string[] => {
  const cacheDir = join(cwd, 'tests', 'cache');
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter(name => name.endsWith('.zip'))
    .sort()
    .map(name => join(cacheDir, name));
};
