import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePublishInfo, type PublishInfoField } from '../src/commands/publish-info.js';

const writeFixture = (yaml: string, pkgVersion = '1.2.3'): string => {
  const dir = mkdtempSync(join(tmpdir(), 'gdl-pubinfo-'));
  writeFileSync(join(dir, 'game.yaml'), yaml);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: pkgVersion }));
  return dir;
};

const VALID = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: Hello World Support for Vortex
`;

describe('resolvePublishInfo', () => {
  it('returns file-group-id from the nexus block', async () => {
    const cwd = writeFixture(VALID);
    expect(await resolvePublishInfo(cwd, 'file-group-id')).toBe('7418978');
  });

  it('returns display-name from the nexus block', async () => {
    const cwd = writeFixture(VALID);
    expect(await resolvePublishInfo(cwd, 'display-name')).toBe('Hello World Support for Vortex');
  });

  it('returns version from package.json', async () => {
    const cwd = writeFixture(VALID, '4.5.6');
    expect(await resolvePublishInfo(cwd, 'version')).toBe('4.5.6');
  });

  it('returns zip-name computed from game id and version', async () => {
    const cwd = writeFixture(VALID, '4.5.6');
    expect(await resolvePublishInfo(cwd, 'zip-name')).toBe('helloworld-vortex-v4.5.6.zip');
  });

  it('throws when the nexus block is missing', async () => {
    const cwd = writeFixture(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`);
    await expect(resolvePublishInfo(cwd, 'file-group-id'))
      .rejects.toThrow(/nexus/);
  });

  it('throws on unknown field', async () => {
    const cwd = writeFixture(VALID);
    await expect(resolvePublishInfo(cwd, 'cheese' as PublishInfoField))
      .rejects.toThrow(/unknown field/i);
  });
});
