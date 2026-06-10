import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initExtension } from '../src/commands/init.js';

describe('initExtension', () => {
  it('scaffolds only a game.yaml (root-driven monorepo layout)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-'));
    await initExtension({ cwd: dir, gameId: 'subnautica2', gameName: 'Subnautica 2' });

    expect(existsSync(join(dir, 'game.yaml'))).toBe(true);

    // The repo root provides these — init must NOT emit per-game copies.
    for (const f of ['package.json', '.gitignore', 'README.md', '.github/workflows/ci.yml']) {
      expect(existsSync(join(dir, f))).toBe(false);
    }

    const gameYaml = readFileSync(join(dir, 'game.yaml'), 'utf8');
    expect(gameYaml).toContain('gdl: 1');
    expect(gameYaml).toContain('version: 0.0.1');     // version lives in game.yaml now
    expect(gameYaml).toContain('id: subnautica2');
    expect(gameYaml).toContain('nexusDomain: subnautica2');
    // The nexus block ships commented out (GDL rejects 0/placeholder ids at build).
    expect(gameYaml).not.toMatch(/^\s*modId:/m);
  });

  it('produces a game.yaml that builds (no required nexus/logo)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-build-'));
    await initExtension({ cwd: dir, gameId: 'helloworld', gameName: 'Hello World' });
    const gameYaml = readFileSync(join(dir, 'game.yaml'), 'utf8');
    // No active logo or nexus block means a fresh scaffold builds without extra files.
    expect(gameYaml).not.toMatch(/^\s*logo:/m);
    expect(gameYaml).not.toMatch(/^\s*nexus:/m);
  });

  it('refuses to overwrite an existing game.yaml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-clash-'));
    await initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' });
    await expect(initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' }))
      .rejects.toThrow(/already exists/);
  });
});
