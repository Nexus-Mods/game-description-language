import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadExtensionBundle, runExecutionCorpus } from '../src/corpus/execution-runner.js';

const BUNDLE = join(import.meta.dirname, 'fixtures', 'exec-bundle', 'index.cjs');
const ARCHIVE = join(import.meta.dirname, 'fixtures', 'corpus-archives', '999_111_222_contentmod.json');

describe('corpus execution runner', () => {
  it('loads a bundle with the vortex-api mock injected and captures registrations', () => {
    const ext = loadExtensionBundle(BUNDLE);
    expect(ext.gameId).toBe('exectest');
    expect(ext.installers.map(i => i.id)).toEqual(['content-xml']);
    expect(ext.healthChecks.map(h => h.id)).toEqual(['has-custom-name']);
  });

  it('runs the real installer hook (reading synthetic content) and the health check', async () => {
    const ext = loadExtensionBundle(BUNDLE);
    const report = await runExecutionCorpus(ext, [ARCHIVE], {
      'content.xml': '<content id="mod-${manifestId}" name="Test ${manifestId}"/>',
    });

    expect(report.total).toBe(1);
    expect(report.matched).toBe(1);
    expect(report.failed).toBe(0);
    const entry = report.entries[0]!;
    expect(entry.matchedInstaller).toBe('content-xml');
    // The hook read the synthetic content.xml (manifestId derived from the
    // archive name 999_111_222_*) and based its output on the parsed id.
    expect(entry.planSize).toBe(2); // content.xml + data.cat, re-rooted under the id
    expect(entry.healthIssues).toEqual([]); // health check saw the customFileName attribute
  });

  it('reports a health-check failure when the hook output is missing the attribute', async () => {
    const ext = loadExtensionBundle(BUNDLE);
    // Empty synthetic content -> hook throws DataInvalid (no id) -> reported as error.
    const report = await runExecutionCorpus(ext, [ARCHIVE], {});
    expect(report.failed).toBe(1);
    expect(report.entries[0]!.error).toMatch(/content\.xml missing id|DataInvalid/i);
  });
});
