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
  installers?: InstallerNode[];
  discovery?: DiscoveryNode;
  tests?: TestsNode;
  nexus?: NexusNode;
  toolbarActions?: ToolbarActionNode[];
  setup?: SetupNode;
  events?: EventsNode;
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
  | { kind: 'versionBranch'; arms: Record<string, ValueNode>; default: ValueNode; span: YamlSpan }
  | { kind: 'hookRef'; hookId: string; span: YamlSpan };

export interface ModTypeNode extends Node {
  kind: 'modType';
  id: string;
  name: string;
  path: ValueNode;
}

export type TakeStrategy = 'self' | 'parent' | 'parent.parent' | 'archive-root' | { depth: number };

export interface InstallerNode extends Node {
  kind: 'installer';
  id: string;
  priority: number;
  when: PredicateNode;
  unless?: PredicateNode;
  scope?: InstallerScope;
  // Single-anchor form OR route form. Exactly one is set.
  single?: SingleInstallerForm;
  route?: RouteEntry[];
  // modType only required for single form; route entries carry their own modType.
  modType?: string;
}

export interface InstallerScope {
  stores?: string[];
}

export interface SingleInstallerForm {
  anchor: PatternNode;
  take: TakeStrategy;
  placeAt: ValueNode;          // template
}

export interface RouteEntry {
  match: PatternNode;
  anchor: PatternNode;
  take: TakeStrategy;
  placeAt: ValueNode;
  modType: string;
  span: YamlSpan;
}

// Patterns
export type PatternNode =
  | { kind: 'glob';  pattern: string;   span: YamlSpan }
  | { kind: 'regex'; pattern: string;   span: YamlSpan };

// Predicates
export type PredicateNode =
  | { kind: 'hasFile';  pattern: PatternNode;        span: YamlSpan }
  | { kind: 'hasFiles'; patterns: PatternNode[];     span: YamlSpan }
  | { kind: 'matches';  pattern: PatternNode;        span: YamlSpan }
  | { kind: 'when';     expr: ComparisonExpr;        span: YamlSpan }
  | { kind: 'any';      arms: PredicateNode[];       span: YamlSpan }
  | { kind: 'all';      arms: PredicateNode[];       span: YamlSpan }
  | { kind: 'not';      arm: PredicateNode;          span: YamlSpan };

// Boolean comparison expression used by `!when`. Intentionally tiny.
export type ComparisonExpr =
  | { op: '==' | '!=';                left: ValueRef; right: ValueRef }
  | { op: 'in';                       left: ValueRef; right: ValueRef[] }
  | { op: '>=' | '<=' | '>' | '<';    left: ValueRef; right: ValueRef };

export type ValueRef =
  | { kind: 'literal';  raw: string | number | boolean }
  | { kind: 'ref';      name: string };       // context variable or built-in (store, os, version)

// Hook references
export interface HookRefNode extends Node {
  kind: 'hookRef';
  hookId: string;             // e.g. 'detectGameVersion'
}

// Top-level discovery block
export interface DiscoveryNode extends Node {
  kind: 'discovery';
  version?: HookRefNode;       // { hook: detectGameVersion }
}

// Test harness types
export type CorpusMode = 'off' | 'nexus';

export interface TestsNode extends Node {
  kind: 'tests';
  corpus: CorpusMode;
  cases: TestCaseNode[];
}

export interface TestCaseNode extends Node {
  kind: 'testCase';
  name: string;
  archive: string[];              // list of archive paths (synthetic)
  expect?: ExpectNode;
}

export interface ExpectNode extends Node {
  kind: 'expect';
  matched?: string;               // expected installer id
  modType?: string;               // expected modType assigned
  plan?: string[];                // expected destination paths, in any order
}

export interface NexusNode extends Node {
  kind: 'nexus';
  modId: number;
  fileGroupId: number;
  displayName: string;
}

// Toolbar action — declarative UI for opening a file or URL from Vortex's mod-icons toolbar.
export type ToolbarActionTarget =
  | { kind: 'openFile'; template: string }
  | { kind: 'openUrl';  template: string };

export interface ToolbarActionNode extends Node {
  kind: 'toolbarAction';
  id: string;
  title: string;
  priority: number;
  target: ToolbarActionTarget;
}

// Declarative setup-hook: tell Vortex to ensure these directories exist before the game is moddable.
export interface SetupNode extends Node {
  kind: 'setup';
  ensureDirs: string[];   // path templates, interpolated against context
}

// Wired in Task 2. Stub now so DocumentNode compiles.
export interface EventsNode extends Node {
  kind: 'events';
  didDeploy?: HookRefNode;
}
