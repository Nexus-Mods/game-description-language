import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';
import { validate } from '../schema/validator.js';
import { emit, writeEmittedFiles } from '../codegen/emit.js';
import { runBundler } from '../bundler/index.js';
import { BuildErrors, formatError } from '../errors.js';

export interface BuildArgs {
  cwd: string;            // directory containing game.yaml + package.json
  yamlPath?: string;      // override default ./game.yaml
}

export const buildExtension = async (args: BuildArgs): Promise<void> => {
  const yamlPath = args.yamlPath ?? join(args.cwd, 'game.yaml');
  const source = await readFile(yamlPath, 'utf8');
  const doc = parseYaml(source, yamlPath);

  const errors = validate(doc);
  if (errors.length) throw new BuildErrors(errors);

  let extensionVersion = '0.0.0';
  try {
    const pkg = JSON.parse(await readFile(join(args.cwd, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string') extensionVersion = pkg.version;
  } catch { /* tolerate missing package.json in tests */ }

  const files = emit(doc, { extensionVersion });
  await writeEmittedFiles(args.cwd, files);

  await runBundler(args.cwd);

  // Copy info.json next to dist/extension.js so Vortex sees it.
  await mkdir(join(args.cwd, 'dist'), { recursive: true });
  await copyFile(join(args.cwd, '.gdl-out', 'info.json'), join(args.cwd, 'dist', 'info.json'));
};

export const reportBuildError = (err: unknown): string => {
  if (err instanceof BuildErrors) {
    return err.errors.map(formatError).join('\n');
  }
  return err instanceof Error ? err.message : String(err);
};
