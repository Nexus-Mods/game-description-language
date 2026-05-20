import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHooks } from '../src/codegen/hook-resolver.js';

describe('resolveHooks', () => {
  it('returns OK when src/hooks.ts exports the expected hook with matching signature', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'hooks.ts'), `
import type { GameContext } from '@gdl/runtime';
export const detectGameVersion = async (ctx: GameContext): Promise<string | null> => {
  return '1.0.0';
};
`);
    const errors = await resolveHooks(dir, ['detectGameVersion']);
    expect(errors).toEqual([]);
  });

  it('returns an error when the hook export is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'hooks.ts'), `export const somethingElse = 1;`);
    const errors = await resolveHooks(dir, ['detectGameVersion']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('GDL070');
  });

  it('returns an error when src/hooks.ts does not exist but hooks are referenced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    const errors = await resolveHooks(dir, ['detectGameVersion']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('GDL071');
  });

  it('returns no errors when no hooks are referenced even without src/hooks.ts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    const errors = await resolveHooks(dir, []);
    expect(errors).toEqual([]);
  });
});
