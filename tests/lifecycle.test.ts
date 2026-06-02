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
