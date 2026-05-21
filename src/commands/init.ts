import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync as existsSyncFn } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatesDir = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Built layout: dist/commands/init.js → dist/templates
  // Dev layout (vitest): src/commands/init.ts → src/templates
  const built = join(here, '..', 'templates');
  const dev   = join(here, '..', '..', 'src', 'templates');
  return existsSyncFn(built) ? built : dev;
};

export interface InitArgs {
  cwd: string;
  gameId: string;
  gameName: string;
}

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch { return false; }
};

const substitute = (content: string, args: InitArgs): string =>
  content
    .replace(/\{\{GAME_ID\}\}/g,   args.gameId)
    .replace(/\{\{GAME_NAME\}\}/g, args.gameName);

const TEMPLATES: { src: string; dst: string }[] = [
  { src: 'game.yaml.tmpl',     dst: 'game.yaml' },
  { src: 'package.json.tmpl',  dst: 'package.json' },
  { src: 'gitignore.tmpl',     dst: '.gitignore' },
  { src: 'README.md.tmpl',     dst: 'README.md' },
  { src: 'ci.yml.tmpl',        dst: '.github/workflows/ci.yml' },
];

export const initExtension = async (args: InitArgs): Promise<void> => {
  const targetGameYaml = join(args.cwd, 'game.yaml');
  if (await exists(targetGameYaml)) {
    throw new Error(`game.yaml already exists at ${targetGameYaml}; refusing to overwrite`);
  }
  for (const { src, dst } of TEMPLATES) {
    const template = await readFile(join(templatesDir(), src), 'utf8');
    const out = substitute(template, args);
    const outPath = join(args.cwd, dst);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, out, 'utf8');
  }
};
