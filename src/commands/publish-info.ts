import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';
import { extensionId } from '../schema/types.js';

export type PublishInfoField =
  | 'mod-id'
  | 'file-group-id'
  | 'display-name'
  | 'version'
  | 'zip-name';

export const resolvePublishInfo = async (
  cwd: string,
  field: PublishInfoField,
): Promise<string> => {
  const yamlPath = join(cwd, 'game.yaml');
  const doc = parseYaml(await readFile(yamlPath, 'utf8'), yamlPath);

  if (field === 'version' || field === 'zip-name') {
    let version = '0.0.0';
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
      if (typeof pkg.version === 'string') version = pkg.version;
    } catch { /* tolerate */ }
    if (field === 'version') return version;
    return `${extensionId(doc.game.id)}-vortex-v${version}.zip`;
  }

  if (!doc.nexus) {
    throw new Error(`game.yaml has no nexus block; \`publish-info ${field}\` cannot resolve.`);
  }
  if (field === 'mod-id')        return String(doc.nexus.modId);
  if (field === 'file-group-id') return String(doc.nexus.fileGroupId);
  if (field === 'display-name')  return doc.nexus.displayName;

  throw new Error(`unknown field: ${String(field)}`);
};
