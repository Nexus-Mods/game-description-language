# GDL MVP Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimum end-to-end GDL pipeline: a `game.yaml` containing `gdl:`, `game:`, `stores:`, `context:`, and `modTypes:` blocks (no installers yet) is parsed, validated, and code-generated into a webpack-bundled Vortex extension that registers the game and its mod types with Vortex.

**Architecture:** Single Node package (`game-description-language`). Phases: parse YAML with custom tags via `yaml` (eemeli/yaml) → validate against TS-defined schema → resolve context with `!storeBranch` and `${var}` interpolation → emit TypeScript files in `.gdl-out/` → webpack-bundle to `dist/extension.js`. A CLI verb (`gdl build`) orchestrates the phases. Runtime helpers (context resolver, interpolator, Vortex API shim) live alongside the codegen in the same package and are imported by the generated code via an `@gdl/runtime` alias resolved by the bundler.

**Tech Stack:** Node 22, TypeScript 5.4, `yaml@2`, `vitest@3`, `webpack@5` + `ts-loader`, `commander@12` (CLI), `pnpm@11`. Vendored minimal `vortex-api` types for the shim; `vortex-api` itself is webpack-externalised.

**Spec reference:** `docs/superpowers/specs/2026-05-20-game-description-language-design.md`, particularly §2 (overview), §3.1–3.5 (declarations, context, tags, interpolation), §4 (codegen pipeline phases), §5 (runtime helpers), and §10 (non-goals; installer support is explicitly out of scope here).

---

## File structure (target end-state for this plan)

```
game-description-language/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── src/
│   ├── cli.ts                          # bin entry; commander setup
│   ├── commands/
│   │   └── build.ts                    # `gdl build` orchestrator
│   ├── parser/
│   │   ├── index.ts                    # parseYaml(source, filename) → Document
│   │   ├── tags.ts                     # custom YAML tag definitions
│   │   └── ast.ts                      # AST node types with source spans
│   ├── schema/
│   │   ├── types.ts                    # canonical TS types for the schema
│   │   └── validator.ts                # validate(doc) → Result<Document, BuildError[]>
│   ├── codegen/
│   │   ├── context.ts                  # resolve context block → ResolvedContext
│   │   ├── interpolate.ts              # ${var} substitution (build-time check)
│   │   └── emit.ts                     # emit .gdl-out/*.ts and info.json
│   ├── runtime/
│   │   ├── index.ts                    # exports surfaced as @gdl/runtime
│   │   ├── context-resolver.ts         # resolves context at extension load time
│   │   ├── interpolate.ts              # runtime ${var} substitution
│   │   ├── branch-tags.ts              # storeBranch/osBranch dispatch
│   │   └── vortex-shim.ts              # GdlRuntime class wrapping vortex-api
│   ├── bundler/
│   │   ├── index.ts                    # invokeWebpack(cwd) → Promise<void>
│   │   └── webpack.config.ts           # factory: (cwd) => webpack.Configuration
│   ├── errors.ts                       # BuildError type with yaml span
│   └── types/
│       └── vortex-api.d.ts             # minimal vendored types
└── tests/
    ├── fixtures/
    │   ├── minimal.yaml
    │   ├── full-game.yaml
    │   ├── with-stores.yaml
    │   ├── with-context.yaml
    │   └── with-modtypes.yaml
    ├── parser.test.ts
    ├── validator.test.ts
    ├── context-resolver.test.ts
    ├── codegen.test.ts
    ├── bundler.test.ts
    └── e2e.test.ts
```

`.gdl-out/` and `dist/` are added to `.gitignore`. The fixtures double as test inputs and as documentation of the YAML surface.

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

This task is setup, not TDD; there's nothing to test until we have code.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "game-description-language",
  "version": "0.0.1",
  "description": "Build-time toolchain for Vortex game extensions",
  "type": "module",
  "private": true,
  "packageManager": "pnpm@11.0.9",
  "engines": { "node": ">=22" },
  "bin": { "gdl": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "webpack": "^5.91.0",
    "ts-loader": "^9.5.1",
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.4.5",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.gdl-out/
*.log
.DS_Store
```

- [ ] **Step 5: Install dependencies and verify**

Run: `pnpm install`
Expected: dependencies installed, lockfile created.

Run: `pnpm typecheck`
Expected: no errors (no source files yet, exits 0).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore pnpm-lock.yaml
git commit -m "Bootstrap GDL package"
```

---

## Task 2: Error types and source spans

**Files:**
- Create: `src/errors.ts`
- Create: `src/parser/ast.ts`
- Test: `tests/parser.test.ts` (will be populated in later tasks)

Both modules support every later phase, so they come first.

- [ ] **Step 1: Create `src/errors.ts`**

```ts
export interface YamlSpan {
  file: string;
  line: number;      // 1-based
  column: number;    // 1-based
  offset: number;    // byte offset for tooling
  length: number;
}

export interface BuildError {
  code: string;            // stable identifier, e.g. "GDL001"
  message: string;
  span: YamlSpan;
  hint?: string;           // "did you mean ...?"
}

export class BuildErrors extends Error {
  constructor(public readonly errors: BuildError[]) {
    super(`GDL build failed with ${errors.length} error(s)`);
    this.name = 'BuildErrors';
  }
}

export const formatError = (err: BuildError): string => {
  const loc = `${err.span.file}:${err.span.line}:${err.span.column}`;
  const hint = err.hint ? `\n  hint: ${err.hint}` : '';
  return `${loc}: ${err.code}: ${err.message}${hint}`;
};
```

- [ ] **Step 2: Create `src/parser/ast.ts`**

```ts
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
  | { kind: 'osBranch'; arms: Record<string, ValueNode>; default: ValueNode; span: YamlSpan };

export interface ModTypeNode extends Node {
  kind: 'modType';
  id: string;
  name: string;
  path: ValueNode;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (0 errors).

- [ ] **Step 4: Commit**

```bash
git add src/errors.ts src/parser/ast.ts
git commit -m "Add BuildError and AST node types"
```

---

## Task 3: Parser: minimal YAML (gdl + game.id)

**Files:**
- Create: `src/parser/index.ts`
- Create: `src/parser/tags.ts`
- Create: `tests/parser.test.ts`
- Create: `tests/fixtures/minimal.yaml`

We build the parser vertical-slice first: just enough to read `gdl: 1` and `game.id`. We'll extend it task by task.

- [ ] **Step 1: Create the minimal fixture `tests/fixtures/minimal.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
```

- [ ] **Step 2: Write the failing parser test in `tests/parser.test.ts`**

```ts
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test parser`
Expected: FAIL (`Cannot find module '../src/parser/index.js'`).

- [ ] **Step 4: Create `src/parser/tags.ts` (empty for now)**

```ts
import type { Tags } from 'yaml';

// Tag definitions added in later tasks (Task 6 adds !storeBranch).
export const customTags: Tags = [];
```

- [ ] **Step 5: Create `src/parser/index.ts`**

```ts
import { parseDocument, type Document, type Node as YamlNode, isMap, isSeq, isScalar } from 'yaml';
import type { DocumentNode, GameNode } from './ast.js';
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
    logo: gameNode.has('logo') ? String(gameNode.get('logo')) : undefined,
    contributedBy: gameNode.has('contributedBy') ? String(gameNode.get('contributedBy')) : undefined,
    span: spanOf(file, source, gameNode),
  };

  return {
    kind: 'document',
    gdl,
    game,
    span: spanOf(file, source, root),
  };
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test parser`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add src/parser/ tests/parser.test.ts tests/fixtures/minimal.yaml
git commit -m "Add parser for minimal YAML (gdl + game block)"
```

