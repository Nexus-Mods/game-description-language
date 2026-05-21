import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('sparse extension', () => {
  it('a freshly-init repo has only the expected files and builds end-to-end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-sparse-'));
    const { initExtension } = await import('../src/commands/init.js');
    await initExtension({ cwd: dir, gameId: 'helloworld', gameName: 'Hello World' });

    // Sparse check: only the templated files exist at the repo root.
    const rootEntries = readdirSync(dir).sort();
    expect(rootEntries).toEqual([
      '.github',
      '.gitignore',
      'README.md',
      'game.yaml',
      'package.json',
    ]);
    expect(readdirSync(join(dir, '.github', 'workflows'))).toEqual(['ci.yml']);

    // Replace the stubby game.yaml with one that actually has installers, so the
    // build doesn't fail-fast on validation. The user would do this manually.
    writeFileSync(join(dir, 'game.yaml'), `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 5678
  displayName: Hello World Support for Vortex
`);

    // Symlink the submodule into place.
    const gdlRoot = resolve(import.meta.dirname, '..');
    symlinkSync(gdlRoot, join(dir, 'gdl'), 'dir');

    // Build the extension via the same path the scaffolded package.json does.
    const { buildExtension } = await import('../src/commands/build.js');
    await buildExtension({ cwd: dir });

    expect(existsSync(join(dir, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'info.json'))).toBe(true);
  }, 60000);
});
