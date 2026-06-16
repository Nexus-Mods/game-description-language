import { describe, it, expect, vi } from 'vitest';
import { GdlRuntime } from '../src/runtime/vortex-shim.js';
import type { ContextSpec } from '../src/runtime/context-resolver.js';
import type { IExtensionContext } from 'vortex-api';

const makeCtx = () => ({
  registerGame: vi.fn(),
  registerModType: vi.fn(),
  registerInstaller: vi.fn(),
  registerAction: vi.fn(),
  api: { getState: () => ({}), events: { on: vi.fn() } },
}) as unknown as IExtensionContext;

describe('GdlRuntime — installer scope.stores filtering', () => {
  it('skips installer when current store is not in scope', async () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.setDiscoveredStore('steam');

    const rule = {
      id: 'xbox-only',
      priority: 30,
      when: { kind: 'hasFile' as const, glob: '**/*.pak' },
      scope: { stores: ['xbox'] },
      single: {
        anchor: { kind: 'glob' as const, pattern: '**/*.pak' },
        take: 'parent' as const,
        placeAt: '/dest',
      },
      modType: 'pak',
    };
    runtime.registerInstallerRulePublic('subnautica2', rule);

    const registerInstaller = ctx.registerInstaller as ReturnType<typeof vi.fn>;
    const testFn = registerInstaller.mock.calls[0]![2];
    const result = await testFn(['Some/Mod/file.pak'], 'subnautica2');
    expect(result).toMatchObject({ supported: false });
  });

  it('runs installer when current store is in scope', async () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.setDiscoveredStore('xbox');

    const rule = {
      id: 'xbox-only',
      priority: 30,
      when: { kind: 'hasFile' as const, glob: '**/*.pak' },
      scope: { stores: ['xbox'] },
      single: {
        anchor: { kind: 'glob' as const, pattern: '**/*.pak' },
        take: 'parent' as const,
        placeAt: '/dest',
      },
      modType: 'pak',
    };
    runtime.registerInstallerRulePublic('subnautica2', rule);

    const registerInstaller = ctx.registerInstaller as ReturnType<typeof vi.fn>;
    const testFn = registerInstaller.mock.calls[0]![2];
    const result = await testFn(['Some/Mod/file.pak'], 'subnautica2');
    expect(result).toMatchObject({ supported: true });
  });

  it('runs installer when scope is unset (current behavior unchanged)', async () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.setDiscoveredStore('steam');

    const rule = {
      id: 'any-store',
      priority: 30,
      when: { kind: 'hasFile' as const, glob: '**/*.pak' },
      single: {
        anchor: { kind: 'glob' as const, pattern: '**/*.pak' },
        take: 'parent' as const,
        placeAt: '/dest',
      },
      modType: 'pak',
    };
    runtime.registerInstallerRulePublic('subnautica2', rule);

    const registerInstaller = ctx.registerInstaller as ReturnType<typeof vi.fn>;
    const testFn = registerInstaller.mock.calls[0]![2];
    const result = await testFn(['Some/Mod/file.pak'], 'subnautica2');
    expect(result).toMatchObject({ supported: true });
  });

  it('normalizes Vortex backslash paths for GDL planning but keeps raw copy source', async () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);

    const rule = {
      id: 'injector-repack',
      priority: 10,
      when: { kind: 'hasFile' as const, glob: '**/Win64/dwmapi.dll' },
      single: {
        anchor: { kind: 'glob' as const, pattern: '**/Win64/dwmapi.dll' },
        take: 'self' as const,
        placeAt: '/ignored-by-vortex',
      },
      modType: 'injector',
    };
    runtime.registerInstallerRulePublic('gothic1remake', rule);

    const files = [
      'G1R\\Binaries\\Win64\\dwmapi.dll',
      'G1R\\Binaries\\Win64\\UE4SS.dll',
    ];
    const registerInstaller = ctx.registerInstaller as ReturnType<typeof vi.fn>;
    const testFn = registerInstaller.mock.calls[0]![2];
    const installFn = registerInstaller.mock.calls[0]![3];

    await expect(testFn(files, 'gothic1remake')).resolves.toMatchObject({ supported: true });
    await expect(installFn(files, '', 'gothic1remake')).resolves.toEqual({
      instructions: [
        { type: 'copy', source: 'G1R\\Binaries\\Win64\\dwmapi.dll', destination: 'dwmapi.dll' },
        { type: 'setmodtype', value: 'injector' },
        { type: 'copy', source: 'G1R\\Binaries\\Win64\\UE4SS.dll', destination: 'UE4SS.dll' },
        { type: 'setmodtype', value: 'injector' },
      ],
    });
  });
});