---

## Task 4: Parser: stores block

**Files:**
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`
- Create: `tests/fixtures/with-stores.yaml`

- [ ] **Step 1: Create `tests/fixtures/with-stores.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
stores:
  steam: 264710
  epic:  Subnautica2
  xbox:  Unknown.Subnautica2
```

- [ ] **Step 2: Add a failing test in `tests/parser.test.ts`**

Append inside the `describe('parseYaml', ...)` block:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test parser`
Expected: FAIL (`doc.stores` is undefined).

- [ ] **Step 4: Extend the parser**

In `src/parser/index.ts`, add the imports `isPair` and `StoreId`:

```ts
import { parseDocument, type Document, type Node as YamlNode, isMap, isSeq, isScalar, isPair } from 'yaml';
import type { DocumentNode, GameNode, StoresNode, StoreId } from './ast.js';
```

Define the allowed store IDs above `parseYaml`:

```ts
const STORE_IDS = new Set<StoreId>([
  'steam', 'epic', 'gog', 'xbox', 'ea', 'microsoftStore', 'manual',
]);
```

After the `game` extraction and before the return, parse stores:

```ts
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
```

Add `stores` to the returned document:

```ts
return {
  kind: 'document',
  gdl,
  game,
  stores,
  span: spanOf(file, source, root),
};
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test parser`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add src/parser/index.ts tests/parser.test.ts tests/fixtures/with-stores.yaml
git commit -m "Parse stores block"
```

---

## Task 5: Parser: context block with literals and interpolation

**Files:**
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`
- Create: `tests/fixtures/with-context.yaml`

Interpolation is detected at parse time by `${` presence; the actual substitution happens at codegen and runtime (Tasks 11–12). The parser distinguishes literal scalars from interpolated templates.

- [ ] **Step 1: Create `tests/fixtures/with-context.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: ${installPath}/Mods
  literal: hello
```

- [ ] **Step 2: Add a failing test to `tests/parser.test.ts`**

```ts
  it('parses context bindings with interpolation', () => {
    const doc = parseYaml(fixture('with-context.yaml'), 'with-context.yaml');
    expect(doc.context).toBeDefined();
    const byName = Object.fromEntries(doc.context!.bindings.map(b => [b.name, b.value]));
    expect(byName.modsRoot).toMatchObject({ kind: 'interpolated', template: '${installPath}/Mods' });
    expect(byName.literal).toMatchObject({ kind: 'literal', raw: 'hello' });
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test parser`
Expected: FAIL (`doc.context` undefined).

- [ ] **Step 4: Extend the parser**

Add a helper `parseValueNode` above `parseYaml`:

```ts
import type { ValueNode } from './ast.js';

const isInterpolated = (s: string): boolean => s.includes('${');

const parseValueNode = (node: YamlNode | null | undefined, file: string, source: string): ValueNode => {
  if (isScalar(node)) {
    const raw = node.value;
    if (typeof raw === 'string' && isInterpolated(raw)) {
      return { kind: 'interpolated', template: raw, span: spanOf(file, source, node) };
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return { kind: 'literal', raw, span: spanOf(file, source, node) };
    }
  }
  // Branch tags handled in Task 6.
  throw new BuildErrors([{
    code: 'GDL020',
    message: 'unsupported value (expected scalar literal or interpolated string)',
    span: spanOf(file, source, node ?? null),
  }]);
};
```

After parsing `stores`, add context parsing:

```ts
import type { ContextNode } from './ast.js';

const contextYaml = root.get('context', true);
let context: ContextNode | undefined;
if (isMap(contextYaml)) {
  const bindings: ContextNode['bindings'] = [];
  for (const pair of contextYaml.items) {
    if (!isPair(pair)) continue;
    const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const value = parseValueNode(pair.value as YamlNode, file, source);
    bindings.push({ name, value, span: spanOf(file, source, pair.key as YamlNode) });
  }
  context = { kind: 'context', bindings, span: spanOf(file, source, contextYaml) };
}
```

Add `context` to the returned document:

```ts
return {
  kind: 'document',
  gdl,
  game,
  stores,
  context,
  span: spanOf(file, source, root),
};
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test parser`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parser/index.ts tests/parser.test.ts tests/fixtures/with-context.yaml
git commit -m "Parse context bindings with interpolation detection"
```

---

## Task 6: Parser: `!storeBranch` and `!osBranch` tags

**Files:**
- Modify: `src/parser/tags.ts`
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`
- Modify: `tests/fixtures/with-context.yaml`

The eemeli/yaml library lets us register custom tags that transform a node during parsing. We mark branch tags with a sentinel object the rest of the parser recognises.

- [ ] **Step 1: Replace `src/parser/tags.ts`**

We register the branch tags with the parser so it doesn't emit unknown-tag warnings, but with an identity `resolve` so the underlying YAMLMap node (and crucially its `.tag` string) survives in the AST. Detection happens in `parseValueNode` by inspecting `node.tag` directly. This avoids relying on internal shape choices of the yaml library's resolver path.

```ts
import type { Tags } from 'yaml';

export type BranchTagName = '!storeBranch' | '!osBranch' | '!versionBranch';

export const BRANCH_TAG_NAMES: ReadonlySet<BranchTagName> =
  new Set(['!storeBranch', '!osBranch', '!versionBranch']);

// Identity resolvers so the parser accepts these tags without warning;
// the rest of the parser detects them via `node.tag`.
export const customTags: Tags = [
  { tag: '!storeBranch',   collection: 'map', resolve: (value: unknown) => value },
  { tag: '!osBranch',      collection: 'map', resolve: (value: unknown) => value },
  { tag: '!versionBranch', collection: 'map', resolve: (value: unknown) => value },
];
```

