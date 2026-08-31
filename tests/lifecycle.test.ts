// Lifecycle integration tests for GdlRuntime. These exercise the same call
// sequence Vortex uses at extension-load time:
//   new GdlRuntime(context) → registerGame(...) → context.once() → setup(discovery)
//   → installer testSupported/install → modtype getPath
//
// The aim is to catch bugs that only manifest when the runtime is wired up to
// a Vortex-shaped context — not the per-module unit tests in the other
// test files. Three of the bugs that shipped in game-subnautica2 1.1.0 would
// have been caught here if these existed at the time:
//   1. setup() ignored its discovery argument and silently produced an empty
//      context, causing interpolate() to throw "unbound variable".
//   2. did-deploy event listener registered synchronously during registerGame,
//      before api.events was populated by Vortex.
//   3. queryModPath returned a constant "." regardless of the configured
//      template, sending "Open mods folder" to the game root.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GdlRuntime } from '../src/runtime/index.js';
import { createFakeContext, type FakeContextHandle, type FakeIGame } from '../src/runtime/testing/index.js';
import type { ContextSpec } from '../src/runtime/context-resolver.js';
import type { InstallerRule } from '../src/runtime/installer-engine.js';
import type { IExtensionContext } from 'vortex-api';

// Minimal but realistic spec: covers literal, interpolated, and storeBranch
// values plus a setup template that needs context resolution.
const STORES = [
  { id: 'steam', value: '12345' },
  { id: 'xbox',  value: 'Publisher.GameId' },
];

const CONTEXT_SPEC: ContextSpec = {
  bindings: [
    {
      name: 'arch',
      value: {
        kind: 'storeBranch',
        arms: { xbox: { kind: 'literal', raw: 'WinGDK' } },
        default: { kind: 'literal', raw: 'Win64' },
      },
    },
    { name: 'gamePath',     value: { kind: 'interpolated', template: '${installPath}/Game' } },
    { name: 'modsRoot',     value: { kind: 'interpolated', template: '${gamePath}/Content/Mods' } },
    { name: 'binariesPath', value: { kind: 'interpolated', template: '${gamePath}/Binaries/${arch}' } },
  ],
};

const MOD_TYPES = [
  { id: 'fake-pak',  name: 'Pak mods', path: { kind: 'interpolated' as const, template: '${modsRoot}' } },
  { id: 'fake-root', name: 'Root',     path: { kind: 'interpolated' as const, template: '${installPath}' } },
];

const GAME_DECL = {
  id: 'fakegame',
  name: 'Fake Game',
  executable: 'FakeGame.exe',
  requiredFiles: ['FakeGame.exe'],
  queryModPath: '${modsRoot}',
};

const SETUP_DIRS = ['${modsRoot}', '${binariesPath}'];

const buildRuntime = (): { h: FakeContextHandle; runtime: GdlRuntime } => {
  const h = createFakeContext();
  const runtime = new GdlRuntime(h.context as IExtensionContext);
  return { h, runtime };
};

const game = (h: FakeContextHandle): FakeIGame => {
  if (!h.registered.game) throw new Error('extension did not register a game');
  return h.registered.game;
};

describe('GdlRuntime: registerGame', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not throw — registers game/installers/modtypes synchronously', () => {
    const { h, runtime } = buildRuntime();
    expect(() => {
      runtime.registerGame(GAME_DECL, STORES, CONTEXT_SPEC, MOD_TYPES);
    }).not.toThrow();
    expect(h.registered.game?.id).toBe('fakegame');
    expect(h.registered.modTypes).toHaveLength(2);
  });

  // The whole point of deploymentEssential is what Vortex receives, so assert
  // the options bag rather than the declaration.
  it('passes deploymentEssential through to registerModType, and omits it when unset', () => {
    const { h, runtime } = buildRuntime();
    runtime.registerGame(GAME_DECL, STORES, CONTEXT_SPEC, [
      ...MOD_TYPES,
      {
        id: 'fake-config',
        name: 'Config',
        path: { kind: 'interpolated' as const, template: '${installPath}/Config' },
        deploymentEssential: false,
      },
    ]);

    const byId = new Map(h.registered.modTypes.map(mt => [mt.id, mt.options]));
    expect(byId.get('fake-config')).toMatchObject({ deploymentEssential: false });
    // Absent must not appear at all: Vortex defaults to essential, and an
    // explicit `true` would mean we own a value we never chose.
    expect(byId.get('fake-pak')).not.toHaveProperty('deploymentEssential');
  });

  it('did-deploy listener is deferred to context.once(), not wired synchronously', async () => {
    // Repro of game-subnautica2 GH #6. Vortex's IExtensionContext docs require
    // api-touching wiring to happen inside the once() callback because api is
    // not fully populated at registerGame time. Wire-during-registration
    // crashes on real Vortex with "Cannot read properties of undefined
    // (reading 'on')".
    const { h, runtime } = buildRuntime();
    const didDeploy = vi.fn(async () => {});
    runtime.registerGame(
      GAME_DECL, STORES, CONTEXT_SPEC, MOD_TYPES, [], {}, [], [], { didDeploy },
    );

    // Before once() fires, no listener should be on the bus.
    expect(h.events.get('did-deploy') ?? []).toHaveLength(0);
    await h.runOnce();
    expect(h.events.get('did-deploy') ?? []).toHaveLength(1);

    // And firing the event actually invokes the user hook.
    h.emit('did-deploy', 'profile-1', { ok: true });
    await new Promise(r => setImmediate(r));
    expect(didDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-1', deployment: { ok: true } }),
    );
  });
});

