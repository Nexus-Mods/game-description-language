import { describe, it, expect } from 'vitest';
import { formatError, BuildErrors, type BuildError } from '../src/errors.js';

describe('formatError', () => {
  it('formats a build error with file:line:col, code, message, and hint', () => {
    const err: BuildError = {
      code: 'GDL010',
      message: 'unknown store `gog2`',
      span: { file: 'game.yaml', line: 5, column: 3, offset: 42, length: 4 },
      hint: 'expected one of: steam, epic, gog, xbox, ea, microsoftStore, manual',
    };
    expect(formatError(err)).toBe(
      'game.yaml:5:3: GDL010: unknown store `gog2`\n  hint: expected one of: steam, epic, gog, xbox, ea, microsoftStore, manual',
    );
  });

  it('omits the hint line when no hint is set', () => {
    const err: BuildError = {
      code: 'GDL101',
      message: 'game.id `Hello_World` must match /^[a-z][a-z0-9-]*$/',
      span: { file: 'game.yaml', line: 3, column: 1, offset: 9, length: 13 },
    };
    expect(formatError(err)).toBe(
      'game.yaml:3:1: GDL101: game.id `Hello_World` must match /^[a-z][a-z0-9-]*$/',
    );
  });
});

describe('BuildErrors', () => {
  it('carries the error list and reports a count in its message', () => {
    const errors: BuildError[] = [
      { code: 'GDL001', message: 'x', span: { file: 'a', line: 1, column: 1, offset: 0, length: 0 } },
      { code: 'GDL002', message: 'y', span: { file: 'a', line: 2, column: 1, offset: 0, length: 0 } },
    ];
    const exc = new BuildErrors(errors);
    expect(exc.name).toBe('BuildErrors');
    expect(exc.message).toBe('GDL build failed with 2 error(s)');
    expect(exc.errors).toEqual(errors);
  });
});
