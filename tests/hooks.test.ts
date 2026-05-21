import { describe, it, expect } from 'vitest';
import { HOOK_CATALOG, findHook } from '../src/schema/hook-catalog.js';

describe('HOOK_CATALOG', () => {
  it('catalog declares detectGameVersion hook signature', () => {
    const sig = findHook('detectGameVersion');
    expect(sig).toBeDefined();
    expect(sig!.returnType).toBe('Promise<string | null>');
    expect(sig!.parameterTypes).toContain('GameContext');
  });

  it('catalog declares didDeploy hook signature', () => {
    const sig = findHook('didDeploy');
    expect(sig).toBeDefined();
    expect(sig!.returnType).toBe('Promise<void>');
    expect(sig!.parameterTypes).toContain('DidDeployContext');
  });
});
