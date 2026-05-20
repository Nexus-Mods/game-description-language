import { describe, it, expect } from 'vitest';
import { resolveContext, type ContextSpec, type DiscoveryFacts } from '../src/runtime/context-resolver.js';

const facts: DiscoveryFacts = {
  store: 'steam',
  os: 'windows',
  arch: 'x64',
  installPath: 'C:/Games/Hello',
  executablePath: 'C:/Games/Hello/HelloWorld.exe',
};

describe('resolveContext', () => {
  it('resolves literal and interpolated bindings', () => {
    const spec: ContextSpec = {
      bindings: [
        { name: 'modsRoot', value: { kind: 'interpolated', template: '${installPath}/Mods' } },
        { name: 'tag',      value: { kind: 'literal',      raw: 'pak' } },
      ],
    };
    const ctx = resolveContext(spec, facts);
    expect(ctx.modsRoot).toBe('C:/Games/Hello/Mods');
    expect(ctx.tag).toBe('pak');
  });

  it('resolves !storeBranch by ctx.store', () => {
    const spec: ContextSpec = {
      bindings: [{
        name: 'paksRoot',
        value: {
          kind: 'storeBranch',
          arms: { xbox: { kind: 'interpolated', template: '${installPath}/Content/Paks/~mods' } },
          default:        { kind: 'interpolated', template: '${installPath}/Game/Content/Paks/~mods' },
        },
      }],
    };
    expect(resolveContext(spec, facts).paksRoot).toBe('C:/Games/Hello/Game/Content/Paks/~mods');
    expect(resolveContext(spec, { ...facts, store: 'xbox' }).paksRoot).toBe('C:/Games/Hello/Content/Paks/~mods');
  });

  it('orders bindings topologically', () => {
    const spec: ContextSpec = {
      bindings: [
        { name: 'b', value: { kind: 'interpolated', template: '${a}/b' } },
        { name: 'a', value: { kind: 'interpolated', template: '${installPath}/a' } },
      ],
    };
    expect(resolveContext(spec, facts).b).toBe('C:/Games/Hello/a/b');
  });

  it('throws on unbound variables', () => {
    const spec: ContextSpec = {
      bindings: [{ name: 'x', value: { kind: 'interpolated', template: '${missing}' } }],
    };
    expect(() => resolveContext(spec, facts)).toThrow(/unbound variable/);
  });
});
