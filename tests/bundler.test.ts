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
    expect(existsSync(join(dir, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'extension.js.map'))).toBe(true);
    const bundle = readFileSync(join(dir, 'dist', 'extension.js'), 'utf8');
    expect(bundle).toContain('vortex-api');   // externalised reference present
  }, 30000);
});
