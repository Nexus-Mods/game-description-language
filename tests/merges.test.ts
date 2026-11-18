import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml } from '../src/parser/index.js';
import { validate } from '../src/schema/validator.js';
import { emit } from '../src/codegen/emit.js';
import { buildExtension } from '../src/commands/build.js';
import { BuildErrors } from '../src/errors.js';
import { GdlRuntime } from '../src/runtime/vortex-shim.js';
import { createFakeContext } from '../src/runtime/testing/index.js';
import type { IExtensionContext } from 'vortex-api';

// A declarative `merges:` block that registers Vortex file merges
// (context.registerMerge) from MergeTest / MergeFunc exports in src/hooks.ts.

const HEAD = `
gdl: 1
game:
  id: mafia2
  name: Mafia II
  executable: Mafia2.exe
  requiredFiles: [Mafia2.exe]
modTypes:
  - { id: root, name: Root, path: "\${installPath}" }
`;

const withMerges = `${HEAD}
merges:
  - { test: { hook: isTablesSds }, merge: { hook: mergeTablesSds }, modType: root }
  - { test: { hook: isStreamIni }, merge: { hook: mergeStreamIni } }
`;

const parseError = (yaml: string): string | undefined => {
  try {
    parseYaml(yaml, 'inline.yaml');
  } catch (e) {
    if (e instanceof BuildErrors) return e.errors[0]?.code;
    throw e;
  }
  return undefined;
};

describe('merges parsing', () => {
  it('parses test/merge hook refs and an optional modType', () => {
    const doc = parseYaml(withMerges, 'inline.yaml');
    expect(doc.merges).toHaveLength(2);
    expect(doc.merges![0]).toMatchObject({
      kind: 'merge',
      test: { kind: 'hookRef', hookId: 'isTablesSds' },
      merge: { kind: 'hookRef', hookId: 'mergeTablesSds' },
      modType: 'root',
    });
    expect(doc.merges![1]!.modType).toBeUndefined();
  });

  it('leaves merges undefined when the block is absent', () => {
    expect(parseYaml(HEAD, 'inline.yaml').merges).toBeUndefined();
  });

  it('rejects a non-mapping entry (GDL200)', () => {
    expect(parseError(`${HEAD}\nmerges:\n  - isTablesSds\n`)).toBe('GDL200');
  });

  it('rejects an entry missing merge (GDL201)', () => {
    expect(parseError(`${HEAD}\nmerges:\n  - { test: { hook: isTablesSds } }\n`)).toBe('GDL201');
  });

  it('rejects a non-string modType (GDL202)', () => {
    expect(parseError(`${HEAD}\nmerges:\n  - { test: { hook: a }, merge: { hook: b }, modType: [root] }\n`)).toBe('GDL202');
  });

  it('rejects a bare string where a hook ref is expected (GDL060)', () => {
    expect(parseError(`${HEAD}\nmerges:\n  - { test: isTablesSds, merge: { hook: b } }\n`)).toBe('GDL060');
  });
});

describe('merges validation', () => {
  it('accepts declared and omitted modTypes', () => {
    const doc = parseYaml(withMerges, 'inline.yaml');
    expect(validate(doc).filter(e => e.code.startsWith('GDL20'))).toHaveLength(0);
  });

  it('flags an undeclared modType (GDL203)', () => {
    const doc = parseYaml(`${HEAD}\nmerges:\n  - { test: { hook: a }, merge: { hook: b }, modType: pak }\n`, 'inline.yaml');
    const err = validate(doc).find(e => e.code === 'GDL203');
    expect(err?.message).toContain('`pak`');
    expect(err?.hint).toContain('root');
  });

  it('flags a duplicate test/merge/modType entry (GDL204)', () => {
    const doc = parseYaml(`${HEAD}
merges:
  - { test: { hook: a }, merge: { hook: b }, modType: root }
  - { test: { hook: a }, merge: { hook: b }, modType: root }
  - { test: { hook: a }, merge: { hook: b } }
`, 'inline.yaml');
    expect(validate(doc).filter(e => e.code === 'GDL204')).toHaveLength(1);
  });
});

