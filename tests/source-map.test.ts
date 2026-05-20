import { describe, it, expect } from 'vitest';
import { buildSourceMap } from '../src/codegen/source-map.js';

describe('buildSourceMap', () => {
  it('produces a v3 source map with the given mappings', () => {
    const sm = buildSourceMap('extension.ts', 'game.yaml', [
      { generatedLine: 5, yamlLine: 3, yamlColumn: 1 },
      { generatedLine: 8, yamlLine: 7, yamlColumn: 1 },
    ]);
    expect(sm.version).toBe(3);
    expect(sm.sources).toEqual(['game.yaml']);
    expect(sm.file).toBe('extension.ts');
    expect(sm.mappings.length).toBeGreaterThan(0);
    expect(sm.mappings.split(';').length).toBeGreaterThanOrEqual(8);
  });
});
