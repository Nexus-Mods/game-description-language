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

  it('skips installers whose scope.stores excludes the active store', () => {
    const epicOnly: InstallerRule = { ...pakRule, scope: { stores: ['epic'] } };
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');

    const steam = runCorpus([epicOnly], [archive], { vars: { store: 'steam' } });
    expect(steam.matched).toBe(0);
    expect(steam.unmatched).toBe(1);

    const epic = runCorpus([epicOnly], [archive], { vars: { store: 'epic' } });
    expect(epic.matched).toBe(1);
    expect(epic.entries[0]?.matchedInstaller).toBe('pak');
  });

  it('matches a custom-hook installer on its predicate, ahead of a lower-priority declarative rule', () => {
    // A hook installer can't be planned statically; it should still be picked
    // (and reported viaHook) when its `when` matches, before the declarative rule.
    const hookRule: InstallerRule = {
      id: 'content-xml',
      priority: 5,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      hookName: 'installContentXml',
    };
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const report = runCorpus([pakRule, hookRule], [archive], { vars: {} });
    expect(report.matched).toBe(1);
    expect(report.entries[0]).toMatchObject({
      matchedInstaller: 'content-xml',
      viaHook: true,
      planSize: 0,
    });
  });

  it('falls through past a hook installer whose predicate does not match', () => {
    const hookRule: InstallerRule = {
      id: 'content-xml',
      priority: 5,
      when: { kind: 'hasFile', glob: '**/content.xml' },
      hookName: 'installContentXml',
    };
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const report = runCorpus([hookRule, pakRule], [archive], { vars: {} });
    expect(report.matched).toBe(1);
    expect(report.entries[0]?.matchedInstaller).toBe('pak');
    expect(report.entries[0]?.viaHook).toBeUndefined();
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
