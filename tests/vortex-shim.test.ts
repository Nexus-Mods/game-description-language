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
});