- [ ] **Step 2: Update `tests/fixtures/with-context.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: ${installPath}/Mods
  literal: hello
  paksRoot: !storeBranch
    xbox:    ${installPath}/Content/Paks/~mods
    default: ${installPath}/Game/Content/Paks/~mods
```

- [ ] **Step 3: Add a failing test in `tests/parser.test.ts`**

```ts
  it('parses !storeBranch values', () => {
    const doc = parseYaml(fixture('with-context.yaml'), 'with-context.yaml');
    const byName = Object.fromEntries(doc.context!.bindings.map(b => [b.name, b.value]));
    const branch = byName.paksRoot;
    expect(branch.kind).toBe('storeBranch');
    if (branch.kind !== 'storeBranch') return;
    expect(branch.arms.xbox).toMatchObject({ kind: 'interpolated' });
    expect(branch.default).toMatchObject({ kind: 'interpolated' });
  });
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm test parser`
Expected: FAIL (branch.kind is not 'storeBranch'; the parser doesn't recognise the tagged node yet).

- [ ] **Step 5: Extend `parseValueNode` to handle branch tags**

In `src/parser/index.ts`, import the branch tag set:

```ts
import { BRANCH_TAG_NAMES, type BranchTagName } from './tags.js';
```

Replace `parseValueNode` so it detects branch tags via `node.tag` on a YAMLMap (the simpler, library-supported path) and recurses into the arms:

```ts
const tagToKind = (tag: BranchTagName): 'storeBranch' | 'osBranch' | 'versionBranch' =>
  tag === '!storeBranch' ? 'storeBranch'
  : tag === '!osBranch' ? 'osBranch'
  : 'versionBranch';

const parseValueNode = (node: YamlNode | null | undefined, file: string, source: string): ValueNode => {
  const span = spanOf(file, source, node ?? null);

  // Branch tag: tagged YAMLMap with one of the known branch tag names.
  if (isMap(node) && typeof node.tag === 'string' && BRANCH_TAG_NAMES.has(node.tag as BranchTagName)) {
    const tag = node.tag as BranchTagName;
    const arms: Record<string, ValueNode> = {};
    let defaultArm: ValueNode | undefined;
    for (const pair of node.items) {
      if (!isPair(pair)) continue;
      const armKey = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const armValue = parseValueNode(pair.value as YamlNode, file, source);
      if (armKey === 'default') defaultArm = armValue;
      else arms[armKey] = armValue;
    }
    if (!defaultArm) {
      throw new BuildErrors([{
        code: 'GDL022',
        message: `\`${tag}\` requires a \`default:\` arm`,
        span,
      }]);
    }
    return { kind: tagToKind(tag), arms, default: defaultArm, span };
  }

  if (isScalar(node)) {
    const raw = node.value;
    if (typeof raw === 'string' && isInterpolated(raw)) {
      return { kind: 'interpolated', template: raw, span };
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return { kind: 'literal', raw, span };
    }
  }

  throw new BuildErrors([{
    code: 'GDL020',
    message: 'unsupported value (expected scalar literal, interpolated string, or branch tag)',
    span,
  }]);
};
```

- [ ] **Step 6: Run tests**

Run: `pnpm test parser`
Expected: PASS (all four cases).

- [ ] **Step 7: Commit**

```bash
git add src/parser/ tests/parser.test.ts tests/fixtures/with-context.yaml
git commit -m "Parse !storeBranch / !osBranch / !versionBranch tags"
```

---

## Task 7: Parser: modTypes block

**Files:**
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`
- Create: `tests/fixtures/with-modtypes.yaml`

- [ ] **Step 1: Create `tests/fixtures/with-modtypes.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: ${installPath}/Mods
modTypes:
  - { id: pak,  name: Pak Mod,   path: ${modsRoot} }
  - { id: lua,  name: Lua Mod,   path: ${installPath}/Scripts }
```

- [ ] **Step 2: Add a failing test**

```ts
  it('parses modTypes block', () => {
    const doc = parseYaml(fixture('with-modtypes.yaml'), 'with-modtypes.yaml');
    expect(doc.modTypes).toHaveLength(2);
    expect(doc.modTypes![0].id).toBe('pak');
    expect(doc.modTypes![0].name).toBe('Pak Mod');
    expect(doc.modTypes![0].path).toMatchObject({ kind: 'interpolated', template: '${modsRoot}' });
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test parser`
Expected: FAIL.

- [ ] **Step 4: Extend the parser**

In `src/parser/index.ts`, after context parsing:

```ts
import type { ModTypeNode } from './ast.js';

const modTypesYaml = root.get('modTypes', true);
let modTypes: ModTypeNode[] | undefined;
if (isSeq(modTypesYaml)) {
  modTypes = [];
  for (const entry of modTypesYaml.items) {
    if (!isMap(entry)) {
      throw new BuildErrors([{
        code: 'GDL030',
        message: 'modTypes entries must be mappings',
        span: spanOf(file, source, entry as YamlNode),
      }]);
    }
    modTypes.push({
      kind: 'modType',
      id: String(entry.get('id') ?? ''),
      name: String(entry.get('name') ?? ''),
      path: parseValueNode(entry.get('path', true) as YamlNode, file, source),
      span: spanOf(file, source, entry),
    });
  }
}
```

Include `modTypes` in the returned document.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test parser`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parser/index.ts tests/parser.test.ts tests/fixtures/with-modtypes.yaml
git commit -m "Parse modTypes block"
```

---

## Task 8: Validator: game, stores, modTypes structural rules

**Files:**
- Create: `src/schema/types.ts`
- Create: `src/schema/validator.ts`
- Create: `tests/validator.test.ts`

The parser already throws on shape errors; the validator does semantic checks: required fields, ID format, duplicates, schema version compatibility.

- [ ] **Step 1: Create `src/schema/types.ts`**

```ts
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
export type SupportedSchemaVersion = typeof SUPPORTED_SCHEMA_VERSIONS[number];

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
```

- [ ] **Step 2: Write a failing validator test in `tests/validator.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { validate } from '../src/schema/validator.js';

const tinyDoc = (yaml: string) => parseYaml(yaml, 'inline.yaml');

describe('validate', () => {
  it('accepts a minimal valid document', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
`);
    expect(validate(doc)).toEqual([]);
  });

  it('rejects unsupported schema version', () => {
    const doc = tinyDoc(`
gdl: 99
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
`);
    const errors = validate(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('GDL100');
  });

  it('rejects malformed game id', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: Hello_World
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL101')).toBe(true);
  });

  it('rejects duplicate modType ids', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: A, path: /a }
  - { id: pak, name: B, path: /b }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL102')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test validator`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/schema/validator.ts`**

