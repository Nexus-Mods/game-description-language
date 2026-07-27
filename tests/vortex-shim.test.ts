import { describe, it, expect, vi, afterEach } from 'vitest';
import { GdlRuntime } from '../src/runtime/vortex-shim.js';
import type { ContextSpec } from '../src/runtime/context-resolver.js';
import type { IExtensionContext } from 'vortex-api';
import { fs } from 'vortex-api';

const makeCtx = () => ({
  registerGame: vi.fn(),
  registerModType: vi.fn(),
  registerInstaller: vi.fn(),
  registerAction: vi.fn(),
  api: { getState: () => ({}), events: { on: vi.fn() } },
}) as unknown as IExtensionContext;

describe('GdlRuntime — custom installer hook', () => {
  it('testSupported uses `when`; install delegates to the hook with raw paths + destinationPath', async () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);

    const hook = vi.fn(async (files: readonly string[], destinationPath: string, gid: string) => {
      void files; void destinationPath; void gid;
      return {
        instructions: [
          { type: 'attribute', key: 'customFileName', value: 'My Mod' },
          { type: 'copy', source: 'Mod/content.xml', destination: 'out/content.xml' },
        ],
      };
    });

    const rule = {
      id: 'content-xml',
      priority: 50,
      when: { kind: 'hasFile' as const, glob: '**/content.xml' },
      installHook: hook,
    };
    runtime.registerInstallerRulePublic('xrebirth', rule);

    const registerInstaller = ctx.registerInstaller as ReturnType<typeof vi.fn>;
    const [id, priority, testFn, installFn] = registerInstaller.mock.calls[0]!;
    expect(id).toBe('content-xml');
    expect(priority).toBe(50);

    // when matches -> supported
    expect(await testFn(['Mod/content.xml'], 'xrebirth')).toMatchObject({ supported: true });
    // when does not match -> not supported
    expect(await testFn(['Mod/other.txt'], 'xrebirth')).toMatchObject({ supported: false });

    const files = ['Mod\\content.xml', 'Mod\\data\\01.cat'];
    const result = await installFn(files, '/tmp/install', 'xrebirth');
    // Hook receives the RAW (un-normalised) Vortex paths and the destinationPath.
    expect(hook).toHaveBeenCalledWith(files, '/tmp/install', 'xrebirth');
    // Instructions pass through unchanged (including the attribute instruction).
    expect(result.instructions).toEqual([
      { type: 'attribute', key: 'customFileName', value: 'My Mod' },
      { type: 'copy', source: 'Mod/content.xml', destination: 'out/content.xml' },
    ]);
  });

  it('returns no instructions for a different game id', async () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    const hook = vi.fn(async () => ({ instructions: [] }));
    runtime.registerInstallerRulePublic('xrebirth', {
      id: 'content-xml', priority: 50,
      when: { kind: 'hasFile' as const, glob: '**/content.xml' },
      installHook: hook,
    });
    const registerInstaller = ctx.registerInstaller as ReturnType<typeof vi.fn>;
    const installFn = registerInstaller.mock.calls[0]![3];
    const result = await installFn(['Mod/content.xml'], '/tmp', 'other-game');
    expect(result.instructions).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
  });
});

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

describe('GdlRuntime — environment.SteamAPPId derivation', () => {
  it('sets environment.SteamAPPId from the steam store (details.steamAppId comes from deriveStoreDetails)', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(
      { id: 'xrebirth', name: 'X Rebirth', executable: 'XRebirth.exe', requiredFiles: ['XRebirth.exe'] },
      [{ id: 'steam', value: '2870' }],
      { bindings: [] },
      [],
    );
    const registerGame = ctx.registerGame as ReturnType<typeof vi.fn>;
    const game = registerGame.mock.calls[0]![0];
    // environment is an env-var bag, so the app id stays a string here, while
    // details.steamAppId is the numeric form coerced by deriveStoreDetails.
    expect(game.environment).toEqual({ SteamAPPId: '2870' });
    expect(game.details.steamAppId).toBe(2870);
  });

  it('omits steam-derived fields when there is no steam store', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(
      { id: 'g', name: 'G', executable: 'G.exe', requiredFiles: ['G.exe'] },
      [{ id: 'gog', value: '123' }],
      { bindings: [] },
      [],
    );
    const registerGame = ctx.registerGame as ReturnType<typeof vi.fn>;
    const game = registerGame.mock.calls[0]![0];
    expect(game.environment).toBeUndefined();
    expect(game.details.steamAppId).toBeUndefined();
  });
});

