import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { runCorpus, type CorpusReport } from '../src/corpus/runner.js';
import type { InstallerRule } from '../src/runtime/installer-engine.js';

const pakRule: InstallerRule = {
  id: 'pak',
  priority: 10,
  when: { kind: 'hasFile', glob: '**/*.pak' },
  single: {
    anchor: { kind: 'glob', pattern: '**/*.pak' },
    take: 'parent',
    placeAt: '/mods',
  },
  modType: 'pak',
};

describe('runCorpus', () => {
  it('reports each archive: matched/installed/none', () => {
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const report: CorpusReport = runCorpus([pakRule], [archive], { vars: {} });
    expect(report.total).toBe(1);
    expect(report.matched).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.entries[0]).toMatchObject({
      archive: expect.stringContaining('typical-pak.zip'),
      matchedInstaller: 'pak',
      planSize: 2,
    });
  });

  it('runs the engine against JSON manifest archives', () => {
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.json');
    const report: CorpusReport = runCorpus([pakRule], [archive], { vars: {} });
    expect(report.matched).toBe(1);
    expect(report.entries[0]?.planSize).toBe(2);
  });

  it('reports unmatched archives without failing the run', () => {
    const onlyLua: InstallerRule = {
      ...pakRule,
      id: 'lua',
      when: { kind: 'hasFile', glob: '**/*.lua' },
      single: { ...pakRule.single!, anchor: { kind: 'glob', pattern: '**/*.lua' } },
    };
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const report = runCorpus([onlyLua], [archive], { vars: {} });
    expect(report.matched).toBe(0);
    expect(report.unmatched).toBe(1);
    expect(report.entries[0]?.matchedInstaller).toBeUndefined();
  });
});