```ts
import type { DocumentNode } from '../parser/ast.js';
import type { BuildError } from '../errors.js';
import { SUPPORTED_SCHEMA_VERSIONS, ID_PATTERN } from './types.js';

export const validate = (doc: DocumentNode): BuildError[] => {
  const errors: BuildError[] = [];

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(doc.gdl as 1)) {
    errors.push({
      code: 'GDL100',
      message: `schema version ${doc.gdl} is not supported`,
      span: doc.span,
      hint: `this build supports gdl: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    });
  }

  if (!ID_PATTERN.test(doc.game.id)) {
    errors.push({
      code: 'GDL101',
      message: `game.id \`${doc.game.id}\` must match ${ID_PATTERN}`,
      span: doc.game.span,
    });
  }

  if (!doc.game.name.trim()) {
    errors.push({
      code: 'GDL103',
      message: 'game.name is required',
      span: doc.game.span,
    });
  }

  if (!doc.game.executable.trim()) {
    errors.push({
      code: 'GDL104',
      message: 'game.executable is required',
      span: doc.game.span,
    });
  }

  if (doc.game.requiredFiles.length === 0) {
    errors.push({
      code: 'GDL105',
      message: 'game.requiredFiles must list at least one file',
      span: doc.game.span,
    });
  }

  if (doc.modTypes) {
    const seen = new Set<string>();
    for (const mt of doc.modTypes) {
      if (!ID_PATTERN.test(mt.id)) {
        errors.push({
          code: 'GDL106',
          message: `modType.id \`${mt.id}\` must match ${ID_PATTERN}`,
          span: mt.span,
        });
      }
      if (seen.has(mt.id)) {
        errors.push({
          code: 'GDL102',
          message: `duplicate modType id \`${mt.id}\``,
          span: mt.span,
        });
      }
      seen.add(mt.id);
    }
  }

  if (doc.stores) {
    const seen = new Set<string>();
    for (const e of doc.stores.entries) {
      if (seen.has(e.id)) {
        errors.push({
          code: 'GDL107',
          message: `duplicate store \`${e.id}\``,
          span: e.span,
        });
      }
      seen.add(e.id);
    }
  }

  return errors;
};
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test validator`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add src/schema/ tests/validator.test.ts
git commit -m "Add schema validator with structural rules"
```

---

## Task 9: Runtime: branch-tag dispatch and interpolation

**Files:**
- Create: `src/runtime/branch-tags.ts`
- Create: `src/runtime/interpolate.ts`
- Create: `src/runtime/context-resolver.ts`
- Create: `src/runtime/index.ts`
- Create: `tests/context-resolver.test.ts`

The runtime helpers are pure functions, so we write them now and the codegen calls them later. Same modules ship in the bundled extension.

- [ ] **Step 1: Create `src/runtime/branch-tags.ts`**

```ts
export interface BranchValue {
  kind: 'storeBranch' | 'osBranch' | 'versionBranch';
  arms: Record<string, unknown>;
  default: unknown;
}

export const resolveBranch = (branch: BranchValue, ctx: Record<string, string>): unknown => {
  const key = branch.kind === 'storeBranch' ? ctx.store
            : branch.kind === 'osBranch'    ? ctx.os
            : ctx.version;
  if (key !== undefined && key in branch.arms) return branch.arms[key];
  return branch.default;
};
```

- [ ] **Step 2: Create `src/runtime/interpolate.ts`**

```ts
const PATTERN = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export const interpolate = (
  template: string,
  ctx: Record<string, string | number | boolean>,
): string =>
  template.replace(PATTERN, (_, name: string) => {
    if (!(name in ctx)) throw new Error(`unbound variable \`${name}\` in template \`${template}\``);
    return String(ctx[name]);
  });

export const referencedNames = (template: string): string[] => {
  const names: string[] = [];
  for (const m of template.matchAll(PATTERN)) names.push(m[1]!);
  return names;
};
```

- [ ] **Step 3: Create `src/runtime/context-resolver.ts`**

```ts
import { interpolate, referencedNames } from './interpolate.js';
import { resolveBranch, type BranchValue } from './branch-tags.js';

export type ResolvableValue =
  | { kind: 'literal'; raw: string | number | boolean }
  | { kind: 'interpolated'; template: string }
  | BranchValue;

export interface ContextSpec {
  bindings: { name: string; value: ResolvableValue }[];
}

export interface DiscoveryFacts {
  store: string;
  os: 'windows' | 'linux' | 'macos';
  arch: 'x64' | 'arm64';
  installPath: string;
  executablePath: string;
  userDataPath?: string;
  documentsPath?: string;
  version?: string;
}

export type ResolvedContext = Record<string, string | number | boolean>;

const resolveValue = (
  value: ResolvableValue,
  ctx: ResolvedContext,
): string | number | boolean => {
  if (value.kind === 'literal') return value.raw;
  if (value.kind === 'interpolated') return interpolate(value.template, ctx);
  const resolved = resolveBranch(value, ctx as Record<string, string>);
  // Branch arms are themselves ResolvableValues — recurse.
  return resolveValue(resolved as ResolvableValue, ctx);
};