describe('GdlRuntime — nexusDomain in details', () => {
  it('maps nexusDomain to details.nexusPageId', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);

    runtime.registerGame(
      { id: 'test', name: 'Test', executable: 'Test.exe', requiredFiles: ['Test.exe'], nexusDomain: 'testgame' },
      [],
      { bindings: [] },
      [],
    );

    const registerGame = ctx.registerGame as ReturnType<typeof vi.fn>;
    const game = registerGame.mock.calls[0]![0];
    expect(game.details.nexusPageId).toBe('testgame');
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

// Regression: the CI runner is Linux, but games like Paralives target Windows
// and deploy to ${appDataLocalLow}. factsFromDiscovery used to gate the ENTIRE
// appData population behind `process.platform === 'win32'`, so on Linux the
// appData vars injected on the discovery object were discarded and setup()
// threw "unbound variable `appDataLocalLow`" — passing on a Windows dev machine
// but failing on CI. The fix: honor discovery-supplied appData on ANY host;
// only the env-derivation FALLBACK stays Windows-gated.
describe('GdlRuntime — setup() honors injected appData regardless of host OS', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    vi.clearAllMocks();
  });

  const runSetupOnPlatform = async (platform: string) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    const registerGame = vi.fn();
    const ctx = {
      registerGame,
      registerModType: vi.fn(),
      registerInstaller: vi.fn(),
      registerAction: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;

    new GdlRuntime(ctx).registerGame(
      { id: 'paraish', name: 'Paraish', executable: 'p.exe', requiredFiles: ['p.exe'] },
      [{ id: 'steam', value: '111' }],
      { bindings: [{ name: 'localModsPath', value: { kind: 'interpolated', template: '${appDataLocalLow}/Paraish' } }] },
      [],
      [],
      {},
      [],
      ['${localModsPath}'], // setup.ensureDirs
    );

    const game = registerGame.mock.calls[0]![0] as { setup: (d: unknown) => Promise<void> };
    await game.setup({
      path: '/games/paraish',
      store: 'steam',
      // Sentinels the codegen lifecycle harness injects; must be honored on Linux too.
      appDataLocal: '/fake/AppData/Local',
      appDataLocalLow: '/fake/AppData/LocalLow',
      appDataRoaming: '/fake/AppData/Roaming',
    });
    return vi.mocked(fs.ensureDirWritableAsync).mock.calls.map(c => c[0]);
  };

  it('resolves ${appDataLocalLow} from the injected sentinel on a Linux host (CI)', async () => {
    const calls = await runSetupOnPlatform('linux');
    expect(calls).toContain('/fake/AppData/LocalLow/Paraish');
  });

  it('resolves the same on a Windows host', async () => {
    const calls = await runSetupOnPlatform('win32');
    expect(calls).toContain('/fake/AppData/LocalLow/Paraish');
  });
});