describe('GdlRuntime: setup(discovery)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds context from the discovery argument — no fallback to GameStoreHelper', async () => {
    // Repro of game-subnautica2 Nexus bug 1086633 / GH issue (the
    // unbound-variable crash). The old setup() ignored its argument and asked
    // GameStoreHelper.findByAppId; when that returned nothing it silently
    // returned an empty context and interpolate() threw `unbound variable`.
    const { h, runtime } = buildRuntime();
    runtime.registerGame(
      GAME_DECL, STORES, CONTEXT_SPEC, MOD_TYPES, [], {}, [], SETUP_DIRS,
    );

    const g = game(h);
    await expect(g.setup!({ path: '/installs/FakeGame', store: 'steam' }))
      .resolves.not.toThrow();

    const { fs } = await import('vortex-api');
    const calls = vi.mocked(fs.ensureDirWritableAsync).mock.calls.map(c => c[0]);
    expect(calls).toContain('/installs/FakeGame/Game/Content/Mods');
    expect(calls).toContain('/installs/FakeGame/Game/Binaries/Win64');
  });

  it('respects storeBranch — xbox discovery picks WinGDK arch', async () => {
    const { h, runtime } = buildRuntime();
    runtime.registerGame(
      GAME_DECL, STORES, CONTEXT_SPEC, MOD_TYPES, [], {}, [], SETUP_DIRS,
    );

    const { fs } = await import('vortex-api');
    vi.mocked(fs.ensureDirWritableAsync).mockClear();

    await game(h).setup!({ path: '/installs/FakeGame', store: 'xbox' });

    const calls = vi.mocked(fs.ensureDirWritableAsync).mock.calls.map(c => c[0]);
    expect(calls).toContain('/installs/FakeGame/Game/Binaries/WinGDK');
  });
});

