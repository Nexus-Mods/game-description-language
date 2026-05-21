import AdmZip from 'adm-zip';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface ZipDistOptions {
  cwd: string;
  archiveName: string;
  outDir: string;
}

// adm-zip's addLocalFile takes a directory inside the archive; '' for root.
const dirOf = (rel: string): string => {
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? '' : rel.slice(0, idx);
};

const addDir = (zip: AdmZip, baseDir: string, currentDir: string): void => {
  for (const entry of readdirSync(currentDir)) {
    const full = join(currentDir, entry);
    const stats = statSync(full);
    const rel = relative(baseDir, full).replace(/\\/g, '/');
    if (stats.isDirectory()) {
      addDir(zip, baseDir, full);
    } else {
      zip.addLocalFile(full, dirOf(rel));
    }
  }
};

export const zipDist = async (opts: ZipDistOptions): Promise<string> => {
  const distDir = join(opts.cwd, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`dist/ does not exist at ${distDir}; run \`gdl build\` first`);
  }
  await mkdir(join(opts.cwd, opts.outDir), { recursive: true });
  const archivePath = join(opts.cwd, opts.outDir, opts.archiveName);

  const zip = new AdmZip();
  addDir(zip, distDir, distDir);
  zip.writeZip(archivePath);
  return archivePath;
};