const topologicalOrder = (spec: ContextSpec): string[] => {
  const indegree = new Map<string, number>();
  const edges = new Map<string, Set<string>>();
  for (const b of spec.bindings) {
    indegree.set(b.name, 0);
    edges.set(b.name, new Set());
  }
  for (const b of spec.bindings) {
    const deps =
      b.value.kind === 'interpolated' ? referencedNames(b.value.template) :
      b.value.kind === 'literal'      ? [] :
      // Branch values may reference vars in arms — collect from interpolated arms.
      Object.values(b.value.arms).concat([b.value.default]).flatMap(arm => {
        const a = arm as ResolvableValue;
        return a?.kind === 'interpolated' ? referencedNames(a.template) : [];
      });
    for (const dep of deps) {
      if (!indegree.has(dep)) continue;       // built-in; no ordering needed
      edges.get(dep)!.add(b.name);
      indegree.set(b.name, (indegree.get(b.name) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const ready = spec.bindings.filter(b => indegree.get(b.name) === 0).map(b => b.name);
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    for (const succ of edges.get(n) ?? []) {
      indegree.set(succ, indegree.get(succ)! - 1);
      if (indegree.get(succ) === 0) ready.push(succ);
    }
  }
  if (order.length !== spec.bindings.length) {
    throw new Error('context bindings have a cycle');
  }
  return order;
};

export const resolveContext = (
  spec: ContextSpec,
  facts: DiscoveryFacts,
): ResolvedContext => {
  const ctx: ResolvedContext = { ...facts as Record<string, string | number | boolean> };
  const byName = new Map(spec.bindings.map(b => [b.name, b.value]));
  for (const name of topologicalOrder(spec)) {
    ctx[name] = resolveValue(byName.get(name)!, ctx);
  }
  return Object.freeze(ctx);
};
```

- [ ] **Step 4: Create `src/runtime/index.ts`**

```ts
export * from './context-resolver.js';
export * from './interpolate.js';
export * from './branch-tags.js';
```

- [ ] **Step 5: Write tests in `tests/context-resolver.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveContext, type ContextSpec, type DiscoveryFacts } from '../src/runtime/context-resolver.js';

const facts: DiscoveryFacts = {
  store: 'steam',
  os: 'windows',
  arch: 'x64',
  installPath: 'C:/Games/Hello',
  executablePath: 'C:/Games/Hello/HelloWorld.exe',
};

describe('resolveContext', () => {
  it('resolves literal and interpolated bindings', () => {
    const spec: ContextSpec = {
      bindings: [
        { name: 'modsRoot', value: { kind: 'interpolated', template: '${installPath}/Mods' } },
        { name: 'tag',      value: { kind: 'literal',      raw: 'pak' } },
      ],
    };
    const ctx = resolveContext(spec, facts);
    expect(ctx.modsRoot).toBe('C:/Games/Hello/Mods');
    expect(ctx.tag).toBe('pak');
  });

  it('resolves !storeBranch by ctx.store', () => {
    const spec: ContextSpec = {
      bindings: [{
        name: 'paksRoot',
        value: {
          kind: 'storeBranch',
          arms: { xbox: { kind: 'interpolated', template: '${installPath}/Content/Paks/~mods' } },
          default:        { kind: 'interpolated', template: '${installPath}/Game/Content/Paks/~mods' },
        },
      }],
    };
    expect(resolveContext(spec, facts).paksRoot).toBe('C:/Games/Hello/Game/Content/Paks/~mods');
    expect(resolveContext(spec, { ...facts, store: 'xbox' }).paksRoot).toBe('C:/Games/Hello/Content/Paks/~mods');
  });

  it('orders bindings topologically', () => {
    const spec: ContextSpec = {
      bindings: [
        { name: 'b', value: { kind: 'interpolated', template: '${a}/b' } },
        { name: 'a', value: { kind: 'interpolated', template: '${installPath}/a' } },
      ],
    };
    expect(resolveContext(spec, facts).b).toBe('C:/Games/Hello/a/b');
  });

  it('throws on unbound variables', () => {
    const spec: ContextSpec = {
      bindings: [{ name: 'x', value: { kind: 'interpolated', template: '${missing}' } }],
    };
    expect(() => resolveContext(spec, facts)).toThrow(/unbound variable/);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm test context-resolver`
Expected: PASS (4 cases).

- [ ] **Step 7: Commit**

```bash
git add src/runtime/ tests/context-resolver.test.ts
git commit -m "Add runtime context resolver with branch dispatch and interpolation"
```

---

## Task 10: Vortex API shim and minimal vendored types

**Files:**
- Create: `src/types/vortex-api.d.ts`
- Create: `src/runtime/vortex-shim.ts`
- Modify: `src/runtime/index.ts`

The shim is the only thing the generated code uses to talk to Vortex. We vendor just enough of `vortex-api` to compile against. The bundled output will import `vortex-api` for real at extension load time.

- [ ] **Step 1: Create `src/types/vortex-api.d.ts`**

```ts
declare module 'vortex-api' {
  export interface IGame {
    id: string;
    name: string;
    shortName?: string;
    executable: () => string;
    logo?: string;
    requiredFiles: string[];
    contributed?: string;
    environment?: Record<string, string>;
    details?: Record<string, unknown>;
    queryPath: () => Promise<string | { path: string; store?: string }>;
    queryModPath: () => string;
    setup?: (discovery: { path?: string }) => Promise<void>;
    supportedTools?: unknown[];
  }

  export interface IModType {
    id: string;
    name: string;
    getPath: (game: IGame) => string;
    priority?: 'high' | 'low';
    test?: (instructions: unknown) => Promise<boolean>;
  }

  export interface IExtensionContext {
    registerGame: (game: IGame) => void;
    registerModType: (
      id: string,
      priority: number,
      isSupported: (gameId: string) => boolean,
      getPath: (game: IGame) => string,
      test: (instructions: unknown) => Promise<boolean>,
      options?: { name?: string },
    ) => void;
  }

  export const log: (level: string, message: string, meta?: unknown) => void;
}
```

> **Note:** these are the minimum members the MVP shim calls. As plan 2 adds installers, the d.ts grows. The real `vortex-api` is broader; we vendor only what we use.

- [ ] **Step 2: Create `src/runtime/vortex-shim.ts`**

```ts
import type { IExtensionContext, IGame } from 'vortex-api';
import type { DiscoveryFacts, ResolvedContext, ResolvableValue } from './context-resolver.js';
import { resolveContext, type ContextSpec } from './context-resolver.js';
import { interpolate } from './interpolate.js';
import { resolveBranch } from './branch-tags.js';

export interface GameDecl {
  id: string;
  name: string;
  executable: string;
  requiredFiles: string[];
  logo?: string;
  contributedBy?: string;
}

export interface ModTypeDecl {
  id: string;
  name: string;
  path: ResolvableValue;
}

export interface StoreDecl {
  id: string;
  value: string | number;
}

export class GdlRuntime {
  private resolvedCtx?: ResolvedContext;

  constructor(private readonly api: IExtensionContext) {}

  registerGame(decl: GameDecl, stores: StoreDecl[], contextSpec: ContextSpec, modTypes: ModTypeDecl[]) {
    const game: IGame = {
      id: decl.id,
      name: decl.name,
      executable: () => decl.executable,
      requiredFiles: decl.requiredFiles,
      logo: decl.logo,
      contributed: decl.contributedBy,
      queryPath: async () => {
        const facts = await this.discover(stores);
        if (!facts) return '';
        this.resolvedCtx = resolveContext(contextSpec, facts);
        return { path: facts.installPath, store: facts.store };
      },
      queryModPath: () => '.',
    };
    this.api.registerGame(game);

    for (const mt of modTypes) {
      this.api.registerModType(
        mt.id,
        50,
        (gameId) => gameId === decl.id,
        () => this.resolveModTypePath(mt),
        async () => true,
        { name: mt.name },
      );
    }
  }

  private resolveModTypePath(mt: ModTypeDecl): string {
    if (!this.resolvedCtx) return '';
    if (mt.path.kind === 'literal') return String(mt.path.raw);
    if (mt.path.kind === 'interpolated') {
      return interpolate(mt.path.template, this.resolvedCtx);
    }
    // Branch value: dispatch then recursively resolve the chosen arm against ctx.
    const arm = resolveBranch(mt.path, this.resolvedCtx as Record<string, string>) as ResolvableValue;
    if (arm.kind === 'literal') return String(arm.raw);
    if (arm.kind === 'interpolated') return interpolate(arm.template, this.resolvedCtx);
    // Nested branches are uncommon for modType paths but supported for symmetry.
    return String(resolveBranch(arm, this.resolvedCtx as Record<string, string>));
  }

  private async discover(stores: StoreDecl[]): Promise<DiscoveryFacts | null> {
    // Plan 1 stub: trust Vortex's own game-store helpers indirectly through
    // queryPath's caller. For MVP we just return null when no install is found.
    // A later plan will plug stores in to GameStoreHelper.
    void stores;
    return null;
  }
}
```

> **Note on the discover stub:** the MVP plan ends at "extension loads and registers without throwing." Wiring Vortex's `GameStoreHelper` to actually find Steam/Epic installs comes with the installer work in plan 2 (it shares the discovery facts plumbing with the installer engine). The shim is structured so plan 2's change is local.

- [ ] **Step 3: Update `src/runtime/index.ts`**

```ts
export * from './context-resolver.js';
export * from './interpolate.js';
export * from './branch-tags.js';
export * from './vortex-shim.js';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/ src/runtime/vortex-shim.ts src/runtime/index.ts
git commit -m "Add Vortex API shim and minimal vendored vortex-api types"
```

---

## Task 11: Codegen: emit extension.ts

**Files:**
- Create: `src/codegen/emit.ts`
- Create: `tests/codegen.test.ts`

The codegen consumes a validated `DocumentNode`, lowers branch tags and `ValueNode`s to runtime-friendly object literals, and emits a single `.gdl-out/extension.ts` that constructs a `GdlRuntime` and calls `registerGame` with the declared blocks.

- [ ] **Step 1: Write the failing test in `tests/codegen.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { emit } from '../src/codegen/emit.js';

const TINY = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
stores:
  steam: 264710
modTypes:
  - { id: pak, name: Pak Mod, path: ${'${installPath}'}/Mods }
`;

describe('emit', () => {
  it('emits an extension.ts that registers the game and a mod type', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path.endsWith('extension.ts'));
    expect(ext).toBeDefined();
    expect(ext!.contents).toContain("import { GdlRuntime } from '@gdl/runtime'");
    expect(ext!.contents).toContain("id: 'helloworld'");
    expect(ext!.contents).toContain("name: 'Pak Mod'");
    expect(ext!.contents).toContain("template: '${installPath}/Mods'");
  });

  it('emits info.json with id, name, version', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc, { extensionVersion: '0.1.0' });
    const info = files.find(f => f.path.endsWith('info.json'));
    expect(info).toBeDefined();
    const parsed = JSON.parse(info!.contents);
    expect(parsed).toMatchObject({ id: 'helloworld', name: 'Hello World', version: '0.1.0' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test codegen`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/codegen/emit.ts`**

```ts
import type { DocumentNode, ValueNode } from '../parser/ast.js';

export interface EmittedFile {
  path: string;        // relative to .gdl-out/
  contents: string;
}

export interface EmitOptions {
  extensionVersion?: string;
}

const renderValueNode = (v: ValueNode): string => {
  if (v.kind === 'literal') {
    return `{ kind: 'literal', raw: ${JSON.stringify(v.raw)} }`;
  }
  if (v.kind === 'interpolated') {
    return `{ kind: 'interpolated', template: ${JSON.stringify(v.template)} }`;
  }
  // Branch tag.
  const arms = Object.entries(v.arms)
    .map(([k, arm]) => `${JSON.stringify(k)}: ${renderValueNode(arm)}`)
    .join(', ');
  return `{ kind: ${JSON.stringify(v.kind)}, arms: { ${arms} }, default: ${renderValueNode(v.default)} }`;
};

const HEADER = `// AUTO-GENERATED by GDL. Do not edit by hand.
// Source: \${file}
`;

const banner = (file: string) => HEADER.replace('${file}', file);

export const emit = (doc: DocumentNode, opts: EmitOptions = {}): EmittedFile[] => {
  const bindings = (doc.context?.bindings ?? [])
    .map(b => `      { name: ${JSON.stringify(b.name)}, value: ${renderValueNode(b.value)} }`)
    .join(',\n');

  const modTypes = (doc.modTypes ?? [])
    .map(mt => `      { id: ${JSON.stringify(mt.id)}, name: ${JSON.stringify(mt.name)}, path: ${renderValueNode(mt.path)} }`)
    .join(',\n');

  const stores = (doc.stores?.entries ?? [])
    .map(s => `      { id: ${JSON.stringify(s.id)}, value: ${JSON.stringify(s.value)} }`)
    .join(',\n');

  const extension = `${banner(doc.game.span.file)}
import { GdlRuntime } from '@gdl/runtime';
import type { IExtensionContext } from 'vortex-api';

export default function main(api: IExtensionContext): boolean {
  const runtime = new GdlRuntime(api);
  runtime.registerGame(
    {
      id: ${JSON.stringify(doc.game.id)},
      name: ${JSON.stringify(doc.game.name)},
      executable: ${JSON.stringify(doc.game.executable)},
      requiredFiles: ${JSON.stringify(doc.game.requiredFiles)},
      ${doc.game.logo ? `logo: ${JSON.stringify(doc.game.logo)},` : ''}
      ${doc.game.contributedBy ? `contributedBy: ${JSON.stringify(doc.game.contributedBy)},` : ''}
    },
    [
${stores}
    ],
    {
      bindings: [
${bindings}
      ],
    },
    [
${modTypes}
    ],
  );
  return true;
}
`;

  const info = JSON.stringify({
    id: doc.game.id,
    name: doc.game.name,
    version: opts.extensionVersion ?? '0.0.0',
    description: `Vortex extension for ${doc.game.name} (generated by GDL).`,
  }, null, 2);

  return [
    { path: 'extension.ts', contents: extension },
    { path: 'info.json',    contents: info },
  ];
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test codegen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegen/ tests/codegen.test.ts
git commit -m "Emit extension.ts and info.json from a validated document"
```

---

## Task 12: Writing emitted files to .gdl-out/

**Files:**
- Modify: `src/codegen/emit.ts` (add `writeEmittedFiles` helper)
- Modify: `tests/codegen.test.ts` (add a filesystem case)

- [ ] **Step 1: Append a test in `tests/codegen.test.ts`**

```ts
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('writeEmittedFiles', () => {
  it('writes files to .gdl-out under the target dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-emit-'));
    const doc = parseYaml(TINY, 'tiny.yaml');
    const { writeEmittedFiles } = await import('../src/codegen/emit.js');
    await writeEmittedFiles(dir, emit(doc, { extensionVersion: '0.1.0' }));
    expect(existsSync(join(dir, '.gdl-out', 'extension.ts'))).toBe(true);
    const info = JSON.parse(readFileSync(join(dir, '.gdl-out', 'info.json'), 'utf8'));
    expect(info.version).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test codegen`
Expected: FAIL (`writeEmittedFiles` not exported).

- [ ] **Step 3: Add `writeEmittedFiles` to `src/codegen/emit.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const writeEmittedFiles = async (cwd: string, files: EmittedFile[]): Promise<void> => {
  const outDir = join(cwd, '.gdl-out');
  await mkdir(outDir, { recursive: true });
  for (const f of files) {
    const dest = join(outDir, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.contents, 'utf8');
  }
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test codegen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegen/emit.ts tests/codegen.test.ts
git commit -m "Write emitted files to .gdl-out/"
```

---

## Task 13: Bundler: webpack invocation

**Files:**
- Create: `src/bundler/webpack.config.ts`
- Create: `src/bundler/index.ts`
- Create: `tests/bundler.test.ts`

The bundler takes a target dir (the extension repo's cwd) that already has `.gdl-out/extension.ts`, runs webpack, and produces `dist/extension.js`. The webpack config aliases `@gdl/runtime` to the submodule's compiled runtime.

- [ ] **Step 1: Create `src/bundler/webpack.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import type { Configuration } from 'webpack';

const here = dirname(fileURLToPath(import.meta.url));

export const buildConfig = (cwd: string): Configuration => ({
  mode: 'production',
  entry: join(cwd, '.gdl-out', 'extension.ts'),
  target: 'node',
  output: {
    path: join(cwd, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@gdl/runtime': resolve(here, '..', 'runtime'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
          compilerOptions: { module: 'commonjs', target: 'es2022' },
        },
      },
    ],
  },
  externals: {
    'vortex-api': 'commonjs2 vortex-api',
  },
});
```

- [ ] **Step 2: Create `src/bundler/index.ts`**

```ts
import webpack from 'webpack';
import { buildConfig } from './webpack.config.js';

export const runBundler = (cwd: string): Promise<void> =>
  new Promise((res, rej) => {
    webpack(buildConfig(cwd), (err, stats) => {
      if (err) return rej(err);
      if (!stats) return rej(new Error('webpack returned no stats'));
      if (stats.hasErrors()) {
        return rej(new Error(stats.toString({ all: false, errors: true, errorDetails: true })));
      }
      res();
    });
  });
```

- [ ] **Step 3: Write a bundler test in `tests/bundler.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBundler } from '../src/bundler/index.js';

describe('runBundler', () => {
  it('bundles a trivial extension.ts to dist/extension.js', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-bundle-'));
    await mkdir(join(dir, '.gdl-out'), { recursive: true });
    writeFileSync(
      join(dir, '.gdl-out', 'extension.ts'),
      `import type { IExtensionContext } from 'vortex-api';\n` +
      `export default function main(_api: IExtensionContext): boolean { return true; }\n`,
    );
    await runBundler(dir);
    expect(existsSync(join(dir, 'dist', 'extension.js'))).toBe(true);
    const bundle = readFileSync(join(dir, 'dist', 'extension.js'), 'utf8');
    expect(bundle).toContain('vortex-api');   // externalised reference present
  }, 30000);
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test bundler`
Expected: PASS (note the 30s timeout; webpack startup is slow).

- [ ] **Step 5: Commit**

```bash
git add src/bundler/ tests/bundler.test.ts
git commit -m "Add webpack bundler invocation with @gdl/runtime alias"
```

---

## Task 14: Build command orchestration

**Files:**
- Create: `src/commands/build.ts`
- Modify: `tests/codegen.test.ts` (optional; covered by e2e)

`gdl build` is the public verb. It reads `game.yaml`, parses → validates → resolves → emits → bundles, copying `info.json` into `dist/` next to the bundle.

- [ ] **Step 1: Create `src/commands/build.ts`**

```ts
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';
import { validate } from '../schema/validator.js';
import { emit, writeEmittedFiles } from '../codegen/emit.js';
import { runBundler } from '../bundler/index.js';
import { BuildErrors, formatError } from '../errors.js';

export interface BuildArgs {
  cwd: string;            // directory containing game.yaml + package.json
  yamlPath?: string;      // override default ./game.yaml
}

export const buildExtension = async (args: BuildArgs): Promise<void> => {
  const yamlPath = args.yamlPath ?? join(args.cwd, 'game.yaml');
  const source = await readFile(yamlPath, 'utf8');
  const doc = parseYaml(source, yamlPath);

  const errors = validate(doc);
  if (errors.length) throw new BuildErrors(errors);

  let extensionVersion = '0.0.0';
  try {
    const pkg = JSON.parse(await readFile(join(args.cwd, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string') extensionVersion = pkg.version;
  } catch { /* tolerate missing package.json in tests */ }

  const files = emit(doc, { extensionVersion });
  await writeEmittedFiles(args.cwd, files);

  await runBundler(args.cwd);

  // Copy info.json next to dist/extension.js so Vortex sees it.
  await mkdir(join(args.cwd, 'dist'), { recursive: true });
  await copyFile(join(args.cwd, '.gdl-out', 'info.json'), join(args.cwd, 'dist', 'info.json'));
};

export const reportBuildError = (err: unknown): string => {
  if (err instanceof BuildErrors) {
    return err.errors.map(formatError).join('\n');
  }
  return err instanceof Error ? err.message : String(err);
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/commands/
git commit -m "Add build command orchestrator"
```

---

## Task 15: CLI entry point

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (already declares the bin; ensure the build emits an executable)

- [ ] **Step 1: Create `src/cli.ts`**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { buildExtension, reportBuildError } from './commands/build.js';

const program = new Command();
program
  .name('gdl')
  .description('Game Description Language toolchain')
  .version('0.0.1');

program
  .command('build')
  .description('Build the current extension (game.yaml → dist/extension.js)')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .action(async (opts: { yaml?: string }) => {
    try {
      await buildExtension({ cwd: process.cwd(), yamlPath: opts.yaml });
      process.stdout.write('build ok\n');
    } catch (err) {
      process.stderr.write(reportBuildError(err) + '\n');
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
```

- [ ] **Step 2: Build the package**

Run: `pnpm build`
Expected: `dist/cli.js` exists. Verify with `ls dist/cli.js`.

- [ ] **Step 3: Make cli.js executable**

Run: `chmod +x dist/cli.js`
Expected: no output.

- [ ] **Step 4: Sanity-run the CLI**

Run: `node dist/cli.js --help`
Expected: prints commander usage text including the `build` subcommand.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "Add gdl CLI with build subcommand"
```

---

## Task 16: End-to-end smoke test

**Files:**
- Create: `tests/e2e.test.ts`
- Create: `tests/fixtures/e2e/game.yaml`
- Create: `tests/fixtures/e2e/package.json`

A test that drives the same path the user will: a temp directory with a `game.yaml` and `package.json`, run `buildExtension`, assert `dist/extension.js` exists and the bundle exports a function.

- [ ] **Step 1: Create `tests/fixtures/e2e/game.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
stores:
  steam: 264710
context:
  modsRoot: ${installPath}/Mods
  paksRoot: !storeBranch
    xbox:    ${installPath}/Content/Paks/~mods
    default: ${modsRoot}/Paks
modTypes:
  - { id: pak, name: Pak Mod, path: ${paksRoot} }
```

- [ ] **Step 2: Create `tests/fixtures/e2e/package.json`**

```json
{
  "name": "game-helloworld",
  "version": "0.1.0",
  "private": true
}
```

- [ ] **Step 3: Write `tests/e2e.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExtension } from '../src/commands/build.js';

describe('end-to-end', () => {
  it('builds a hello-world extension from yaml to bundle', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-e2e-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });

    await buildExtension({ cwd: work });

    expect(existsSync(join(work, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'info.json'))).toBe(true);

    const info = JSON.parse(readFileSync(join(work, 'dist', 'info.json'), 'utf8'));
    expect(info).toMatchObject({ id: 'helloworld', name: 'Hello World', version: '0.1.0' });

    const bundle = readFileSync(join(work, 'dist', 'extension.js'), 'utf8');
    expect(bundle).toMatch(/helloworld/);
    expect(bundle).toMatch(/Pak Mod/);
  }, 60000);
});
```

- [ ] **Step 4: Run the e2e test**

Run: `pnpm test e2e`
Expected: PASS (60s timeout; webpack is the slowest step).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.test.ts tests/fixtures/e2e/
git commit -m "Add end-to-end build smoke test"
```

---

## Task 17: Manual Vortex load (acceptance)

**Files:** none new. This is an out-of-CI human check.

The earlier tasks prove the toolchain produces *some* bundle. This task verifies that a real Vortex instance loads the bundle and shows the game in its games list. It is a manual step because Vortex itself is GUI-driven and not in scope to automate from here.

- [ ] **Step 1: Build the fixture extension**

From the GDL repo root, run:

```bash
( cd tests/fixtures/e2e && node ../../../dist/cli.js build )
```

Expected: `tests/fixtures/e2e/dist/extension.js` exists. `build ok` printed.

- [ ] **Step 2: Install into a Vortex dev install**

Locate a Vortex install directory's extensions path. On Windows: `%APPDATA%/Vortex/plugins/`. On Linux (Flatpak or running from source): the path printed by `vortex --print-paths` or the `extensions/` directory of the dev tree.

Create a directory named `game-helloworld` inside that path and copy in:

```
game-helloworld/
├── extension.js     (from tests/fixtures/e2e/dist/)
└── info.json        (from tests/fixtures/e2e/dist/)
```

- [ ] **Step 3: Launch Vortex and confirm**

Open Vortex. Open the Games panel. Confirm "Hello World" appears in the unmanaged games list with no error toast and no console error in DevTools (Ctrl+Shift+I).

Recording the result: capture a screenshot for the PR description (filed as `docs/superpowers/plans/2026-05-20-gdl-mvp-pipeline-acceptance.png` or similar). The "managed/unmanaged" status will read "unmanaged" because we have no discovery wiring yet (deferred to Plan 2); that is the expected result for this MVP.

- [ ] **Step 4: Commit the acceptance artifact**

If a screenshot was captured:

```bash
git add docs/superpowers/plans/2026-05-20-gdl-mvp-pipeline-acceptance.png
git commit -m "MVP acceptance: Hello World extension loads in Vortex"
```

If the screenshot was not captured (e.g., no Vortex available in this environment), record the verification outcome in a one-line note in the plan's task box. The team treats this task as satisfied when the bundle has been confirmed to load in any team member's environment.

---

## Self-review checklist (run after completing all tasks)

- [ ] All inline `*.test.ts` files pass: `pnpm test`
- [ ] Typecheck clean: `pnpm typecheck`
- [ ] Build succeeds: `pnpm build`
- [ ] `dist/cli.js` is executable and `--help` prints commander output
- [ ] End-to-end fixture produces `dist/extension.js` and `dist/info.json` with the expected fields
- [ ] No code references types that are not defined in this plan (`GdlRuntime`, `BuildError`, `DocumentNode`, `ResolvableValue`, etc. all defined)
- [ ] No `TODO`, `TBD`, or "see later" comments in committed code
- [ ] The MVP correctly excludes installers, tools, load order, prelaunch, diagnostics, hooks, tests block, JSON Schema generation, source maps, and the publish/package CLI verbs (explicitly Plan 2/3/4)

---

## What this plan does not deliver (and where it goes)

- **Installer engine, `route:`, pattern matching beyond context, predicates with `!when`/`!any`/`!all`** → Plan 2.
- **`!hook` references and TypeScript compiler-API validation** → Plan 2 (introduces a real reason for hooks).
- **Source maps from generated TS back to YAML** → Plan 2 (the value is highest when installer rules throw at runtime).
- **`tests.cases:` emission to Vitest, corpus runs, Nexus client** → Plan 3.
- **`gdl package`, `gdl publish`, `gdl init`, GH Actions workflows** → Plan 4.
- **Subnautica2 port + diff-against-legacy validation** → Plan 5.

Each follow-up plan should produce its own `docs/superpowers/specs/`-side notes only if the design needs revision in light of MVP findings; the original spec is otherwise the source of truth.
