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
    expect(ci).toContain('uses: ./gdl/.github/workflows/test.yml@main');
    expect(ci).toContain('uses: ./gdl/.github/workflows/release.yml@main');
  });

  it('refuses to overwrite an existing game.yaml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-clash-'));
    await initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' });
    await expect(initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' }))
      .rejects.toThrow(/already exists/);
  });
});
