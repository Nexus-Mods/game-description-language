#!/usr/bin/env node
import { Command } from 'commander';
import { buildExtension, reportBuildError } from './commands/build.js';
import { runTestCorpus } from './commands/test-corpus.js';

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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
