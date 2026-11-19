import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml } from '../src/parser/index.js';
import { emit } from '../src/codegen/emit.js';
import { buildExtension } from '../src/commands/build.js';
import { BuildErrors } from '../src/errors.js';
import { GdlRuntime, type LoadOrderDecl } from '../src/runtime/vortex-shim.js';
import { createFakeContext } from '../src/runtime/testing/index.js';
import type { IExtensionContext } from 'vortex-api';

// A declarative `loadOrder:` block that registers Vortex's load order page
// (context.registerLoadOrder) from deserialize / serialize / validate exports
// in src/hooks.ts.

const HEAD = `
gdl: 1
game:
  id: fakk2
  name: FAKK2
  executable: fakk2.exe
  requiredFiles: [fakk2.exe]
context:
  fakkPath: \${installPath}/fakk
modTypes:
  - { id: fakk, name: fakk, path: "\${fakkPath}" }
`;

const full = `${HEAD}
loadOrder:
  deserialize: { hook: readOrder }
  serialize: { hook: writeOrder }
  validate: { hook: checkOrder }
  toggleableEntries: true
  usageInstructions: |
    Drag paks to reorder.
    Later entries win.
`;

const minimal = `${HEAD}
loadOrder:
  deserialize: { hook: readOrder }
  serialize: { hook: writeOrder }
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

describe('loadOrder parsing', () => {
  it('parses the hooks and options', () => {
    const lo = parseYaml(full, 'inline.yaml').loadOrder;
    expect(lo).toMatchObject({
      kind: 'loadOrder',
      deserialize: { kind: 'hookRef', hookId: 'readOrder' },
      serialize: { kind: 'hookRef', hookId: 'writeOrder' },
      validate: { kind: 'hookRef', hookId: 'checkOrder' },
      toggleableEntries: true,
      usageInstructions: 'Drag paks to reorder.\nLater entries win.\n',
    });
  });

  it('leaves validate and the options out when not given', () => {
    const lo = parseYaml(minimal, 'inline.yaml').loadOrder!;
    expect(lo.validate).toBeUndefined();
    expect('toggleableEntries' in lo).toBe(false);
    expect('usageInstructions' in lo).toBe(false);
  });

  it('leaves loadOrder undefined when the block is absent', () => {
    expect(parseYaml(HEAD, 'inline.yaml').loadOrder).toBeUndefined();
  });

  it('rejects a non-mapping block (GDL210)', () => {
    expect(parseError(`${HEAD}\nloadOrder: [readOrder]\n`)).toBe('GDL210');
  });

  it('rejects a block missing serialize (GDL211)', () => {
    expect(parseError(`${HEAD}\nloadOrder:\n  deserialize: { hook: readOrder }\n`)).toBe('GDL211');
  });

  it('rejects a non-boolean toggleableEntries (GDL212)', () => {
    expect(parseError(`${minimal}  toggleableEntries: "yes"\n`)).toBe('GDL212');
  });

  it('rejects a non-string usageInstructions (GDL213)', () => {
    expect(parseError(`${minimal}  usageInstructions: [a]\n`)).toBe('GDL213');
  });

  it('rejects an unknown key (GDL214)', () => {
    expect(parseError(`${minimal}  sort: { hook: x }\n`)).toBe('GDL214');
  });

  it('rejects a bare string where a hook ref is expected (GDL060)', () => {
    expect(parseError(`${HEAD}\nloadOrder:\n  deserialize: readOrder\n  serialize: { hook: w }\n`)).toBe('GDL060');
  });
});

describe('loadOrder codegen', () => {
  it('passes the load order to registerGame via the hooks namespace', () => {
    const ext = emit(parseYaml(full, 'inline.yaml')).find(f => f.path === 'extension.ts')!.contents;
    expect(ext).toContain("import * as hooks from '../src/hooks.js'");
    expect(ext).toContain('deserialize: hooks.readOrder,');
    expect(ext).toContain('serialize: hooks.writeOrder,');
    expect(ext).toContain('validate: hooks.checkOrder,');
    expect(ext).toContain('toggleableEntries: true,');
    // multi-line text survives as one string literal
    expect(ext).toContain('usageInstructions: "Drag paks to reorder.\\nLater entries win.\\n",');
  });

  it('emits only the declared keys', () => {
    const ext = emit(parseYaml(minimal, 'inline.yaml')).find(f => f.path === 'extension.ts')!.contents;
    expect(ext).toContain('deserialize: hooks.readOrder,');
    expect(ext).not.toContain('validate:');
    expect(ext).not.toContain('toggleableEntries');
    expect(ext).not.toContain('usageInstructions');
  });

  it('emits a lifecycle check for load order registration', () => {
    const lifecycle = emit(parseYaml(full, 'inline.yaml')).find(f => f.path === 'lifecycle.gen.ts')!.contents;
    expect(lifecycle).toContain("import * as hooks from '../src/hooks.js'");
    expect(lifecycle).toContain('lifecycle: load order registration');
    expect(lifecycle).toContain("expect(lo.gameId).toBe('fakk2')");
    expect(lifecycle).toContain('expect(lo.toggleableEntries).toBe(true)');
    expect(lifecycle).toContain("vi.spyOn(hooks, 'readOrder')");
    expect(lifecycle).toContain("vi.spyOn(hooks, 'checkOrder')");
    expect(lifecycle).toContain('afterEach');
  });

  it('leaves games without a load order unchanged', () => {
    const files = emit(parseYaml(HEAD, 'inline.yaml'));
    const ext = files.find(f => f.path === 'extension.ts')!.contents;
    const lifecycle = files.find(f => f.path === 'lifecycle.gen.ts')!.contents;
    expect(ext).not.toContain('hooks.');
    expect(ext).toMatch(/\],\n {4}undefined,\n {2}\);/);
    expect(lifecycle).not.toContain('load order registration');
  });
});

describe('loadOrder runtime registration', () => {
  const register = (ctx: IExtensionContext, loadOrder?: LoadOrderDecl) => {
    const runtime = new GdlRuntime(ctx);
    runtime.setLiveDiscoveryForTesting(() => ({ path: 'C:/Games/FAKK2' }));
    runtime.registerGame(
      { id: 'fakk2', name: 'FAKK2', executable: 'fakk2.exe', requiredFiles: ['fakk2.exe'] },
      [],
      { bindings: [{ name: 'fakkPath', value: { kind: 'interpolated', template: '${installPath}/fakk' } }] },
      [], [], {}, [], [], {}, [], [], loadOrder,
    );
  };

  const entries = [{ id: 'pak9.pk3', name: 'pak9', enabled: true }];

  it('registers under the game id with the declared options', () => {
    const h = createFakeContext();
    register(h.context as IExtensionContext, {
      deserialize: async () => [], serialize: async () => {},
      toggleableEntries: true, usageInstructions: 'Drag.',
    });
    expect(h.registered.loadOrders).toHaveLength(1);
    expect(h.registered.loadOrders[0]).toMatchObject({
      gameId: 'fakk2', toggleableEntries: true, usageInstructions: 'Drag.',
    });
  });

  it('passes Vortex arguments plus api and the resolved context to each hook', async () => {
    const h = createFakeContext();
    const deserialize = vi.fn(async () => entries);
    const serialize = vi.fn(async () => {});
    const validate = vi.fn(async () => ({ invalid: [{ id: 'pak9.pk3', reason: 'x' }] }));
    register(h.context as IExtensionContext, { deserialize, serialize, validate });
    const lo = h.registered.loadOrders[0]!;
    const ctx = {
      api: (h.context as IExtensionContext).api,
      gameId: 'fakk2',
      vars: expect.objectContaining({ installPath: 'C:/Games/FAKK2', fakkPath: 'C:/Games/FAKK2/fakk' }),
    };

    await expect(lo.deserializeLoadOrder()).resolves.toBe(entries);
    expect(deserialize).toHaveBeenCalledWith(ctx);

    await lo.serializeLoadOrder(entries, []);
    expect(serialize).toHaveBeenCalledWith(entries, [], ctx);

    await expect(lo.validate([], entries)).resolves.toEqual({ invalid: [{ id: 'pak9.pk3', reason: 'x' }] });
    expect(validate).toHaveBeenCalledWith([], entries, ctx);
  });

  it('accepts every order when validate is omitted', async () => {
    const h = createFakeContext();
    register(h.context as IExtensionContext, { deserialize: async () => [], serialize: async () => {} });
    const lo = h.registered.loadOrders[0]!;
    await expect(lo.validate([], entries)).resolves.toBeUndefined();
    expect('toggleableEntries' in lo).toBe(false);
    expect('usageInstructions' in lo).toBe(false);
  });

  it('registers nothing without a load order', () => {
    const h = createFakeContext();
    register(h.context as IExtensionContext);
    expect(h.registered.loadOrders).toHaveLength(0);
  });
});

describe('loadOrder build', () => {
  it('requires the hooks to be exported from src/hooks.ts', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-loadorder-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'with-load-order'), work, { recursive: true });
    const yaml = readFileSync(join(work, 'game.yaml'), 'utf8').replace('validateLoadOrder', 'validateMissing');
    writeFileSync(join(work, 'game.yaml'), yaml);

    await expect(buildExtension({ cwd: work })).rejects.toSatisfy((e: unknown) =>
      e instanceof BuildErrors && e.errors.some(err => err.message.includes('validateMissing')));
  }, 60000);

  it('bundles registerLoadOrder for a game with a load order', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-loadorder-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'with-load-order'), work, { recursive: true });
    await buildExtension({ cwd: work });
    const bundle = readFileSync(join(work, 'dist', 'index.js'), 'utf8');
    expect(bundle).toMatch(/registerLoadOrder/);
    expect(bundle).toMatch(/readLoadOrder/);
    expect(bundle).toMatch(/Drag paks: later entries load last and win\./);
  }, 60000);
});
