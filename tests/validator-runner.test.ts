import { describe, it, expect } from 'vitest';
import { runValidators, type ValidatorDef } from '../src/corpus/validator-runner.js';
import type { CorpusEntry } from '../src/corpus/runner.js';
import type { InstallInstruction } from '../src/runtime/installer-engine.js';

const instr = (source: string, destination: string): InstallInstruction => ({
  source,
  destination,
  relative: destination,
  modType: 'pak',
});

// One archive, one matched installer, with a concrete install plan attached.
const entryWithPlan = (plan: InstallInstruction[]): CorpusEntry => ({
  archive: 'mod.zip',
  matchedInstaller: 'pak-iostore',
  matchedModType: 'pak',
  planSize: plan.length,
  plan,
});

const contents = (files: string[]) =>
  new Map<string, readonly string[]>([['mod.zip', files]]);

const vars = { store: 'steam', os: 'windows', installPath: '/games/Hello' };

describe('runValidators — placement assertions', () => {
  it('passes when every matched file lands under the required directory', () => {
    const validators: ValidatorDef[] = [{
      id: 'pak-placement',
      name: 'paks under Content/Paks',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        placement: [
          { files: '**/*.ucas', mustMatch: '**/Content/Paks/**' },
        ],
      },
    }];
    const entries = [entryWithPlan([
      instr('Mod/foo.ucas', '/games/Hello/Hello/Content/Paks/foo.ucas'),
    ])];
    const report = runValidators(validators, entries, contents(['Mod/foo.ucas']), vars);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
  });

  it('fails when a matched file lands outside the required directory', () => {
    const validators: ValidatorDef[] = [{
      id: 'pak-placement',
      name: 'paks under Content/Paks',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        placement: [
          { files: '**/*.ucas', mustMatch: '**/Content/Paks/**' },
        ],
      },
    }];
    const entries = [entryWithPlan([
      instr('foo.ucas', '/games/Hello/foo.ucas'),
    ])];
    const report = runValidators(validators, entries, contents(['foo.ucas']), vars);
    expect(report.failed).toBe(1);
    expect(report.results[0]?.message).toContain('foo.ucas');
  });

  it('fails when a matched file lands at a forbidden destination (mustNotMatch)', () => {
    const validators: ValidatorDef[] = [{
      id: 'pak-not-at-root',
      name: 'paks not at game root',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        placement: [
          // `${installPath}/*` interpolates and forbids a direct child of the install root.
          { files: '**/*.ucas', mustNotMatch: '${installPath}/*' },
        ],
      },
    }];
    const entries = [entryWithPlan([
      instr('foo.ucas', '/games/Hello/foo.ucas'),
    ])];
    const report = runValidators(validators, entries, contents(['foo.ucas']), vars);
    expect(report.failed).toBe(1);
  });

  it('passes mustNotMatch when the file lands somewhere allowed', () => {
    const validators: ValidatorDef[] = [{
      id: 'pak-not-at-root',
      name: 'paks not at game root',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        placement: [
          { files: '**/*.ucas', mustNotMatch: '${installPath}/*' },
        ],
      },
    }];
    const entries = [entryWithPlan([
      instr('Mod/foo.ucas', '/games/Hello/Hello/Content/Paks/foo.ucas'),
    ])];
    const report = runValidators(validators, entries, contents(['Mod/foo.ucas']), vars);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
  });

  it('fails a mustMatch rule when no plan instruction matches `files` (silent drop)', () => {
    const validators: ValidatorDef[] = [{
      id: 'pak-placement',
      name: 'paks under Content/Paks',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        placement: [
          { files: '**/*.ucas', mustMatch: '**/Content/Paks/**' },
        ],
      },
    }];
    // `when` fired (archive has a .ucas) but the matched installer dropped it from the plan.
    const entries = [entryWithPlan([
      instr('readme.txt', '/games/Hello/readme.txt'),
    ])];
    const report = runValidators(validators, entries, contents(['foo.ucas', 'readme.txt']), vars);
    expect(report.failed).toBe(1);
    expect(report.results[0]?.message).toContain('**/*.ucas');
  });

  it('passes a mustNotMatch rule vacuously when no plan instruction matches `files`', () => {
    const validators: ValidatorDef[] = [{
      id: 'pak-not-at-root',
      name: 'paks not at game root',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        placement: [
          { files: '**/*.ucas', mustNotMatch: '${installPath}/*' },
        ],
      },
    }];
    const entries = [entryWithPlan([
      instr('readme.txt', '/games/Hello/readme.txt'),
    ])];
    const report = runValidators(validators, entries, contents(['foo.ucas', 'readme.txt']), vars);
    expect(report.failed).toBe(0);
  });

  it('still enforces matched/modType assertions alongside placement', () => {
    const validators: ValidatorDef[] = [{
      id: 'combo',
      name: 'combo',
      when: { kind: 'hasFile', glob: '**/*.ucas' },
      assert: {
        matched: 'some-other-installer',
        placement: [{ files: '**/*.ucas', mustMatch: '**/Content/Paks/**' }],
      },
    }];
    const entries = [entryWithPlan([
      instr('Mod/foo.ucas', '/games/Hello/Hello/Content/Paks/foo.ucas'),
    ])];
    const report = runValidators(validators, entries, contents(['Mod/foo.ucas']), vars);
    // placement passes, but matched installer is wrong → one failure
    expect(report.failed).toBe(1);
    expect(report.results[0]?.message).toContain('some-other-installer');
  });
});