describe('GdlRuntime: installer context without a setup block', () => {
  // Repro of the 007firstlight report ("unbound variable `runtimeRoot`"): a
  // game that declares a custom context binding (`runtimeRoot`) referenced from
  // an installer's `placeAt`, but has NO `setup:` block. Without setup(),
  // `resolvedCtx` was never populated, so the installer's interpolate() of
  // `${runtimeRoot}` threw at install time. The installer must resolve context
  // from Vortex's live discovery, independent of whether setup() ran.
  const RPKG_RULE: InstallerRule = {
    id: 'rpkg-patch',
    priority: 50,
    when: { kind: 'hasFile', glob: '**/*.rpkg' },
    single: {
      anchor: { kind: 'glob', pattern: '**/*.rpkg' },
      take: 'parent',
      placeAt: '${runtimeRoot}',
    },
    modType: 'rpkg-patch',
  };
  const CTX_SPEC: ContextSpec = {
    bindings: [
      { name: 'runtimeRoot', value: { kind: 'interpolated', template: '${installPath}/Runtime' } },
    ],
  };
  const DECL = {
    id: 'gamewithoutsetup',
    name: 'Game Without Setup',
    executable: 'Game.exe',
    requiredFiles: ['Game.exe'],
  };

  beforeEach(() => vi.clearAllMocks());

  it('resolves ${runtimeRoot} from live discovery when setup() never ran', async () => {
    const { h, runtime } = buildRuntime();
    // No setupDirs -> setup() is never registered, mirroring 007firstlight.
    runtime.registerGame(DECL, [{ id: 'steam', value: '3768760' }], CTX_SPEC, [], [RPKG_RULE]);

    // Vortex has discovered the game via its own discovery (not GameStoreHelper).
    runtime.setLiveDiscoveryForTesting(() => ({ path: '/installs/Game', store: 'steam' }));

    const files = ['MyMod/chunk0patch1.rpkg'];
    const { matchedId, result } = await h.runInstaller(files, 'gamewithoutsetup');
    expect(matchedId).toBe('rpkg-patch');
    // Reaching a built plan (not an unbound-variable throw) is the assertion.
    expect(result!.instructions).toContainEqual(
      { type: 'copy', source: 'MyMod/chunk0patch1.rpkg', destination: 'chunk0patch1.rpkg' },
    );
    expect(result!.instructions).toContainEqual({ type: 'setmodtype', value: 'rpkg-patch' });
  });

  it('does not crash when the game is genuinely undiscovered', async () => {
    // If Vortex has no discovery for the game, there is no installPath to build
    // ${runtimeRoot} from. The installer must not claim support it can't honor:
    // testSupported returns false so Vortex routes the archive elsewhere rather
    // than the install fn throwing an unbound-variable error into Vortex.
    const { h, runtime } = buildRuntime();
    runtime.registerGame(DECL, [{ id: 'steam', value: '3768760' }], CTX_SPEC, [], [RPKG_RULE]);

    // Live discovery returns nothing (undiscovered / not yet discovered).
    runtime.setLiveDiscoveryForTesting(() => undefined);

    const files = ['MyMod/chunk0patch1.rpkg'];
    await expect(h.runInstaller(files, 'gamewithoutsetup')).resolves.not.toThrow();
    const { matchedId } = await h.runInstaller(files, 'gamewithoutsetup');
    expect(matchedId).toBeUndefined();
  });

  it('applies a store-scoped installer using the store from live discovery', async () => {
    // A scoped installer (scope.stores) must match when the discovered store is
    // known only via live discovery — not just when setup()/queryPath already
    // populated discoveredStore. Otherwise a setup-less game silently drops
    // store-scoped installers.
    const scopedRule: InstallerRule = {
      ...RPKG_RULE,
      id: 'rpkg-steam-only',
      scope: { stores: ['steam'] },
    };
    const { h, runtime } = buildRuntime();
    runtime.registerGame(DECL, [{ id: 'steam', value: '3768760' }], CTX_SPEC, [], [scopedRule]);

    // Store is known ONLY through live discovery (no setup(), no setDiscoveredStore).
    runtime.setLiveDiscoveryForTesting(() => ({ path: '/installs/Game', store: 'steam' }));

    const files = ['MyMod/chunk0patch1.rpkg'];
    const { matchedId } = await h.runInstaller(files, 'gamewithoutsetup');
    expect(matchedId).toBe('rpkg-steam-only');
  });
});

describe('GdlRuntime: queryModPath', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the configured template against the live gamePath', async () => {
    // Repro of game-subnautica2 GH #8: the old runtime hardcoded
    // `queryModPath: () => '.'`, sending "Open Game Mods folder" to the game
    // root. The fix accepts a template via game.queryModPath.
    const { h, runtime } = buildRuntime();
    runtime.registerGame(
      GAME_DECL, STORES, CONTEXT_SPEC, MOD_TYPES, [], {}, [], SETUP_DIRS,
    );

    // Without setup having run, falls back to '.' rather than crashing.
    expect(game(h).queryModPath!('/installs/FakeGame')).toBe('.');

    // After setup, resolves to the template's value.
    await game(h).setup!({ path: '/installs/FakeGame', store: 'steam' });
    expect(game(h).queryModPath!('/installs/FakeGame')).toBe('/installs/FakeGame/Game/Content/Mods');
  });

  it('falls back to "." when no template is configured', () => {
    const { h, runtime } = buildRuntime();
    // queryModPath omitted from GAME_DECL — runtime should return '.'.
    const declNoQueryModPath = { ...GAME_DECL, queryModPath: undefined };
    runtime.registerGame(declNoQueryModPath, STORES, CONTEXT_SPEC, MOD_TYPES);
    expect(game(h).queryModPath!('/installs/FakeGame')).toBe('.');
  });
});
