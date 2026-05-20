import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from '../src/parser/index.js';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('parseYaml', () => {
  it('parses minimal document', () => {
    const doc = parseYaml(fixture('minimal.yaml'), 'minimal.yaml');
    expect(doc.gdl).toBe(1);
    expect(doc.game.id).toBe('helloworld');
    expect(doc.game.name).toBe('Hello World');
    expect(doc.game.executable).toBe('HelloWorld.exe');
    expect(doc.game.requiredFiles).toEqual(['HelloWorld.exe']);
  });

  it('attaches source spans to nodes', () => {
    const doc = parseYaml(fixture('minimal.yaml'), 'minimal.yaml');
    expect(doc.game.span.file).toBe('minimal.yaml');
    expect(doc.game.span.line).toBe(2);
    expect(doc.game.span.column).toBe(1);
  });

  it('parses stores block', () => {
    const doc = parseYaml(fixture('with-stores.yaml'), 'with-stores.yaml');
    expect(doc.stores).toBeDefined();
    const byId = Object.fromEntries(doc.stores!.entries.map(e => [e.id, e.value]));
    expect(byId).toEqual({
      steam: 264710,
      epic: 'Subnautica2',
      xbox: 'Unknown.Subnautica2',
    });
  });
});
