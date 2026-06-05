import { describe, it, expect, vi } from 'vitest';
import { GdlRuntime } from '../src/runtime/vortex-shim.js';
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