describe('GdlRuntime — store-specific executable', () => {
  const makeCtx = () => ({
    registerGame: vi.fn(),
    registerModType: vi.fn(),
    registerInstaller: vi.fn(),
    registerAction: vi.fn(),
    api: { getState: () => ({}), events: { on: vi.fn() } },
  }) as unknown as IExtensionContext;

  const emptyCtxSpec = { bindings: [] } as unknown as ContextSpec;
  const registeredGame = (ctx: IExtensionContext) =>
    (ctx.registerGame as ReturnType<typeof vi.fn>).mock.calls[0]![0];

  const lit = (raw: string) => ({ kind: 'literal' as const, raw });
  const branchedExe = {
    kind: 'storeBranch' as const,
    arms: { xbox: lit('Meteorite/Binaries/WinGDK/Halo.exe') },
    default: lit('Meteorite/Binaries/Win64/Halo.exe'),
  };
  const branchedDecl = {
    id: 'halo',
    name: 'Halo',
    executable: branchedExe,
    requiredFiles: ['Meteorite/Content/Paks/global.utoc'],
  };

  // A scalar executable must behave exactly as before — this is the regression
  // guard for the eight games that don't branch.
  it('scalar executable returns the literal for both the no-arg and path-aware call', () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(
      { id: 'sn2', name: 'Subnautica 2', executable: 'Subnautica2.exe', requiredFiles: ['Subnautica2.exe'] },
      [{ id: 'steam', value: '1962700' }],
      emptyCtxSpec,
      [],
    );
    const { executable } = registeredGame(ctx);
    expect(executable()).toBe('Subnautica2.exe');
    expect(executable('/games/sn2')).toBe('Subnautica2.exe');
  });

  it('resolves the xbox arm when the discovered store is xbox', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(branchedDecl, [{ id: 'xbox', value: 'Microsoft.X' }], emptyCtxSpec, []);
    runtime.setDiscoveredStore('xbox');
    expect(registeredGame(ctx).executable('/games/halo')).toBe('Meteorite/Binaries/WinGDK/Halo.exe');
  });

  it('resolves the default arm for a non-xbox store', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(branchedDecl, [{ id: 'steam', value: '1' }], emptyCtxSpec, []);
    runtime.setDiscoveredStore('steam');
    expect(registeredGame(ctx).executable('/games/halo')).toBe('Meteorite/Binaries/Win64/Halo.exe');
  });

  // The case that makes discovery.executable actually persist: Vortex calls
  // executable(path) during discovery, before any store is recorded.
  it('probes the filesystem when the store is not yet known', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(branchedDecl, [{ id: 'xbox', value: 'Microsoft.X' }], emptyCtxSpec, []);
    runtime.setLiveDiscoveryForTesting(() => undefined);
    runtime.setFileExistsForTesting(p => p.includes('WinGDK'));
    expect(registeredGame(ctx).executable('/games/halo')).toBe('Meteorite/Binaries/WinGDK/Halo.exe');
  });

  it('falls back to the default arm when no candidate exists on disk', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(branchedDecl, [{ id: 'xbox', value: 'Microsoft.X' }], emptyCtxSpec, []);
    runtime.setLiveDiscoveryForTesting(() => undefined);
    runtime.setFileExistsForTesting(() => false);
    expect(registeredGame(ctx).executable('/games/halo')).toBe('Meteorite/Binaries/Win64/Halo.exe');
  });

  // Vortex caches the no-arg call as IGameStored.executable and uses it as the
  // Play-button fallback, so it must never depend on the discovered store.
  it('no-arg call always returns the default arm, even when the store is xbox', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(branchedDecl, [{ id: 'xbox', value: 'Microsoft.X' }], emptyCtxSpec, []);
    runtime.setDiscoveredStore('xbox');
    expect(registeredGame(ctx).executable()).toBe('Meteorite/Binaries/Win64/Halo.exe');
  });

  it('never throws when live discovery or the filesystem probe blows up', () => {
    const ctx = makeCtx();
    const runtime = new GdlRuntime(ctx);
    runtime.registerGame(branchedDecl, [{ id: 'xbox', value: 'Microsoft.X' }], emptyCtxSpec, []);
    runtime.setLiveDiscoveryForTesting(() => { throw new Error('state not ready'); });
    runtime.setFileExistsForTesting(() => { throw new Error('EACCES'); });
    expect(() => registeredGame(ctx).executable('/games/halo')).not.toThrow();
  });
});

describe('GdlRuntime — xbox requiresLauncher', () => {
  const makeCtx = () => ({
    registerGame: vi.fn(),
    registerModType: vi.fn(),
    registerInstaller: vi.fn(),
    registerAction: vi.fn(),
    api: { getState: () => ({}), events: { on: vi.fn() } },
  }) as unknown as IExtensionContext;
  const emptyCtxSpec = { bindings: [] } as unknown as ContextSpec;
  const registeredGame = (ctx: IExtensionContext) =>
    (ctx.registerGame as ReturnType<typeof vi.fn>).mock.calls[0]![0];

  const decl = {
    id: 'halo',
    name: 'Halo',
    executable: 'Meteorite/Binaries/Win64/Halo.exe',
    requiredFiles: ['Meteorite/Content/Paks/global.utoc'],
    xboxLauncher: { appId: 'Microsoft.198377053870B', appExecName: 'AppHaloShipping' },
  };

  it('routes xbox through the store launcher with appId and appExecName', async () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(decl, [{ id: 'xbox', value: 'Microsoft.198377053870B' }], emptyCtxSpec, []);
    const res = await registeredGame(ctx).requiresLauncher('/games/halo', 'xbox');
    expect(res).toEqual({
      launcher: 'xbox',
      addInfo: {
        appId: 'Microsoft.198377053870B',
        parameters: [{ appExecName: 'AppHaloShipping' }],
      },
    });
    // gamestore-xbox does appInfo.parameters.find(...) unguarded — a missing or
    // empty array is a TypeError there.
    expect(res.addInfo.parameters.length).toBeGreaterThan(0);
  });

  it('returns undefined for non-xbox stores so they launch the exe directly', async () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(decl, [{ id: 'xbox', value: 'Microsoft.X' }], emptyCtxSpec, []);
    const { requiresLauncher } = registeredGame(ctx);
    expect(await requiresLauncher('/games/halo', 'steam')).toBeUndefined();
    expect(await requiresLauncher('/games/halo', undefined)).toBeUndefined();
  });

  it('is absent entirely when the game declares no xboxLauncher', () => {
    const ctx = makeCtx();
    new GdlRuntime(ctx).registerGame(
      { id: 'sn2', name: 'Subnautica 2', executable: 'Subnautica2.exe', requiredFiles: ['Subnautica2.exe'] },
      [{ id: 'steam', value: '1' }],
      emptyCtxSpec,
      [],
    );
    expect(registeredGame(ctx).requiresLauncher).toBeUndefined();
  });
});
