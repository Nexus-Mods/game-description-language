import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initExtension } from '../src/commands/init.js';

describe('initExtension', () => {
  it('scaffolds an extension repo with all template files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-'));
    await initExtension({ cwd: dir, gameId: 'subnautica2', gameName: 'Subnautica 2' });

    for (const f of ['game.yaml', 'package.json', '.gitignore', 'README.md', '.github/workflows/ci.yml']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }

    const gameYaml = readFileSync(join(dir, 'game.yaml'), 'utf8');
    expect(gameYaml).toContain('id: subnautica2');
    expect(gameYaml).toContain('displayName: Subnautica 2 Support for Vortex');

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('game-subnautica2');

    const ci = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('uses: Nexus-Mods/game-description-language/.github/workflows/test.yml@gdl-mvp');
    expect(ci).toContain('uses: Nexus-Mods/game-description-language/.github/workflows/release.yml@gdl-mvp');
  });

  it('refuses to overwrite an existing game.yaml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-clash-'));
    await initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' });
    await expect(initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' }))
      .rejects.toThrow(/already exists/);
  });

  it('CI workflow uses the published GDL workflows by ref (not local-path)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-ci-'));
    await initExtension({ cwd: dir, gameId: 'helloworld', gameName: 'Hello World' });

    const ci = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('uses: Nexus-Mods/game-description-language/.github/workflows/test.yml@gdl-mvp');
    expect(ci).toContain('uses: Nexus-Mods/game-description-language/.github/workflows/release.yml@gdl-mvp');
    // Make sure the broken form does NOT appear
    expect(ci).not.toContain('./gdl/.github/workflows/test.yml@');
    expect(ci).not.toContain('./gdl/.github/workflows/release.yml@');
  });
});
