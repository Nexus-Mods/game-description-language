import type { YamlSpan } from '../errors.js';

export interface Node {
  span: YamlSpan;
}

export interface DocumentNode extends Node {
  kind: 'document';
  gdl: number;
  game: GameNode;
  stores?: StoresNode;
  context?: ContextNode;
  modTypes?: ModTypeNode[];
}

export interface GameNode extends Node {
  kind: 'game';
  id: string;
  name: string;
  executable: string;
  requiredFiles: string[];
  logo?: string;
  contributedBy?: string;
}

export type StoreId = 'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'microsoftStore' | 'manual';

export interface StoresNode extends Node {
  kind: 'stores';
  entries: { id: StoreId; value: string | number; span: YamlSpan }[];
}

export interface ContextNode extends Node {
  kind: 'context';
  bindings: { name: string; value: ValueNode; span: YamlSpan }[];
}

export type ValueNode =
  | { kind: 'literal'; raw: string | number | boolean; span: YamlSpan }
  | { kind: 'interpolated'; template: string; span: YamlSpan }
  | { kind: 'storeBranch'; arms: Record<string, ValueNode>; default: ValueNode; span: YamlSpan }
  | { kind: 'osBranch'; arms: Record<string, ValueNode>; default: ValueNode; span: YamlSpan }
  | { kind: 'versionBranch'; arms: Record<string, ValueNode>; default: ValueNode; span: YamlSpan };

export interface ModTypeNode extends Node {
  kind: 'modType';
  id: string;
  name: string;
  path: ValueNode;
}