describe('merges codegen', () => {
  it('passes each merge to registerGame via the hooks namespace', () => {
    const files = emit(parseYaml(withMerges, 'inline.yaml'));
    const ext = files.find(f => f.path === 'extension.ts')!.contents;
    expect(ext).toContain("import * as hooks from '../src/hooks.js'");
    expect(ext).toContain("{ test: hooks.isTablesSds, merge: hooks.mergeTablesSds, modType: 'root' }");
    expect(ext).toContain("{ test: hooks.isStreamIni, merge: hooks.mergeStreamIni, modType: '' }");
  });

  it('emits a lifecycle check for merge registration', () => {
    const files = emit(parseYaml(withMerges, 'inline.yaml'));
    const lifecycle = files.find(f => f.path === 'lifecycle.gen.ts')!.contents;
    expect(lifecycle).toContain("import * as hooks from '../src/hooks.js'");
    expect(lifecycle).toContain("lifecycle: merge registration");
    expect(lifecycle).toContain("toEqual(['root', ''])");
    expect(lifecycle).toContain('.merge).toBe(hooks.mergeTablesSds)');
    expect(lifecycle).toContain("vi.spyOn(hooks, 'isTablesSds')");
    // No setup/queryModPath scenarios: the per-store suite must be omitted,
    // since vitest fails a describe() that contains no tests.
    expect(lifecycle).not.toContain("describe('mafia2 — lifecycle',");
  });

  it('leaves games without merges unchanged', () => {
    const files = emit(parseYaml(HEAD, 'inline.yaml'));
    const ext = files.find(f => f.path === 'extension.ts')!.contents;
    const lifecycle = files.find(f => f.path === 'lifecycle.gen.ts')!.contents;
    expect(ext).not.toContain('hooks.');
    expect(lifecycle).not.toContain('merge registration');
  });
});

describe('merges runtime registration', () => {
  const register = (ctx: IExtensionContext, merges: Parameters<GdlRuntime['registerGame']>[10]) =>
    new GdlRuntime(ctx).registerGame(
      { id: 'mafia2', name: 'Mafia II', executable: 'Mafia2.exe', requiredFiles: ['Mafia2.exe'] },
      [], { bindings: [] }, [], [], {}, [], [], {}, [], merges,
    );

  it('registers each merge via context.registerMerge with its modType and merge fn', () => {
    const h = createFakeContext();
    const merge = vi.fn(async () => {});
    register(h.context as IExtensionContext, [
      { test: () => ({ baseFiles: () => [], filter: () => true }), merge, modType: 'root' },
    ]);
    expect(h.registered.merges).toHaveLength(1);
    expect(h.registered.merges[0]!.modType).toBe('root');
    expect(h.registered.merges[0]!.merge).toBe(merge);
  });

  it('gates the merge test to this game', () => {
    const h = createFakeContext();
    const filter = { baseFiles: () => [], filter: () => true };
    const test = vi.fn(() => filter);
    register(h.context as IExtensionContext, [{ test, merge: async () => {}, modType: '' }]);
    const registered = h.registered.merges[0]!;

    expect(registered.test({ id: 'skyrimse' }, {})).toBeUndefined();
    expect(test).not.toHaveBeenCalled();

    const discovery = { path: 'C:/Games/Mafia II' };
    expect(registered.test({ id: 'mafia2' }, discovery)).toBe(filter);
    expect(test).toHaveBeenCalledWith({ id: 'mafia2' }, discovery);
  });

  it('registers nothing when no merges are declared', () => {
    const h = createFakeContext();
    register(h.context as IExtensionContext, []);
    expect(h.registered.merges).toHaveLength(0);
  });
});

describe('merges build', () => {
  it('requires both hooks to be exported from src/hooks.ts', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-merges-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'with-merges'), work, { recursive: true });
    const yaml = readFileSync(join(work, 'game.yaml'), 'utf8')
      .replace('mergeTablesSds', 'mergeMissing');
    writeFileSync(join(work, 'game.yaml'), yaml);

    await expect(buildExtension({ cwd: work })).rejects.toSatisfy((e: unknown) =>
      e instanceof BuildErrors && e.errors.some(err => err.message.includes('mergeMissing')));
  }, 60000);

  it('bundles registerMerge for a game with merges', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-merges-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'with-merges'), work, { recursive: true });
    await buildExtension({ cwd: work });
    const bundle = readFileSync(join(work, 'dist', 'index.js'), 'utf8');
    expect(bundle).toMatch(/registerMerge/);
    expect(bundle).toMatch(/mergeTablesSds/);
  }, 60000);
});
