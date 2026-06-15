import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBundler } from '../src/bundler/index.js';

describe('runBundler', () => {
  it('bundles a trivial extension.ts to dist/extension.js', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-bundle-'));
    await mkdir(join(dir, '.gdl-out'), { recursive: true });
    writeFileSync(
      join(dir, '.gdl-out', 'extension.ts'),
      `import { log } from 'vortex-api';\n` +
      `export default function main(): void { log('info', 'test', {}); }\n`,
    );
    await runBundler(dir);
    // Bundle output is index.js (the Vortex extension entry-point convention).
    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'index.js.map'))).toBe(true);
    const bundle = readFileSync(join(dir, 'dist', 'index.js'), 'utf8');
    expect(bundle).toContain('vortex-api');   // externalised reference present
  }, 30000);
});

describe('runBundler — extension-repo cwd (no local node_modules)', () => {
  it('resolves ts-loader from the GDL submodule, not from cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-bundle-extrepo-'));
    await mkdir(join(dir, '.gdl-out'), { recursive: true });
    writeFileSync(
      join(dir, '.gdl-out', 'extension.ts'),
      `import { log } from 'vortex-api';\nexport default function main() { log('info', 'x'); return true; }\n`,
    );
    // Note: no node_modules in `dir`. The bundler must find ts-loader in the GDL repo's node_modules.
    await runBundler(dir);
    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(true);
  }, 30000);
});
