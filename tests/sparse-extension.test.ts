import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('sparse extension', () => {
  it('a freshly-init repo has only the expected files and builds end-to-end', async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-sparse-'));
    const { initExtension } = await import('../src/commands/init.js');
    await initExtension({ cwd: dir, gameId: 'helloworld', gameName: 'Hello World' });

    // Sparse check: the root-driven layout (init.ts commit 6dd652c) emits ONLY
    // game.yaml — package.json / .github / .gitignore / README are no longer
    // scaffolded; in the monorepo model a game is just game.yaml (+ gameart).
    const rootEntries = readdirSync(dir).sort();
    expect(rootEntries).toEqual(['game.yaml']);

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
    try {
      symlinkSync(gdlRoot, join(dir, 'gdl'), 'dir');
    } catch (e) {
      // Windows requires admin/Developer Mode to create symlinks. Skip there
      // rather than fail; this test still runs fully in (Linux) CI.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return ctx.skip();
      throw e;
    }

    // Build the extension via the same path the scaffolded package.json does.
    const { buildExtension } = await import('../src/commands/build.js');
    await buildExtension({ cwd: dir });

    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'info.json'))).toBe(true);
  }, 60000);
});
