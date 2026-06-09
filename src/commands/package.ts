import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildExtension } from './build.js';
import { zipDist } from '../packaging/zip.js';
import { parseYaml } from '../parser/index.js';
import { extensionId } from '../schema/types.js';
import { resolveExtensionVersion } from '../version.js';

export interface PackageArgs {
  cwd: string;
  yamlPath?: string;
}

export interface PackageResult {
  archivePath: string;
}

const archiveNameFor = (gameId: string, version: string): string =>
  `${extensionId(gameId)}-vortex-v${version}.zip`;

export const packageExtension = async (args: PackageArgs): Promise<PackageResult> => {
  await buildExtension({
    cwd: args.cwd,
    ...(args.yamlPath !== undefined && { yamlPath: args.yamlPath }),
  });

  const yamlPath = args.yamlPath ?? join(args.cwd, 'game.yaml');
  const yamlSrc  = await readFile(yamlPath, 'utf8');
  const doc      = parseYaml(yamlSrc, yamlPath);

  const version = await resolveExtensionVersion(doc, args.cwd);

  const archivePath = await zipDist({
    cwd: args.cwd,
    archiveName: archiveNameFor(doc.game.id, version),
    outDir: 'out',
  });
  return { archivePath };
};
