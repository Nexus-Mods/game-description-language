#!/usr/bin/env node
import { Command } from 'commander';
import { buildExtension, reportBuildError } from './commands/build.js';
import { packageExtension } from './commands/package.js';
import { runTestCorpus } from './commands/test-corpus.js';
import { resolvePublishInfo, type PublishInfoField } from './commands/publish-info.js';
import { initExtension } from './commands/init.js';

const program = new Command();
program
  .name('gdl')
  .description('Game Description Language toolchain')
  .version('0.0.1');

program
  .command('build')
  .description('Build the current extension (game.yaml → dist/extension.js)')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .action(async (opts: { yaml?: string }) => {
    try {
      await buildExtension({
        cwd: process.cwd(),
        ...(opts.yaml !== undefined && { yamlPath: opts.yaml }),
      });
      process.stdout.write('build ok\n');
    } catch (err) {
      process.stderr.write(reportBuildError(err) + '\n');
      process.exit(1);
    }
  });

program
  .command('package')
  .description('Build the extension and zip dist/ into out/<game-id>-vortex-v<version>.zip')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .action(async (opts: { yaml?: string }) => {
    try {
      const result = await packageExtension({
        cwd: process.cwd(),
        ...(opts.yaml !== undefined && { yamlPath: opts.yaml }),
      });
      process.stdout.write(`Packaged: ${result.archivePath}\n`);
    } catch (err) {
      const { reportBuildError } = await import('./commands/build.js');
      process.stderr.write(reportBuildError(err) + '\n');
      process.exit(1);
    }
  });

program
  .command('test:corpus')
  .description('Run installer rules against archives in tests/cache/')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .option('--fetch', 'fetch fresh Nexus manifests into tests/cache/ before running')
  .option('--mods <ids>', 'comma-separated mod IDs to fetch (e.g. --mods 100,101,102)', (v) =>
    v.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
  )
  .action(async (opts: { yaml?: string; fetch?: boolean; mods?: number[] }) => {
    try {
      await runTestCorpus({
        cwd: process.cwd(),
        ...(opts.yaml  !== undefined && { yamlPath: opts.yaml }),
        ...(opts.fetch !== undefined && { fetch:    opts.fetch }),
        ...(opts.mods  !== undefined && { modIds:   opts.mods }),
      });
    } catch (err) {
      const { reportBuildError } = await import('./commands/build.js');
      process.stderr.write(reportBuildError(err) + '\n');
      process.exit(1);
    }
  });

program
  .command('publish-info <field>')
  .description('Print a release-pipeline metadata value from game.yaml. Fields: mod-id, file-group-id, display-name, version, zip-name')
  .action(async (field: string) => {
    try {
      const value = await resolvePublishInfo(process.cwd(), field as PublishInfoField);
      process.stdout.write(value);   // no trailing newline — CI consumes raw
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program
  .command('init <gameId>')
  .description('Scaffold a new GDL extension repo for a game')
  .option('-n, --name <name>', 'human-friendly game name', '')
  .action(async (gameId: string, opts: { name?: string }) => {
    try {
      const gameName = opts.name && opts.name.trim() ? opts.name : gameId;
      await initExtension({ cwd: process.cwd(), gameId, gameName });
      process.stdout.write(`Scaffolded ${gameId} in ${process.cwd()}\n`);
      process.stdout.write(`Next: add the GDL submodule with: git submodule add https://github.com/Nexus-Mods/game-description-language gdl\n`);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
