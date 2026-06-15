import { describe, it, expect } from 'vitest';
import { assertPlan, type ExpectShape } from '../src/runtime/test-harness.js';
import type { InstallInstruction } from '../src/runtime/installer-engine.js';

// `relative` (path under placeAt) is part of the InstallInstruction contract and
// is read by assertPlan's absolute-path guard; default it to the destination's
// basename so fixtures stay terse.
const inst = (
  source: string,
  destination: string,
  modType: string,
  relative: string = destination.split('/').pop() ?? destination,
): InstallInstruction => ({ source, destination, modType, relative });

describe('assertPlan', () => {
  it('returns OK when plan matches expectation by destinations', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { plan: ['/mods/a.pak'] };
    expect(assertPlan(plan, 'pak', e)).toEqual({ ok: true });
  });

  it('reports a destination mismatch', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { plan: ['/mods/b.pak'] };
    const result = assertPlan(plan, 'pak', e);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/destination/i);
  });

  it('reports a modType mismatch', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { modType: 'ue4ss-lua' };
    const result = assertPlan(plan, 'pak', e);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/modType/);
  });

  it('reports a matched-installer mismatch via the matchedId argument', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { matched: 'ue4ss-lua' };
    const result = assertPlan(plan, 'pak', e);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/matched/i);
  });
});
