import { describe, it, expect, vi } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { validate } from '../src/schema/validator.js';
import { emit } from '../src/codegen/emit.js';
import { GdlRuntime } from '../src/runtime/vortex-shim.js';
import type { IExtensionContext } from 'vortex-api';

// Phase 1.5: a declarative `diagnostics:` block that registers in-game health
// checks (Vortex registerHealthCheck) from IModHealthCheck objects exported by
// src/hooks.ts.

const withDiagnostics = `
gdl: 1
game:
  id: xrebirth
  name: X Rebirth
  executable: XRebirth.exe
  requiredFiles: [XRebirth.exe]
diagnostics:
  - hook: modHasFilesCheck
  - hook: contentXmlCustomFileNameCheck
  - hook: modShapeRecognisedCheck
`;

describe('diagnostics parsing', () => {
  it('parses a list of hook references', () => {
    const doc = parseYaml(withDiagnostics, 'inline.yaml');
    expect(doc.diagnostics?.map(d => d.hook)).toEqual([
      'modHasFilesCheck',
      'contentXmlCustomFileNameCheck',
      'modShapeRecognisedCheck',
    ]);
    expect(doc.diagnostics?.every(d => d.kind === 'diagnostic')).toBe(true);
  });

  it('rejects a diagnostics entry missing a string hook', () => {
    expect(() => parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
diagnostics:
  - nothook: foo
`, 'inline.yaml')).toThrow();
  });
});

describe('diagnostics validation', () => {
  it('flags duplicate hooks', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
diagnostics:
  - hook: checkA
  - hook: checkA
`, 'inline.yaml');
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL193')).toBe(true);
  });

  it('accepts unique hooks', () => {
    const doc = parseYaml(withDiagnostics, 'inline.yaml');
    expect(validate(doc).filter(e => e.code.startsWith('GDL19'))).toHaveLength(0);
  });
});

describe('diagnostics codegen', () => {
  it('imports the hooks namespace and passes checks to registerGame', () => {
    const doc = parseYaml(withDiagnostics, 'inline.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain("import * as hooks from '../src/hooks.js'");
    expect(ext.contents).toContain('hooks.modHasFilesCheck');
    expect(ext.contents).toContain('hooks.contentXmlCustomFileNameCheck');
    expect(ext.contents).toContain('hooks.modShapeRecognisedCheck');
  });
});

describe('diagnostics runtime registration', () => {
  it('registers each diagnostic via context.registerHealthCheck', () => {
    const registerHealthCheck = vi.fn();
    const ctx = {
      registerGame: vi.fn(),
      registerModType: vi.fn(),
      registerInstaller: vi.fn(),
      registerAction: vi.fn(),
      registerHealthCheck,
      once: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;

    const runtime = new GdlRuntime(ctx);
    const checks = [
      { id: 'check-a' },
      { id: 'check-b' },
    ];
    runtime.registerGame(
      { id: 'xrebirth', name: 'X Rebirth', executable: 'XRebirth.exe', requiredFiles: ['XRebirth.exe'] },
      [],
      { bindings: [] },
      [],
      [],
      {},
      [],
      [],
      {},
      checks,
    );

    expect(registerHealthCheck).toHaveBeenCalledTimes(2);
    expect(registerHealthCheck).toHaveBeenNthCalledWith(1, { id: 'check-a' });
    expect(registerHealthCheck).toHaveBeenNthCalledWith(2, { id: 'check-b' });
  });
});
