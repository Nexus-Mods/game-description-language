#!/usr/bin/env node
import { Command } from 'commander';
import { buildExtension, reportBuildError } from './commands/build.js';

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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