describe('GdlRuntime — lazy modType getPath', () => {
  it('re-interpolates the modType path with the current game.gamePath', () => {
    const registerModType = vi.fn();
    const ctx = {
      registerGame: vi.fn(),
      registerModType,
      registerInstaller: vi.fn(),
      registerAction: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;
    const runtime = new GdlRuntime(ctx);
    runtime.setResolvedCtxForTesting({ installPath: '/initial' });
    runtime.registerModTypePublic('pak', 'Paks (~mods)', '${installPath}/Mods/Paks');

    const getPath = registerModType.mock.calls[0]![3];

    expect(getPath({ gamePath: '/initial' })).toBe('/initial/Mods/Paks');
    expect(getPath({ gamePath: '/relocated' })).toBe('/relocated/Mods/Paks');
  });

  it('falls back to resolvedCtx.installPath when game.gamePath is undefined', () => {
    const registerModType = vi.fn();
    const ctx = {
      registerGame: vi.fn(),
      registerModType,
      registerInstaller: vi.fn(),
      registerAction: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;
    const runtime = new GdlRuntime(ctx);
    runtime.setResolvedCtxForTesting({ installPath: '/fallback' });
    runtime.registerModTypePublic('pak', 'Paks (~mods)', '${installPath}/Mods/Paks');

    const getPath = registerModType.mock.calls[0]![3];
    expect(getPath({})).toBe('/fallback/Mods/Paks');
  });
});

describe('GdlRuntime — derives game.details store ids from stores', () => {
  const baseDecl = {
    id: 'subnautica2',
    name: 'Subnautica 2',
    executable: 'Subnautica2.exe',
    requiredFiles: ['Subnautica2.exe'],
  };
  const emptyCtxSpec = { bindings: [] } as unknown as ContextSpec;
  const registeredGame = (ctx: IExtensionContext) =>
    (ctx.registerGame as ReturnType<typeof vi.fn>).mock.calls[0]![0];

  it('projects each store id into details under <storeId>AppId, coercing numeric ids', () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(
      baseDecl,
      [
        { id: 'steam', value: '1962700' },
        { id: 'epic', value: '22bfc34d90b64054809542014fc9eb32' },
        { id: 'xbox', value: 'UnknownWorldsEntertainmen.Subnautica2' },
      ],
      emptyCtxSpec,
      [],
    );
    const { details } = registeredGame(ctx);
    expect(details).toMatchObject({
      steamAppId: 1962700,
      epicAppId: '22bfc34d90b64054809542014fc9eb32',
      xboxAppId: 'UnknownWorldsEntertainmen.Subnautica2',
    });
    expect(typeof details.steamAppId).toBe('number');
    expect(typeof details.epicAppId).toBe('string');
  });

  it('lets an explicit game.details entry override the derived value', () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(
      { ...baseDecl, details: { steamAppId: 999 } },
      [{ id: 'steam', value: '1962700' }],
      emptyCtxSpec,
      [],
    );
    expect(registeredGame(ctx).details.steamAppId).toBe(999);
  });

  it('skips the manual store (not a real store id)', () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(
      baseDecl,
      [{ id: 'manual', value: 'sideloaded' }],
      emptyCtxSpec,
      [],
    );
    expect(registeredGame(ctx).details).not.toHaveProperty('manualAppId');
  });
});
