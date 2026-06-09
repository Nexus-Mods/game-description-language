import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentNode } from './parser/ast.js';

/**
 * Resolve the extension version: prefer game.yaml's top-level `version:`, then
 * fall back to package.json's `version`, then `0.0.0`. This lets a game be
 * defined by game.yaml alone, with no package.json.
 */
export const resolveExtensionVersion = async (
  doc: DocumentNode,
  cwd: string,
): Promise<string> => {
  if (doc.version) return doc.version;
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string') return pkg.version;
  } catch { /* tolerate missing package.json */ }
  return '0.0.0';
};
