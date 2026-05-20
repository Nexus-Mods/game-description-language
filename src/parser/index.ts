import { parseDocument, type Document, type Node as YamlNode, isMap, isSeq, isScalar, isPair } from 'yaml';
import type { DocumentNode, GameNode, StoresNode, StoreId } from './ast.js';
import type { YamlSpan } from '../errors.js';
import { BuildErrors, type BuildError } from '../errors.js';
import { customTags } from './tags.js';

const spanOf = (file: string, source: string, node: YamlNode | null | undefined): YamlSpan => {
  const range = (node as { range?: [number, number, number] } | null)?.range;
  if (!range) return { file, line: 1, column: 1, offset: 0, length: 0 };
  const [start, , end] = range;
  const before = source.slice(0, start);
  const line = before.split('\n').length;
  const lastNl = before.lastIndexOf('\n');
  const column = start - (lastNl + 1) + 1;
  return { file, line, column, offset: start, length: end - start };
};

const STORE_IDS = new Set<StoreId>([
  'steam', 'epic', 'gog', 'xbox', 'ea', 'microsoftStore', 'manual',
]);

export const parseYaml = (source: string, file: string): DocumentNode => {
  const doc: Document = parseDocument(source, { customTags, keepSourceTokens: true });
  const errors: BuildError[] = doc.errors.map(e => ({
    code: 'GDL001',
    message: e.message,
    span: spanOf(file, source, null),
  }));
  if (errors.length) throw new BuildErrors(errors);

  const root = doc.contents;
  if (!isMap(root)) {
    throw new BuildErrors([{
      code: 'GDL002',
      message: 'document root must be a mapping',
      span: spanOf(file, source, root),
    }]);
  }

  const gdl = root.get('gdl');
  if (typeof gdl !== 'number') {
    throw new BuildErrors([{
      code: 'GDL003',
      message: 'missing or non-numeric `gdl:` schema version',
      span: spanOf(file, source, root),
    }]);
  }

  const gameNode = root.get('game', true);
  if (!isMap(gameNode)) {
    throw new BuildErrors([{
      code: 'GDL004',
      message: '`game:` is required and must be a mapping',
      span: spanOf(file, source, root),
    }]);
  }

  // Use the key node's range so the span points to the `game:` line (line 2, col 1),
  // not the first child of the mapping (which starts on the following line).
  const gamePair = root.items.find(p => isPair(p) && isScalar(p.key) && p.key.value === 'game');
  const gameSpanNode = (gamePair && isPair(gamePair) ? gamePair.key : gameNode) as YamlNode | null | undefined;

  const requiredFilesYaml = gameNode.get('requiredFiles', true);
  const requiredFiles: string[] = isSeq(requiredFilesYaml)
    ? requiredFilesYaml.items.map(i => (isScalar(i) ? String(i.value) : String(i)))
    : [];

  const game: GameNode = {
    kind: 'game',
    id: String(gameNode.get('id') ?? ''),
    name: String(gameNode.get('name') ?? ''),
    executable: String(gameNode.get('executable') ?? ''),
    requiredFiles,
    ...(gameNode.has('logo')          && { logo:          String(gameNode.get('logo')) }),
    ...(gameNode.has('contributedBy') && { contributedBy: String(gameNode.get('contributedBy')) }),
    span: spanOf(file, source, gameSpanNode),
  };

  const storesYaml = root.get('stores', true);
  let stores: StoresNode | undefined;
  if (isMap(storesYaml)) {
    const entries: StoresNode['entries'] = [];
    for (const pair of storesYaml.items) {
      if (!isPair(pair)) continue;
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (!STORE_IDS.has(key as StoreId)) {
        throw new BuildErrors([{
          code: 'GDL010',
          message: `unknown store \`${key}\``,
          span: spanOf(file, source, pair.key as YamlNode),
          hint: `expected one of: ${[...STORE_IDS].join(', ')}`,
        }]);
      }
      const valueNode = pair.value;
      const value = isScalar(valueNode) ? valueNode.value : null;
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new BuildErrors([{
          code: 'GDL011',
          message: `store \`${key}\` value must be string or number`,
          span: spanOf(file, source, valueNode as YamlNode),
        }]);
      }
      entries.push({
        id: key as StoreId,
        value,
        span: spanOf(file, source, pair.key as YamlNode),
      });
    }
    stores = { kind: 'stores', entries, span: spanOf(file, source, storesYaml) };
  }

  return {
    kind: 'document',
    gdl,
    game,
    ...(stores !== undefined && { stores }),
    span: spanOf(file, source, root),
  };
};
