import type { YamlSpan } from '../errors.js';

export interface Node {
  span: YamlSpan;
}

export interface DocumentNode extends Node {
  kind: 'document';
  gdl: number;
  /** Optional extension version (e.g. "1.2.0"); overrides package.json when present. */
  version?: string;
  game: GameNode;
  stores?: StoresNode;
  context?: ContextNode;
  modTypes?: ModTypeNode[];
  installers?: InstallerNode[];
  discovery?: DiscoveryNode;
  tests?: TestsNode;
  validators?: ValidatorNode[];
  nexus?: NexusNode;
  toolbarActions?: ToolbarActionNode[];
  setup?: SetupNode;
  events?: EventsNode;
  diagnostics?: DiagnosticNode[];
}

// A runtime diagnostic (in-game health check). `hook` names an exported
// IModHealthCheck object in src/hooks.ts which the runtime registers via
// context.registerHealthCheck.
export interface DiagnosticNode extends Node {
  kind: 'diagnostic';
  hook: string;
}

export interface GameNode extends Node {
  kind: 'game';
  id: string;
  name: string;
  executable: string;
  requiredFiles: string[];
  logo?: string;
  // Extension author. Emitted into info.json, where Vortex reads it to derive
  // game.contributed and official-vs-community status (see gamemode_management).
  author?: string;
  nexusDomain?: string;
  details?: Record<string, string | number | boolean | string[]>;
  // Template resolved against the runtime context to produce the path Vortex
  // uses for the "Open Game Mods folder" action and as the default mod
  // location. Receives the live `gamePath` from Vortex as `${installPath}`.
  queryModPath?: string;
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
  // Exactly one form is set: single-anchor, route, copy, or a custom install
  // hook (installHook holds the exported hook name from src/hooks.ts).
  single?: SingleInstallerForm;
  route?: RouteEntry[];
  copy?: CopyInstallerForm;
  installHook?: string;
  // modType required for single and copy forms; route entries carry their own.
  // The hook form emits its own instructions, so modType is optional there.
  modType?: string;
}

export interface CopyInstallerForm {
  // When true, a single shared top-level wrapper dir is stripped from
  // destinations (matches Vortex's IInstallerSpec stripCommonRoot).
  stripCommonRoot: boolean;
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
  | { kind: 'hasFile';    pattern: PatternNode;                  span: YamlSpan }
  | { kind: 'hasFiles';   patterns: PatternNode[];               span: YamlSpan }
  | { kind: 'matches';    pattern: PatternNode;                  span: YamlSpan }
  | { kind: 'extensions'; list: string[]; mode: 'any' | 'all';   span: YamlSpan }
  | { kind: 'when';       expr: ComparisonExpr;                  span: YamlSpan }
  | { kind: 'any';        arms: PredicateNode[];                 span: YamlSpan }
  | { kind: 'all';        arms: PredicateNode[];                 span: YamlSpan }
  | { kind: 'not';        arm: PredicateNode;                    span: YamlSpan };

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

// Declarative file+regex version source
export interface FileVersionNode extends Node {
  kind: 'fileVersion';
  file: string;               // interpolated path, e.g. "${installPath}/Main.mod/..."
  regex: string;              // regex with capture group 1 for version
}

export type VersionSourceNode = HookRefNode | FileVersionNode;

// A single registry probe used to locate a game install. `hive` is the
// shorthand HKLM/HKCU (mapped to winapi's HKEY_LOCAL_MACHINE/HKEY_CURRENT_USER
// at runtime); `value` names the registry value holding the install path.
export type RegistryHive = 'HKLM' | 'HKCU';

export interface RegistryProbeNode extends Node {
  kind: 'registryProbe';
  hive: RegistryHive;
  key: string;
  value: string;
}

// Top-level discovery block. Discovery is attempted in this order at runtime:
// declared store ids -> derived GOG registry key (for a declared `gog` store)
// -> explicit `registry` probes (in declared order) -> `steamName`.
export interface DiscoveryNode extends Node {
  kind: 'discovery';
  version?: VersionSourceNode;
  // Fallback Steam lookup by display name (util.steam.findByName) for games
  // that don't resolve via findByAppId.
  steamName?: string;
  // Extra registry probes, tried in declared order if store discovery misses.
  registry?: RegistryProbeNode[];
}

// Test harness types
export type CorpusMode = 'off' | 'nexus';

export interface TestsNode extends Node {
  kind: 'tests';
  corpus: CorpusMode;
  cases: TestCaseNode[];
  // Per-store install-path fixtures consumed by lifecycle.gen.ts so the
  // generated lifecycle test exercises a realistic discovery shape per store
  // (e.g. Xbox passes the Content/ parent as installPath). Map of storeId to
  // override fields. Missing entries default to `/games/<game.id>`.
  scenarios?: Record<string, { installPath?: string }>;
  // Maps a filename (matched by basename) to a template string the corpus
  // serves when an install hook reads that file. `${manifestId}`/`${modId}`/
  // `${fileId}` are interpolated per fixture. Lets hook installers (which read
  // file contents) run against real mod manifests, which carry only file lists.
  syntheticContent?: Record<string, string>;
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

export interface ValidatorNode extends Node {
  kind: 'validator';
  id: string;
  name: string;
  when: PredicateNode;
  assert: ValidatorAssertNode;
}

export interface PlacementAssertNode {
  files: string;                  // glob over each plan instruction's source path
  mustMatch?: string;             // resolved destination must match this glob
  mustNotMatch?: string;          // resolved destination must NOT match this glob
  span: YamlSpan;
}

export interface ValidatorAssertNode extends Node {
  kind: 'validatorAssert';
  matched?: string;               // expected installer id
  modType?: string;                // expected mod type
  placement?: PlacementAssertNode[]; // per-file destination assertions
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
  requireFiles?: RequireFilesNode;
}

// Declarative prerequisite check: stat a list of files at setup time and, when
// any are missing, show an informational dialog that points the user at a mod
// page or URL to download the missing prerequisite (e.g. Unity Mod Manager).
export interface RequireFilesNode {
  files: string[]; // path templates, interpolated against context
  prompt: RequireFilesPrompt;
}

export interface RequireFilesPrompt {
  title: string;
  message: string;
  link?: RequireFilesLink;
}

export interface RequireFilesLink {
  label: string; // button text
  target: RequireFilesTarget;
}

export type RequireFilesTarget =
  | { kind: 'mod'; domain: string; modId: number }
  | { kind: 'url'; url: string };

// Wired in Task 2. Stub now so DocumentNode compiles.
export interface EventsNode extends Node {
  kind: 'events';
  didDeploy?: HookRefNode;
}
