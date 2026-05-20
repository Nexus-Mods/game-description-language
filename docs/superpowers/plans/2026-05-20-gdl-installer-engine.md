# GDL Installer Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full installer support to the GDL toolchain — `installers:` rules with anchor/take/placeAt single form and `route:` composite form, pattern matchers (`!hasFile`/`!hasFiles`/`!matches`), predicate combinators (`!when`/`!any`/`!all`/`!not` + comparators), `!hook` references with compile-time validation, real Vortex discovery via `GameStoreHelper`, and source maps from generated TS back to YAML — enough to port `game-subnautica2`.

**Architecture:** Same package layout as MVP. The runtime grows three modules (glob, pattern-matcher, installer-engine) whose pure-function cores make them trivially testable. The codegen grows: it now resolves `!hook` references against the user's `src/hooks.ts` via the TypeScript compiler API, emits per-installer functions, and writes `.ts.map` source maps. The Vortex shim grows `registerInstaller` and a real `discover()` that walks declared stores through `GameStoreHelper`.

**Tech Stack:** Existing Plan 1 stack (Node 22, TypeScript 5.4, `yaml@2`, `vitest@3`, `webpack@5` + `ts-loader`, `commander@12`, `pnpm@11`). New runtime dep: `picomatch@4` for glob matching (small, battle-tested, ships in the bundle). The TypeScript compiler API is already available via the existing `typescript` devDep.

**Spec reference:** `docs/superpowers/specs/2026-05-20-game-description-language-design.md`, §3.3 (evaluation tags), §3.5 (pattern syntax), §3.6 (installers), §4 phase 4 (hook resolution), §4 phase 6 (source maps), §5 (installer engine + Vortex shim).

---

## File structure (delta from Plan 1)

```
game-description-language/
├── package.json                                  # add picomatch dep
├── src/
│   ├── parser/
│   │   ├── ast.ts                                # +InstallerNode, +RouteNode, +PredicateNode, +PatternNode, +HookRefNode
│   │   ├── index.ts                              # parse installers + new tags
│   │   └── tags.ts                               # +!hasFile/!hasFiles/!matches, +!when/!any/!all/!not, +!hook
│   ├── schema/
│   │   ├── hook-catalog.ts          (new)        # hook ID → expected TS signature
│   │   └── validator.ts                          # +installer validation, +hook usage validation
│   ├── runtime/
│   │   ├── glob.ts                  (new)        # compile a glob into a matcher
│   │   ├── pattern-matcher.ts       (new)        # hasFile/hasFiles/matches against file lists
│   │   ├── predicate.ts             (new)        # when/any/all/not + comparators
│   │   ├── installer-engine.ts      (new)        # anchor/take/placeAt → install plan
│   │   ├── context-resolver.ts                   # +version hook integration
│   │   └── vortex-shim.ts                        # +registerInstaller, real discover()
│   ├── codegen/
│   │   ├── emit.ts                               # +emit installer functions, +emit hook imports
│   │   ├── source-map.ts            (new)        # YAML pos → generated TS line/col
│   │   └── hook-resolver.ts         (new)        # TS compiler API: validate src/hooks.ts
│   ├── bundler/
│   │   └── webpack.config.ts                     # chain devtool source maps
│   └── types/
│       └── vortex-api.d.ts                       # +IInstaller, +IInstruction, +GameStoreHelper
└── tests/
    ├── glob.test.ts                 (new)
    ├── pattern-matcher.test.ts      (new)
    ├── predicate.test.ts            (new)
    ├── installer-engine.test.ts     (new)
    ├── hook-resolver.test.ts        (new)
    ├── source-map.test.ts           (new)
    ├── parser.test.ts                            # +installer parsing tests
    ├── validator.test.ts                         # +installer validation tests
    ├── codegen.test.ts                           # +installer emission tests
    ├── e2e.test.ts                               # +installer end-to-end
    └── fixtures/
        ├── with-installer.yaml      (new)
        ├── with-route.yaml          (new)
        ├── with-hook.yaml           (new)
        ├── e2e/                                   # update game.yaml to add installer
        └── subnautica2-shaped/      (new)        # late-plan validation fixture
```

`tests/fixtures/subnautica2-shaped/` mirrors the subnautica2 extension's shape (pak / LogicMods / UE4SS-Lua) for the final E2E. It is not the real port — that's Plan 5 — but it exercises the same installer combinations.

---

## Vertical slice first

Tasks 1–9 deliver one minimal installer end to end: a YAML with one installer rule (single anchor + take + placeAt + modType, predicate `!hasFile <glob>`) produces a working extension that installs that pattern. Then tasks 10–22 add: route form, more predicates, hooks, discovery, source maps, and the subnautica2-shaped fixture.

---

## Task 1: Glob matcher

**Files:**
- Create: `src/runtime/glob.ts`
- Create: `tests/glob.test.ts`
- Modify: `package.json` (add `picomatch` dep)

A reusable glob matcher backed by `picomatch`. Used by `!hasFile`/`!hasFiles`/`!matches`, by installer `anchor` and route `match`, and later by diagnostics. Compile once per pattern, match many times.

- [ ] **Step 1: Add `picomatch` to runtime deps**

Edit `package.json`'s `dependencies` to add `"picomatch": "^4.0.2"`. Also add `"@types/picomatch": "^3.0.1"` to `devDependencies`.

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 2: Write failing tests in `tests/glob.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { compileGlob, matchAny } from '../src/runtime/glob.js';

describe('compileGlob', () => {
  it('matches single-star wildcards inside one path segment', () => {
    const m = compileGlob('*.pak');
    expect(m('MyMod.pak')).toBe(true);
    expect(m('subdir/MyMod.pak')).toBe(false);
  });

  it('matches double-star across segments', () => {
    const m = compileGlob('**/*.pak');
    expect(m('MyMod.pak')).toBe(true);
    expect(m('Mod/Sub/MyMod.pak')).toBe(true);
    expect(m('MyMod.txt')).toBe(false);
  });

  it('matches trailing slash anchors against directory prefixes', () => {
    const m = compileGlob('**/Scripts/');
    expect(m('a/Scripts/x.lua')).toBe(true);
    expect(m('Scripts/x.lua')).toBe(true);
    expect(m('a/Scripts')).toBe(false);
  });

  it('matches brace expansion', () => {
    const m = compileGlob('**/*.{pak,lua}');
    expect(m('a/x.pak')).toBe(true);
    expect(m('a/x.lua')).toBe(true);
    expect(m('a/x.txt')).toBe(false);
  });

  it('compiles once, evaluates many', () => {
    const m = compileGlob('**/*.pak');
    // Just checking the API shape — fn is reusable.
    expect(typeof m).toBe('function');
    expect(m('a.pak')).toBe(true);
    expect(m('b.pak')).toBe(true);
  });
});

describe('matchAny', () => {
  it('returns true if any file matches the glob', () => {
    const m = compileGlob('**/*.pak');
    expect(matchAny(['a.txt', 'b.pak'], m)).toBe(true);
    expect(matchAny(['a.txt', 'b.lua'], m)).toBe(false);
  });
});
```

Run: `pnpm test glob`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/runtime/glob.ts`**

```ts
import picomatch from 'picomatch';

export type GlobMatcher = (path: string) => boolean;

export const compileGlob = (pattern: string): GlobMatcher => {
  // Trailing slash means "this directory" — match any file under it.
  const normalised = pattern.endsWith('/') ? `${pattern}**` : pattern;
  const m = picomatch(normalised, { dot: true, nocase: false });
  return (path: string) => m(path);
};

export const matchAny = (paths: readonly string[], matcher: GlobMatcher): boolean => {
  for (const p of paths) if (matcher(p)) return true;
  return false;
};

export const findFirst = (
  paths: readonly string[],
  matcher: GlobMatcher,
): string | undefined => {
  for (const p of paths) if (matcher(p)) return p;
  return undefined;
};
```

> Note on the trailing-slash convention: a glob like `**/Scripts/` matches if any file lives under a `Scripts/` directory. We desugar to `**/Scripts/**`. This matches the spec's stop-pattern semantics ("strip everything above the first match").

- [ ] **Step 4: Run tests**

Run: `pnpm test glob`
Expected: PASS (6 cases).

Also run: `pnpm test`
Expected: All 22 prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/runtime/glob.ts tests/glob.test.ts
git commit -m "Add glob matcher backed by picomatch"
```

---

## Task 2: Installer AST nodes

**Files:**
- Modify: `src/parser/ast.ts`

Add the AST types installers will be parsed into. No parser changes yet; this is shape-only.

- [ ] **Step 1: Extend `src/parser/ast.ts`**

Add to the document node and define new types. The full updated `DocumentNode` plus new types:

```ts
export interface DocumentNode extends Node {
  kind: 'document';
  gdl: number;
  game: GameNode;
  stores?: StoresNode;
  context?: ContextNode;
  modTypes?: ModTypeNode[];
  installers?: InstallerNode[];
}

export type TakeStrategy = 'self' | 'parent' | 'parent.parent' | { depth: number };

export interface InstallerNode extends Node {
  kind: 'installer';
  id: string;
  priority: number;
  when: PredicateNode;
  // Single-anchor form OR route form. Exactly one is set.
  single?: SingleInstallerForm;
  route?: RouteEntry[];
  // modType only required for single form; route entries carry their own modType.
  modType?: string;
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

// extend ValueNode to allow hook refs in context bindings (e.g. version detection)
// The new variant is added to the existing union.
export type ValueNode =
  | { kind: 'literal';        raw: string | number | boolean;                                  span: YamlSpan }
  | { kind: 'interpolated';   template: string;                                                 span: YamlSpan }
  | { kind: 'storeBranch';    arms: Record<string, ValueNode>; default: ValueNode;             span: YamlSpan }
  | { kind: 'osBranch';       arms: Record<string, ValueNode>; default: ValueNode;             span: YamlSpan }
  | { kind: 'versionBranch';  arms: Record<string, ValueNode>; default: ValueNode;             span: YamlSpan }
  | { kind: 'hookRef';        hookId: string;                                                   span: YamlSpan };

// Top-level discovery block

export interface DiscoveryNode extends Node {
  kind: 'discovery';
  version?: HookRefNode;       // !hook detectGameVersion
}
```

Add `discovery?: DiscoveryNode` to `DocumentNode`:

```ts
export interface DocumentNode extends Node {
  kind: 'document';
  gdl: number;
  game: GameNode;
  stores?: StoresNode;
  context?: ContextNode;
  modTypes?: ModTypeNode[];
  installers?: InstallerNode[];
  discovery?: DiscoveryNode;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. No callers of `ValueNode` yet need to handle the new `hookRef` variant — but emit.ts in codegen will (Task 14).

- [ ] **Step 3: Commit**

```bash
git add src/parser/ast.ts
git commit -m "Add installer/predicate/hook AST nodes"
```

---

## Task 3: Parser — pattern tags (`!hasFile`, `!hasFiles`, `!matches`)

**Files:**
- Modify: `src/parser/tags.ts`
- Modify: `src/parser/index.ts`

Register the pattern tags. They appear inside predicates and as installer anchors. Detection mirrors the branch-tag approach: register identity resolvers in customTags, then check `node.tag` during AST construction.

- [ ] **Step 1: Extend `src/parser/tags.ts`**

Replace the existing content with:

```ts
import type { Tags } from 'yaml';

export type BranchTagName = '!storeBranch' | '!osBranch' | '!versionBranch';
export const BRANCH_TAG_NAMES: ReadonlySet<BranchTagName> =
  new Set(['!storeBranch', '!osBranch', '!versionBranch']);

export type PatternTagName = '!hasFile' | '!hasFiles' | '!matches';
export const PATTERN_TAG_NAMES: ReadonlySet<PatternTagName> =
  new Set(['!hasFile', '!hasFiles', '!matches']);

export type PredicateTagName = '!when' | '!any' | '!all' | '!not';
export const PREDICATE_TAG_NAMES: ReadonlySet<PredicateTagName> =
  new Set(['!when', '!any', '!all', '!not']);

export const HOOK_TAG = '!hook';

export const customTags: Tags = [
  // Branch tags (collection: map).
  { tag: '!storeBranch',   collection: 'map', resolve: (value: unknown) => value },
  { tag: '!osBranch',      collection: 'map', resolve: (value: unknown) => value },
  { tag: '!versionBranch', collection: 'map', resolve: (value: unknown) => value },

  // Predicate combinators (collection varies: !when is map; !any/!all are seq; !not is map-or-tag).
  { tag: '!when', collection: 'map', resolve: (value: unknown) => value },
  { tag: '!any',  collection: 'seq', resolve: (value: unknown) => value },
  { tag: '!all',  collection: 'seq', resolve: (value: unknown) => value },
  // !not wraps a single predicate; represented as a single-element seq for shape consistency.
  { tag: '!not',  collection: 'seq', resolve: (value: unknown) => value },

  // Pattern tags — applied to scalars (a glob string) or sequences (list of globs for !hasFiles).
  // We don't specify collection so the parser accepts either shape; the AST builder validates.
  { tag: '!hasFile',  resolve: (value: unknown) => value },
  { tag: '!hasFiles', resolve: (value: unknown) => value },
  { tag: '!matches',  resolve: (value: unknown) => value },

  // Hook reference — scalar carrying the hook id.
  { tag: HOOK_TAG, resolve: (value: unknown) => value },
];
```

- [ ] **Step 2: Add a fixture `tests/fixtures/with-installer.yaml`**

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
  - { id: pak, name: Pak Mod, path: "${modsRoot}" }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: "${modsRoot}"
    modType: pak
```

- [ ] **Step 3: Failing test in `tests/parser.test.ts`**

Append inside `describe('parseYaml')`:

```ts
  it('parses installers with !hasFile predicate', () => {
    const doc = parseYaml(fixture('with-installer.yaml'), 'with-installer.yaml');
    expect(doc.installers).toHaveLength(1);
    const i = doc.installers![0]!;
    expect(i.id).toBe('pak');
    expect(i.priority).toBe(10);
    expect(i.when).toMatchObject({ kind: 'hasFile' });
    if (i.when.kind !== 'hasFile') return;
    expect(i.when.pattern).toMatchObject({ kind: 'glob', pattern: '**/*.pak' });
    expect(i.single).toBeDefined();
    expect(i.single!.anchor).toMatchObject({ kind: 'glob', pattern: '**/*.pak' });
    expect(i.single!.take).toBe('parent');
    expect(i.single!.placeAt).toMatchObject({ kind: 'interpolated', template: '${modsRoot}' });
    expect(i.modType).toBe('pak');
  });
```

Run: `pnpm test parser`
Expected: FAIL — installers undefined.

- [ ] **Step 4: Extend `src/parser/index.ts`**

Add imports:

```ts
import {
  BRANCH_TAG_NAMES, type BranchTagName,
  PATTERN_TAG_NAMES, type PatternTagName,
  PREDICATE_TAG_NAMES, type PredicateTagName,
  HOOK_TAG,
} from './tags.js';
import type {
  InstallerNode, SingleInstallerForm, RouteEntry, TakeStrategy,
  PatternNode, PredicateNode, ComparisonExpr, ValueRef, DiscoveryNode, HookRefNode,
} from './ast.js';
```

Add three helpers above `parseYaml`:

```ts
const parsePattern = (node: YamlNode | null | undefined, file: string, source: string): PatternNode => {
  const span = spanOf(file, source, node ?? null);
  if (isScalar(node) && typeof node.value === 'string') {
    const tag = typeof node.tag === 'string' ? node.tag : '!hasFile';
    // Inside a !matches container the scalar is a regex; otherwise treat as glob.
    if (tag === '!matches') return { kind: 'regex', pattern: node.value, span };
    return { kind: 'glob', pattern: node.value, span };
  }
  throw new BuildErrors([{
    code: 'GDL040',
    message: 'expected a pattern string',
    span,
  }]);
};

const parseTakeStrategy = (node: YamlNode | null | undefined, file: string, source: string): TakeStrategy => {
  if (isScalar(node)) {
    const v = node.value;
    if (v === 'self' || v === 'parent' || v === 'parent.parent') return v;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { depth: v };
  }
  throw new BuildErrors([{
    code: 'GDL041',
    message: '`take:` must be one of `self`, `parent`, `parent.parent`, or a non-negative integer depth',
    span: spanOf(file, source, node ?? null),
  }]);
};

const parsePredicate = (node: YamlNode | null | undefined, file: string, source: string): PredicateNode => {
  const span = spanOf(file, source, node ?? null);
  const tag = (node as { tag?: unknown } | null)?.tag;

  if (typeof tag === 'string') {
    if (tag === '!hasFile') {
      return { kind: 'hasFile', pattern: parsePattern(node, file, source), span };
    }
    if (tag === '!hasFiles' && isSeq(node)) {
      const patterns = node.items.map(i => parsePattern(i as YamlNode, file, source));
      return { kind: 'hasFiles', patterns, span };
    }
    if (tag === '!matches') {
      return { kind: 'matches', pattern: parsePattern(node, file, source), span };
    }
    if (tag === '!any' && isSeq(node)) {
      return { kind: 'any', arms: node.items.map(i => parsePredicate(i as YamlNode, file, source)), span };
    }
    if (tag === '!all' && isSeq(node)) {
      return { kind: 'all', arms: node.items.map(i => parsePredicate(i as YamlNode, file, source)), span };
    }
    if (tag === '!not' && isSeq(node) && node.items.length === 1) {
      return { kind: 'not', arm: parsePredicate(node.items[0] as YamlNode, file, source), span };
    }
    if (tag === '!when' && isMap(node)) {
      return { kind: 'when', expr: parseComparison(node, file, source), span };
    }
  }

  throw new BuildErrors([{
    code: 'GDL042',
    message: 'expected a predicate (`!hasFile`/`!hasFiles`/`!matches`/`!when`/`!any`/`!all`/`!not`)',
    span,
  }]);
};

const parseComparison = (node: YamlNode, file: string, source: string): ComparisonExpr => {
  // !when: { op: ==, left: <ref>, right: <ref-or-list> }
  if (!isMap(node)) {
    throw new BuildErrors([{
      code: 'GDL043',
      message: '`!when` requires a mapping with `op`, `left`, `right`',
      span: spanOf(file, source, node),
    }]);
  }
  const op = String(node.get('op') ?? '');
  if (!['==', '!=', '>=', '<=', '>', '<', 'in'].includes(op)) {
    throw new BuildErrors([{
      code: 'GDL044',
      message: `unknown comparison operator \`${op}\``,
      span: spanOf(file, source, node),
      hint: 'one of: ==, !=, >=, <=, >, <, in',
    }]);
  }
  const leftRaw = node.get('left', true) as YamlNode;
  const rightRaw = node.get('right', true) as YamlNode;
  const left = parseValueRef(leftRaw, file, source);
  if (op === 'in') {
    if (!isSeq(rightRaw)) {
      throw new BuildErrors([{
        code: 'GDL045',
        message: '`in` operator requires `right` to be a sequence',
        span: spanOf(file, source, rightRaw),
      }]);
    }
    const right = rightRaw.items.map(i => parseValueRef(i as YamlNode, file, source));
    return { op: 'in', left, right };
  }
  const right = parseValueRef(rightRaw, file, source);
  return { op: op as ComparisonExpr['op'], left, right } as ComparisonExpr;
};

const parseValueRef = (node: YamlNode, file: string, source: string): ValueRef => {
  if (!isScalar(node)) {
    throw new BuildErrors([{
      code: 'GDL046',
      message: 'expected a scalar reference or literal',
      span: spanOf(file, source, node),
    }]);
  }
  const v = node.value;
  if (typeof v === 'string') {
    // ${name} → reference. Otherwise treat as literal string.
    const m = /^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/.exec(v);
    if (m) return { kind: 'ref', name: m[1]! };
    return { kind: 'literal', raw: v };
  }
  if (typeof v === 'number' || typeof v === 'boolean') return { kind: 'literal', raw: v };
  throw new BuildErrors([{
    code: 'GDL046',
    message: 'expected a scalar reference or literal',
    span: spanOf(file, source, node),
  }]);
};
```

Add the installers-block parser after the modTypes parsing block:

```ts
const installersYaml = root.get('installers', true);
let installers: InstallerNode[] | undefined;
if (isSeq(installersYaml)) {
  installers = [];
  for (const entry of installersYaml.items) {
    if (!isMap(entry)) {
      throw new BuildErrors([{
        code: 'GDL050',
        message: 'installer entries must be mappings',
        span: spanOf(file, source, entry as YamlNode),
      }]);
    }
    const id = String(entry.get('id') ?? '');
    const priority = Number(entry.get('priority') ?? 50);
    const when = parsePredicate(entry.get('when', true) as YamlNode, file, source);

    // Single vs route form
    const routeYaml = entry.get('route', true);
    let single: SingleInstallerForm | undefined;
    let route: RouteEntry[] | undefined;
    let modType: string | undefined;
    if (isSeq(routeYaml)) {
      route = routeYaml.items.map(rEntry => {
        if (!isMap(rEntry)) {
          throw new BuildErrors([{
            code: 'GDL051',
            message: 'route entries must be mappings',
            span: spanOf(file, source, rEntry as YamlNode),
          }]);
        }
        return {
          match:   parsePattern(rEntry.get('match', true)  as YamlNode, file, source),
          anchor:  parsePattern(rEntry.get('anchor', true) as YamlNode, file, source),
          take:    parseTakeStrategy(rEntry.get('take', true) as YamlNode, file, source),
          placeAt: parseValueNode(rEntry.get('placeAt', true) as YamlNode, file, source),
          modType: String(rEntry.get('modType') ?? ''),
          span:    spanOf(file, source, rEntry),
        };
      });
    } else {
      single = {
        anchor:  parsePattern(entry.get('anchor', true) as YamlNode, file, source),
        take:    parseTakeStrategy(entry.get('take', true) as YamlNode, file, source),
        placeAt: parseValueNode(entry.get('placeAt', true) as YamlNode, file, source),
      };
      modType = String(entry.get('modType') ?? '');
    }

    installers.push({
      kind: 'installer',
      id,
      priority,
      when,
      ...(single   !== undefined && { single }),
      ...(route    !== undefined && { route }),
      ...(modType  !== undefined && { modType }),
      span: spanOf(file, source, entry),
    });
  }
}
```

Add `installers` to the returned document via conditional spread:

```ts
return {
  kind: 'document',
  gdl,
  game,
  ...(stores     !== undefined && { stores }),
  ...(context    !== undefined && { context }),
  ...(modTypes   !== undefined && { modTypes }),
  ...(installers !== undefined && { installers }),
  span: spanOf(file, source, root),
};
```

- [ ] **Step 5: Run tests**

Run: `pnpm test parser`
Expected: PASS (7 cases now).

Run: `pnpm test`
Expected: All prior tests still pass (no regression).

- [ ] **Step 6: Commit**

```bash
git add src/parser/ tests/parser.test.ts tests/fixtures/with-installer.yaml
git commit -m "Parse installer rules with !hasFile predicate"
```

---

## Task 4: Validator — installer rules

**Files:**
- Modify: `src/schema/validator.ts`
- Modify: `tests/validator.test.ts`

Semantic checks: installer id pattern, duplicate ids, `modType` references a declared modType, single XOR route, route entries also reference declared modTypes.

- [ ] **Step 1: Failing tests in `tests/validator.test.ts`**

Append inside `describe('validate')`:

```ts
  it('rejects installer with undeclared modType', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: ue4ss-lua
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL110')).toBe(true);
  });

  it('rejects duplicate installer ids', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
  - id: pak
    priority: 20
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL111')).toBe(true);
  });

  it('rejects installer that has both single form and route form', () => {
    // Not constructible from YAML easily — the parser picks one based on presence of `route:`.
    // Validate that an installer always has exactly one of `single` or `route`.
    // This case is built by hand from the AST shape rather than via YAML.
    // We test the validator handles this by mutating a parsed doc.
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`);
    // Force the bad shape:
    (doc.installers![0]! as { route?: unknown }).route = [];
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL112')).toBe(true);
  });
```

Run: `pnpm test validator`
Expected: FAIL (the three new cases).

- [ ] **Step 2: Extend `src/schema/validator.ts`**

After the existing `if (doc.stores) { ... }` block, before `return errors;`, add:

```ts
if (doc.installers) {
  const declaredModTypes = new Set((doc.modTypes ?? []).map(mt => mt.id));
  const seenIds = new Set<string>();
  for (const inst of doc.installers) {
    if (!ID_PATTERN.test(inst.id)) {
      errors.push({
        code: 'GDL113',
        message: `installer.id \`${inst.id}\` must match ${ID_PATTERN}`,
        span: inst.span,
      });
    }
    if (seenIds.has(inst.id)) {
      errors.push({
        code: 'GDL111',
        message: `duplicate installer id \`${inst.id}\``,
        span: inst.span,
      });
    }
    seenIds.add(inst.id);

    const hasSingle = inst.single !== undefined;
    const hasRoute  = inst.route  !== undefined;
    if (hasSingle === hasRoute) {
      errors.push({
        code: 'GDL112',
        message: 'installer must have exactly one of `single` (anchor/take/placeAt/modType) or `route`',
        span: inst.span,
      });
    }
    if (hasSingle) {
      const mt = inst.modType ?? '';
      if (!declaredModTypes.has(mt)) {
        errors.push({
          code: 'GDL110',
          message: `installer \`${inst.id}\` references undeclared modType \`${mt}\``,
          span: inst.span,
          hint: declaredModTypes.size
            ? `declared modTypes: ${[...declaredModTypes].join(', ')}`
            : 'no modTypes declared',
        });
      }
    }
    if (hasRoute) {
      for (const r of inst.route!) {
        if (!declaredModTypes.has(r.modType)) {
          errors.push({
            code: 'GDL110',
            message: `route entry in installer \`${inst.id}\` references undeclared modType \`${r.modType}\``,
            span: r.span,
          });
        }
      }
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test validator`
Expected: PASS (7 cases now).

Run: `pnpm test`
Expected: full suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/schema/validator.ts tests/validator.test.ts
git commit -m "Validate installer rules: ids, modType refs, single XOR route"
```

---

## Task 5: Runtime — pattern matchers (`!hasFile`/`!hasFiles`/`!matches`)

**Files:**
- Create: `src/runtime/pattern-matcher.ts`
- Create: `tests/pattern-matcher.test.ts`

Pure-function evaluator for pattern predicates against a file list.

- [ ] **Step 1: Failing tests in `tests/pattern-matcher.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { evalPredicate, type PatternPredicate } from '../src/runtime/pattern-matcher.js';

describe('evalPredicate', () => {
  it('hasFile: returns true if any path matches the glob', () => {
    const p: PatternPredicate = { kind: 'hasFile', glob: '**/*.pak' };
    expect(evalPredicate(p, ['a.pak', 'b.txt'])).toBe(true);
    expect(evalPredicate(p, ['a.txt', 'b.lua'])).toBe(false);
  });

  it('hasFiles: requires every glob to match at least one path', () => {
    const p: PatternPredicate = {
      kind: 'hasFiles',
      globs: ['**/*.pak', '**/*.lua'],
    };
    expect(evalPredicate(p, ['a.pak', 'b.lua'])).toBe(true);
    expect(evalPredicate(p, ['a.pak', 'b.txt'])).toBe(false);
  });

  it('matches: regex over paths', () => {
    const p: PatternPredicate = { kind: 'matches', regex: '^Scripts/.+\\.lua$' };
    expect(evalPredicate(p, ['Scripts/main.lua'])).toBe(true);
    expect(evalPredicate(p, ['Lib/main.lua'])).toBe(false);
  });
});
```

Run: `pnpm test pattern-matcher`
Expected: FAIL.

- [ ] **Step 2: Implement `src/runtime/pattern-matcher.ts`**

```ts
import { compileGlob, matchAny } from './glob.js';

export type PatternPredicate =
  | { kind: 'hasFile';  glob: string }
  | { kind: 'hasFiles'; globs: string[] }
  | { kind: 'matches';  regex: string };

const globCache = new Map<string, ReturnType<typeof compileGlob>>();
const cachedGlob = (g: string) => {
  let m = globCache.get(g);
  if (!m) { m = compileGlob(g); globCache.set(g, m); }
  return m;
};

const regexCache = new Map<string, RegExp>();
const cachedRegex = (r: string) => {
  let re = regexCache.get(r);
  if (!re) { re = new RegExp(r); regexCache.set(r, re); }
  return re;
};

export const evalPredicate = (
  pred: PatternPredicate,
  paths: readonly string[],
): boolean => {
  if (pred.kind === 'hasFile') {
    return matchAny(paths, cachedGlob(pred.glob));
  }
  if (pred.kind === 'hasFiles') {
    return pred.globs.every(g => matchAny(paths, cachedGlob(g)));
  }
  const re = cachedRegex(pred.regex);
  for (const p of paths) if (re.test(p)) return true;
  return false;
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test pattern-matcher`
Expected: PASS (3 cases).

- [ ] **Step 4: Commit**

```bash
git add src/runtime/pattern-matcher.ts tests/pattern-matcher.test.ts
git commit -m "Add runtime pattern predicate evaluator"
```

---

## Task 6: Runtime — predicate combinators (`!when`/`!any`/`!all`/`!not`)

**Files:**
- Create: `src/runtime/predicate.ts`
- Create: `tests/predicate.test.ts`

Pure-function evaluator for the predicate language.

- [ ] **Step 1: Failing tests in `tests/predicate.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { evalPredicateExpr, type PredicateExpr, type EvalContext } from '../src/runtime/predicate.js';

const ctx: EvalContext = {
  archivePaths: ['a.pak', 'Scripts/main.lua'],
  vars: { store: 'steam', os: 'windows', version: '1.2.3' },
};

describe('evalPredicateExpr', () => {
  it('hasFile glob true', () => {
    const p: PredicateExpr = { kind: 'hasFile', glob: '**/*.pak' };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('any: true if any arm true', () => {
    const p: PredicateExpr = {
      kind: 'any',
      arms: [
        { kind: 'hasFile', glob: '**/*.never' },
        { kind: 'hasFile', glob: '**/*.lua' },
      ],
    };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('all: false if any arm false', () => {
    const p: PredicateExpr = {
      kind: 'all',
      arms: [
        { kind: 'hasFile', glob: '**/*.pak' },
        { kind: 'hasFile', glob: '**/*.never' },
      ],
    };
    expect(evalPredicateExpr(p, ctx)).toBe(false);
  });

  it('not: negates', () => {
    const p: PredicateExpr = { kind: 'not', arm: { kind: 'hasFile', glob: '**/*.never' } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('when: ==', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: '==', left: { kind: 'ref', name: 'store' }, right: { kind: 'literal', raw: 'steam' } } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('when: in list', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: 'in', left: { kind: 'ref', name: 'os' }, right: [{ kind: 'literal', raw: 'windows' }, { kind: 'literal', raw: 'linux' }] } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('when: semver >=', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: '>=', left: { kind: 'ref', name: 'version' }, right: { kind: 'literal', raw: '1.0.0' } } };
    expect(evalPredicateExpr(p, ctx)).toBe(true);
  });

  it('throws on unbound variable', () => {
    const p: PredicateExpr = { kind: 'when', expr: { op: '==', left: { kind: 'ref', name: 'missing' }, right: { kind: 'literal', raw: 'x' } } };
    expect(() => evalPredicateExpr(p, ctx)).toThrow(/unbound/);
  });
});
```

Run: `pnpm test predicate`
Expected: FAIL.

- [ ] **Step 2: Implement `src/runtime/predicate.ts`**

```ts
import { evalPredicate, type PatternPredicate } from './pattern-matcher.js';

export type ValueRef =
  | { kind: 'literal'; raw: string | number | boolean }
  | { kind: 'ref';     name: string };

export type ComparisonExpr =
  | { op: '==' | '!=';                left: ValueRef; right: ValueRef }
  | { op: 'in';                       left: ValueRef; right: ValueRef[] }
  | { op: '>=' | '<=' | '>' | '<';    left: ValueRef; right: ValueRef };

export type PredicateExpr =
  | PatternPredicate
  | { kind: 'when'; expr: ComparisonExpr }
  | { kind: 'any';  arms: PredicateExpr[] }
  | { kind: 'all';  arms: PredicateExpr[] }
  | { kind: 'not';  arm:  PredicateExpr };

export interface EvalContext {
  archivePaths: readonly string[];
  vars: Readonly<Record<string, string | number | boolean>>;
}

const resolveRef = (ref: ValueRef, vars: EvalContext['vars']): string | number | boolean => {
  if (ref.kind === 'literal') return ref.raw;
  if (!(ref.name in vars)) throw new Error(`unbound variable \`${ref.name}\``);
  return vars[ref.name]!;
};

const cmpSemver = (a: string, b: string): number => {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
};

const evalComparison = (expr: ComparisonExpr, ctx: EvalContext): boolean => {
  const l = resolveRef(expr.left, ctx.vars);
  if (expr.op === 'in') {
    return expr.right.some(r => resolveRef(r, ctx.vars) === l);
  }
  const r = resolveRef(expr.right, ctx.vars);
  if (expr.op === '==') return l === r;
  if (expr.op === '!=') return l !== r;
  // Comparison ops use semver if both sides are strings; numeric otherwise.
  if (typeof l === 'string' && typeof r === 'string') {
    const c = cmpSemver(l, r);
    if (expr.op === '>=') return c >= 0;
    if (expr.op === '<=') return c <= 0;
    if (expr.op === '>')  return c >  0;
    return c < 0;
  }
  const lf = Number(l);
  const rf = Number(r);
  if (expr.op === '>=') return lf >= rf;
  if (expr.op === '<=') return lf <= rf;
  if (expr.op === '>')  return lf >  rf;
  return lf < rf;
};

export const evalPredicateExpr = (
  pred: PredicateExpr,
  ctx: EvalContext,
): boolean => {
  if (pred.kind === 'hasFile' || pred.kind === 'hasFiles' || pred.kind === 'matches') {
    return evalPredicate(pred, ctx.archivePaths);
  }
  if (pred.kind === 'when') return evalComparison(pred.expr, ctx);
  if (pred.kind === 'any')  return pred.arms.some(a => evalPredicateExpr(a, ctx));
  if (pred.kind === 'all')  return pred.arms.every(a => evalPredicateExpr(a, ctx));
  return !evalPredicateExpr(pred.arm, ctx);
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test predicate`
Expected: PASS (8 cases).

- [ ] **Step 4: Commit**

```bash
git add src/runtime/predicate.ts tests/predicate.test.ts
git commit -m "Add predicate combinator evaluator with semver comparisons"
```

---

## Task 7: Runtime — installer engine

**Files:**
- Create: `src/runtime/installer-engine.ts`
- Create: `tests/installer-engine.test.ts`

The heart of Plan 2. Given an installer rule (single or route) plus an archive's file list and the resolved context, produce a list of `{ source, destination, modType }` triples.

- [ ] **Step 1: Failing tests in `tests/installer-engine.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildInstallPlan, type InstallerRule } from '../src/runtime/installer-engine.js';

const ctx = { archivePaths: [] as string[], vars: { modsRoot: '/games/Hello/Mods', store: 'steam', os: 'windows' } };

describe('buildInstallPlan — single form', () => {
  it('anchor: parent, take: parent → strips paths above the parent of the anchor match', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 10,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '${modsRoot}',
      },
      modType: 'pak',
    };
    const archive = ['MyMod/CoolPak.pak', 'MyMod/Readme.md'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan).toEqual([
      { source: 'MyMod/CoolPak.pak', destination: '/games/Hello/Mods/CoolPak.pak', modType: 'pak' },
      { source: 'MyMod/Readme.md',   destination: '/games/Hello/Mods/Readme.md',   modType: 'pak' },
    ]);
  });

  it('anchor matches directory, take: self → keeps the matched dir as the install root', () => {
    const rule: InstallerRule = {
      id: 'logic-mod',
      priority: 20,
      when: { kind: 'hasFile', glob: '**/LogicMods/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/LogicMods/' },
        take: 'self',
        placeAt: '${modsRoot}',
      },
      modType: 'logic-mod',
    };
    const archive = ['MyMod/LogicMods/BPFolder/X.pak', 'MyMod/LogicMods/Y.pak', 'MyMod/Readme.md'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan).toEqual([
      { source: 'MyMod/LogicMods/BPFolder/X.pak', destination: '/games/Hello/Mods/LogicMods/BPFolder/X.pak', modType: 'logic-mod' },
      { source: 'MyMod/LogicMods/Y.pak',          destination: '/games/Hello/Mods/LogicMods/Y.pak',          modType: 'logic-mod' },
    ]);
  });

  it('parent.parent climbs two levels above the anchor match', () => {
    const rule: InstallerRule = {
      id: 'ue4ss',
      priority: 10,
      when: { kind: 'hasFile', glob: '**/Scripts/*.lua' },
      single: {
        anchor: { kind: 'glob', pattern: '**/Scripts/*.lua' },
        take: 'parent.parent',
        placeAt: '${modsRoot}',
      },
      modType: 'ue4ss-lua',
    };
    const archive = ['Outer/MyMod/Scripts/main.lua', 'Outer/MyMod/Scripts/util.lua', 'Outer/MyMod/extras.txt'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan).toEqual([
      { source: 'Outer/MyMod/Scripts/main.lua', destination: '/games/Hello/Mods/MyMod/Scripts/main.lua', modType: 'ue4ss-lua' },
      { source: 'Outer/MyMod/Scripts/util.lua', destination: '/games/Hello/Mods/MyMod/Scripts/util.lua', modType: 'ue4ss-lua' },
      { source: 'Outer/MyMod/extras.txt',       destination: '/games/Hello/Mods/MyMod/extras.txt',       modType: 'ue4ss-lua' },
    ]);
  });
});

describe('buildInstallPlan — route form', () => {
  it('routes each file via the first matching route entry', () => {
    const rule: InstallerRule = {
      id: 'composite',
      priority: 90,
      when: { kind: 'all', arms: [
        { kind: 'hasFile', glob: '**/*.pak' },
        { kind: 'hasFile', glob: '**/Scripts/*.lua' },
      ] },
      route: [
        {
          match: { kind: 'glob', pattern: '**/Scripts/*.lua' },
          anchor: { kind: 'glob', pattern: '**/Scripts/' },
          take: 'parent',
          placeAt: '${modsRoot}/lua',
          modType: 'ue4ss-lua',
        },
        {
          match: { kind: 'glob', pattern: '**/*.pak' },
          anchor: { kind: 'glob', pattern: '**/*.pak' },
          take: 'parent',
          placeAt: '${modsRoot}/paks',
          modType: 'pak',
        },
      ],
    };
    const archive = ['A/Scripts/main.lua', 'A/Cool.pak', 'A/Readme.md'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan.find(p => p.source === 'A/Scripts/main.lua')).toMatchObject({ modType: 'ue4ss-lua', destination: '/games/Hello/Mods/lua/Scripts/main.lua' });
    expect(plan.find(p => p.source === 'A/Cool.pak')).toMatchObject({ modType: 'pak',       destination: '/games/Hello/Mods/paks/Cool.pak' });
    // Files matched by no route are dropped.
    expect(plan.find(p => p.source === 'A/Readme.md')).toBeUndefined();
  });
});
```

Run: `pnpm test installer-engine`
Expected: FAIL.

- [ ] **Step 2: Implement `src/runtime/installer-engine.ts`**

```ts
import { compileGlob, findFirst } from './glob.js';
import { interpolate } from './interpolate.js';
import { evalPredicateExpr, type PredicateExpr, type EvalContext } from './predicate.js';

export type TakeStrategy = 'self' | 'parent' | 'parent.parent' | { depth: number };

export interface Pattern {
  kind: 'glob' | 'regex';
  pattern: string;
}

export interface SingleForm {
  anchor: Pattern;
  take: TakeStrategy;
  placeAt: string;          // template
}

export interface RouteEntry {
  match: Pattern;
  anchor: Pattern;
  take: TakeStrategy;
  placeAt: string;          // template
  modType: string;
}

export interface InstallerRule {
  id: string;
  priority: number;
  when: PredicateExpr;
  single?: SingleForm;
  route?: RouteEntry[];
  modType?: string;          // single only
}

export interface InstallInstruction {
  source: string;
  destination: string;
  modType: string;
}

const splitSegments = (p: string): string[] => p.split('/').filter(s => s.length > 0);
const joinSegments = (segs: readonly string[]): string => segs.join('/');

const takeOffset = (take: TakeStrategy): number =>
  take === 'self' ? 0
  : take === 'parent' ? 1
  : take === 'parent.parent' ? 2
  : take.depth;

const stripPath = (path: string, take: TakeStrategy, anchorMatch: string): string => {
  // anchorMatch is the path inside the archive that the anchor matched.
  // We compute the install-root segment count and strip that prefix from `path`.
  const anchorSegs = splitSegments(anchorMatch);
  const offset = takeOffset(take);
  // anchorSegs.length - offset = number of leading segments that form the install root.
  // E.g., anchor matches "Outer/MyMod/Scripts/main.lua" (4 segs), take=parent.parent (offset=2)
  //   → keep last 2 segs ("Scripts/main.lua").
  // Trailing-slash anchors target a directory; the segment count is segs.length itself,
  //   and take: self should keep the directory and everything below.
  const dropCount = anchorSegs.length - offset;
  const pathSegs = splitSegments(path);
  return joinSegments(pathSegs.slice(dropCount));
};

const matches = (p: Pattern, path: string): boolean => {
  if (p.kind === 'glob') return compileGlob(p.pattern)(path);
  return new RegExp(p.pattern).test(path);
};

export const buildInstallPlan = (
  rule: InstallerRule,
  archivePaths: readonly string[],
  ctx: EvalContext,
): InstallInstruction[] => {
  // First evaluate the rule's `when` predicate; if false, no plan.
  if (!evalPredicateExpr(rule.when, ctx)) return [];

  if (rule.single) {
    const matcher = compileGlob(rule.single.anchor.pattern);
    const anchorHit = findFirst(archivePaths, matcher);
    if (!anchorHit) return [];
    const destRoot = interpolate(rule.single.placeAt, ctx.vars);
    return archivePaths.map(src => ({
      source: src,
      destination: joinSegments([destRoot, stripPath(src, rule.single!.take, anchorHit)].filter(s => s.length > 0)),
      modType: rule.modType!,
    }));
  }

  // Route form: per-file routing through the first matching entry.
  const plan: InstallInstruction[] = [];
  for (const src of archivePaths) {
    for (const r of rule.route ?? []) {
      if (!matches(r.match, src)) continue;
      const matcher = compileGlob(r.anchor.pattern);
      const anchorHit = findFirst(archivePaths, matcher);
      if (!anchorHit) break;
      const destRoot = interpolate(r.placeAt, ctx.vars);
      plan.push({
        source: src,
        destination: joinSegments([destRoot, stripPath(src, r.take, anchorHit)].filter(s => s.length > 0)),
        modType: r.modType,
      });
      break;
    }
  }
  return plan;
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test installer-engine`
Expected: PASS (4 cases).

> **Note on the algorithm:** the offset model treats `take: parent` as "drop the last 1 segment of the anchor match." For directory-shaped anchors (trailing slash), the anchor matches paths *inside* the directory, so `take: self` keeps the directory name as part of the install-root segments. The unit tests pin the exact behavior; future edge cases should add tests rather than mutate the algorithm.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/installer-engine.ts tests/installer-engine.test.ts
git commit -m "Add runtime installer engine (single + route forms)"
```

---

## Task 8: Vortex shim — `registerInstaller`

**Files:**
- Modify: `src/types/vortex-api.d.ts`
- Modify: `src/runtime/vortex-shim.ts`

The shim calls Vortex's `registerInstaller(id, priority, testSupported, install)`. Each takes the archive's file list and produces either `{ supported: true, requiredFiles: [...] }` or instructions.

- [ ] **Step 1: Extend `src/types/vortex-api.d.ts`**

Add inside the `declare module 'vortex-api'` block, before the closing brace:

```ts
  export interface IInstruction {
    type: 'copy';
    source: string;
    destination: string;
  }

  export interface ITestSupported {
    supported: boolean;
    requiredFiles?: string[];
  }

  export interface IInstallResult {
    instructions: (IInstruction | { type: 'setmodtype'; value: string })[];
  }

  export type TestSupportedFn = (
    files: string[],
    gameId: string,
  ) => Promise<ITestSupported>;

  export type InstallFn = (
    files: string[],
    destinationPath: string,
    gameId: string,
  ) => Promise<IInstallResult>;
```

Then extend `IExtensionContext` to add `registerInstaller`:

```ts
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
    registerInstaller: (
      id: string,
      priority: number,
      testSupported: TestSupportedFn,
      install: InstallFn,
    ) => void;
  }
```

- [ ] **Step 2: Extend `src/runtime/vortex-shim.ts`**

Add the imports:

```ts
import type { TestSupportedFn, InstallFn } from 'vortex-api';
import type { InstallerRule } from './installer-engine.js';
import { buildInstallPlan } from './installer-engine.js';
import { evalPredicateExpr } from './predicate.js';
```

Add a parameter to `registerGame` for installers, and add a registration loop. Replace the existing `registerGame` method with:

```ts
  registerGame(
    decl: GameDecl,
    stores: StoreDecl[],
    contextSpec: ContextSpec,
    modTypes: ModTypeDecl[],
    installers: InstallerRule[],
  ) {
    const game: IGame = {
      id: decl.id,
      name: decl.name,
      executable: () => decl.executable,
      requiredFiles: decl.requiredFiles,
      ...(decl.logo          !== undefined && { logo:        decl.logo }),
      ...(decl.contributedBy !== undefined && { contributed: decl.contributedBy }),
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

    for (const inst of installers) {
      this.registerInstallerRule(decl.id, inst);
    }
  }

  private registerInstallerRule(gameId: string, rule: InstallerRule): void {
    const testSupported: TestSupportedFn = async (files, gid) => {
      if (gid !== gameId) return { supported: false };
      const ctx = {
        archivePaths: files,
        vars: this.resolvedCtx ?? {},
      };
      return { supported: evalPredicateExpr(rule.when, ctx) };
    };

    const install: InstallFn = async (files, _destinationPath, gid) => {
      const ctx = {
        archivePaths: files,
        vars: this.resolvedCtx ?? {},
      };
      if (gid !== gameId) return { instructions: [] };
      const plan = buildInstallPlan(rule, files, ctx);
      const instructions = plan.flatMap(p => [
        { type: 'copy' as const, source: p.source, destination: p.destination },
        { type: 'setmodtype' as const, value: p.modType },
      ]);
      return { instructions };
    };

    this.api.registerInstaller(rule.id, rule.priority, testSupported, install);
  }
```

> **Note on the setmodtype emission:** Vortex's installer protocol uses an interleaved instruction stream where a `setmodtype` instruction applies to subsequent `copy` instructions. The exact placement (before or after the copy it tags) and Vortex's grouping semantics will surface during the e2e test. If the corpus test in Plan 3 reveals the wrong shape, fix it here in one place.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: all existing tests still pass (no installer test runs yet — codegen comes next).

- [ ] **Step 4: Commit**

```bash
git add src/types/vortex-api.d.ts src/runtime/vortex-shim.ts
git commit -m "Wire registerInstaller through the GdlRuntime shim"
```

---

## Task 9: Codegen — emit installers

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `tests/codegen.test.ts`

Emit the installers list in `extension.ts`, passing it as the new fifth argument to `registerGame`. Each installer becomes a TS object literal that the runtime understands.

- [ ] **Step 1: Failing test addition in `tests/codegen.test.ts`**

Add a new describe block (or extend the existing one with a new test):

```ts
describe('emit installers', () => {
  const TINY_INSTALLER = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: ${'${installPath}'}/Mods
modTypes:
  - { id: pak, name: Pak Mod, path: "${'${modsRoot}'}" }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: "${'${modsRoot}'}"
    modType: pak
`;

  it('emits installer registration in extension.ts', () => {
    const doc = parseYaml(TINY_INSTALLER, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path.endsWith('extension.ts'))!;
    expect(ext.contents).toContain("id: 'pak'");
    expect(ext.contents).toContain("priority: 10");
    expect(ext.contents).toContain("kind: 'hasFile'");
    expect(ext.contents).toContain("pattern: '**/*.pak'");
    expect(ext.contents).toContain("take: 'parent'");
    expect(ext.contents).toContain("modType: 'pak'");
  });
});
```

Run: `pnpm test codegen`
Expected: FAIL (the new assertions, since installers aren't emitted yet).

- [ ] **Step 2: Extend `src/codegen/emit.ts`**

Add helpers below `renderValueNode`:

```ts
import type {
  DocumentNode, ValueNode,
  InstallerNode, PatternNode, PredicateNode, TakeStrategy,
} from '../parser/ast.js';

const renderPattern = (p: PatternNode): string =>
  `{ kind: '${p.kind}', pattern: ${sq(p.pattern)} }`;

const renderTake = (t: TakeStrategy): string => {
  if (typeof t === 'string') return sq(t);
  return `{ depth: ${t.depth} }`;
};

const renderPredicate = (p: PredicateNode): string => {
  if (p.kind === 'hasFile') return `{ kind: 'hasFile', glob: ${sq(p.pattern.pattern)} }`;
  if (p.kind === 'hasFiles') {
    const globs = p.patterns.map(pat => sq(pat.pattern)).join(', ');
    return `{ kind: 'hasFiles', globs: [${globs}] }`;
  }
  if (p.kind === 'matches') return `{ kind: 'matches', regex: ${sq(p.pattern.pattern)} }`;
  if (p.kind === 'when') return `{ kind: 'when', expr: ${renderComparison(p.expr)} }`;
  if (p.kind === 'any')  return `{ kind: 'any', arms: [${p.arms.map(renderPredicate).join(', ')}] }`;
  if (p.kind === 'all')  return `{ kind: 'all', arms: [${p.arms.map(renderPredicate).join(', ')}] }`;
  return `{ kind: 'not', arm: ${renderPredicate(p.arm)} }`;
};

const renderRef = (r: { kind: 'literal'; raw: string | number | boolean } | { kind: 'ref'; name: string }): string => {
  if (r.kind === 'literal') return `{ kind: 'literal', raw: ${JSON.stringify(r.raw)} }`;
  return `{ kind: 'ref', name: ${sq(r.name)} }`;
};

const renderComparison = (e: import('../parser/ast.js').ComparisonExpr): string => {
  if (e.op === 'in') {
    return `{ op: 'in', left: ${renderRef(e.left)}, right: [${e.right.map(renderRef).join(', ')}] }`;
  }
  return `{ op: ${sq(e.op)}, left: ${renderRef(e.left)}, right: ${renderRef(e.right)} }`;
};

const renderPlaceAt = (v: ValueNode): string => {
  if (v.kind === 'literal')      return sq(String(v.raw));
  if (v.kind === 'interpolated') return sq(v.template);
  throw new Error(`unsupported placeAt kind \`${v.kind}\` — lift branch/hook values into a context: binding and reference the binding`);
};

const renderInstaller = (inst: InstallerNode): string => {
  const parts: string[] = [
    `id: ${sq(inst.id)}`,
    `priority: ${inst.priority}`,
    `when: ${renderPredicate(inst.when)}`,
  ];
  if (inst.single) {
    parts.push(`single: { anchor: ${renderPattern(inst.single.anchor)}, take: ${renderTake(inst.single.take)}, placeAt: ${renderPlaceAt(inst.single.placeAt)} }`);
    parts.push(`modType: ${sq(inst.modType ?? '')}`);
  } else if (inst.route) {
    const routeStr = inst.route.map(r =>
      `{ match: ${renderPattern(r.match)}, anchor: ${renderPattern(r.anchor)}, take: ${renderTake(r.take)}, placeAt: ${renderPlaceAt(r.placeAt)}, modType: ${sq(r.modType)} }`
    ).join(', ');
    parts.push(`route: [${routeStr}]`);
  }
  return `{ ${parts.join(', ')} }`;
};
```

> **Note on placeAt's value kinds:** `renderPlaceAt` only accepts literal and interpolated strings. Branches and hookRefs in `placeAt` throw at codegen time with a clear migration hint (lift into `context:`). Real-world YAML almost always uses an interpolated string for `placeAt` (with branches handled at the context level), so this restriction matches actual usage. Lifting branches into context: is also the cleaner pattern for the language overall.

Modify the `emit` function: add the installers rendering and pass them as a fifth argument to `runtime.registerGame`:

```ts
  const installers = (doc.installers ?? [])
    .map(inst => `      ${renderInstaller(inst)}`)
    .join(',\n');
```

Update the emitted `extension.ts` template's `registerGame` call to include the installers array (after the modTypes array):

```ts
  runtime.registerGame(
    { /* game decl */ },
    [ /* stores */ ],
    { bindings: [ /* context */ ] },
    [ /* modTypes */ ],
    [
${installers}
    ],
  );
```

- [ ] **Step 3: Run tests**

Run: `pnpm test codegen`
Expected: PASS (all assertions including the new installer ones).

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/codegen/emit.ts tests/codegen.test.ts
git commit -m "Emit installer rules in generated extension.ts"
```

---

## Task 10: End-to-end checkpoint — installer through the pipeline

**Files:**
- Modify: `tests/fixtures/e2e/game.yaml`
- Modify: `tests/e2e.test.ts`

Verify the full pipeline now produces a bundle containing the installer rule. The bundle won't *run* an installer yet (we'd need to actually load it into Vortex), but the bundle should contain the right code.

- [ ] **Step 1: Update the e2e fixture**

Replace `tests/fixtures/e2e/game.yaml` with:

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
  - { id: pak, name: Pak Mod, path: "${paksRoot}" }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: "${paksRoot}"
    modType: pak
```

- [ ] **Step 2: Extend the e2e test**

In `tests/e2e.test.ts`, after the existing assertions, add:

```ts
    expect(bundle).toMatch(/registerInstaller/);
    expect(bundle).toMatch(/'pak'/);            // installer id
    expect(bundle).toMatch(/\*\*\/\*\.pak/);   // the glob made it through
```

- [ ] **Step 3: Run the e2e test**

Run: `pnpm test e2e`
Expected: PASS (with the bundle now showing installer wiring).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/e2e/game.yaml tests/e2e.test.ts
git commit -m "E2E: extend fixture with installer rule"
```

---

## Task 11: Parser — `!hook` and `discovery:` block

**Files:**
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`
- Create: `tests/fixtures/with-hook.yaml`

Hooks let the YAML reference TS functions. The MVP+Plan 2 catalog has one hook: `detectGameVersion`, declared under `discovery.version`. A hook reference parses to a `HookRefNode` with the hook id.

- [ ] **Step 1: Create `tests/fixtures/with-hook.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
discovery:
  version: !hook detectGameVersion
```

- [ ] **Step 2: Failing test**

Append inside `describe('parseYaml')`:

```ts
  it('parses discovery.version hook reference', () => {
    const doc = parseYaml(fixture('with-hook.yaml'), 'with-hook.yaml');
    expect(doc.discovery).toBeDefined();
    expect(doc.discovery!.version).toMatchObject({ kind: 'hookRef', hookId: 'detectGameVersion' });
  });
```

Run: `pnpm test parser`
Expected: FAIL — `doc.discovery` undefined.

- [ ] **Step 3: Extend the parser**

In `src/parser/index.ts`, add a helper:

```ts
const parseHookRef = (node: YamlNode | null | undefined, file: string, source: string): HookRefNode => {
  if (isScalar(node) && (node as { tag?: unknown }).tag === HOOK_TAG && typeof node.value === 'string') {
    return { kind: 'hookRef', hookId: node.value, span: spanOf(file, source, node) };
  }
  throw new BuildErrors([{
    code: 'GDL060',
    message: 'expected `!hook <id>` reference',
    span: spanOf(file, source, node ?? null),
  }]);
};
```

After the installers block, parse discovery:

```ts
const discoveryYaml = root.get('discovery', true);
let discovery: DiscoveryNode | undefined;
if (isMap(discoveryYaml)) {
  const versionYaml = discoveryYaml.get('version', true);
  if (versionYaml) {
    const version = parseHookRef(versionYaml as YamlNode, file, source);
    discovery = { kind: 'discovery', version, span: spanOf(file, source, discoveryYaml) };
  } else {
    discovery = { kind: 'discovery', span: spanOf(file, source, discoveryYaml) };
  }
}
```

Add to the return literal:

```ts
...(discovery !== undefined && { discovery }),
```

Also extend `parseValueNode` to recognize `!hook` scalars (for completeness — hooks can appear in `context:` values too in future, but discovery.version is the only catalog entry today):

Add to `parseValueNode` (before the scalar literal/interpolated check):

```ts
if (isScalar(node) && (node as { tag?: unknown }).tag === HOOK_TAG && typeof node.value === 'string') {
  return { kind: 'hookRef', hookId: node.value, span };
}
```

- [ ] **Step 4: Extend `renderValueNode` in `src/codegen/emit.ts` to keep the `ValueNode` union exhaustive**

Adding `hookRef` to the `ValueNode` AST (Task 2) and parsing it (above) makes the union wider. The existing `renderValueNode` from Plan 1 narrows to branch tags after the literal/interpolated early-returns and accesses `.arms` — which doesn't exist on `hookRef`. Without a handler, TypeScript's exhaustiveness checking fails the build.

Add a hookRef early-return to `renderValueNode` (just after the interpolated check, before the branch handling):

```ts
const renderValueNode = (v: ValueNode): string => {
  if (v.kind === 'literal') {
    return `{ kind: 'literal', raw: ${JSON.stringify(v.raw)} }`;
  }
  if (v.kind === 'interpolated') {
    return `{ kind: 'interpolated', template: ${JSON.stringify(v.template)} }`;
  }
  if (v.kind === 'hookRef') {
    // hookRefs only appear in discovery.version today; they are emitted via the
    // discovery wiring in Task 14, not via renderValueNode. If we ever see one here
    // (e.g., a future `context:` binding using !hook), fail loud so the schema gap is visible.
    throw new Error(`hookRef value (${v.hookId}) is not allowed in this position — only \`discovery.version\` accepts !hook in Plan 2`);
  }
  // Branch tag.
  const arms = Object.entries(v.arms)
    .map(([k, arm]) => `${JSON.stringify(k)}: ${renderValueNode(arm)}`)
    .join(', ');
  return `{ kind: ${JSON.stringify(v.kind)}, arms: { ${arms} }, default: ${renderValueNode(v.default)} }`;
};
```

- [ ] **Step 5: Run tests**

Run: `pnpm test parser && pnpm typecheck`
Expected: PASS. Typecheck must be clean (this is the step that catches the exhaustiveness break).

- [ ] **Step 6: Commit**

```bash
git add src/parser/ src/codegen/emit.ts tests/parser.test.ts tests/fixtures/with-hook.yaml
git commit -m "Parse discovery block with !hook detectGameVersion"
```

---

## Task 12: Hook catalog + resolver (TypeScript compiler API)

**Files:**
- Create: `src/schema/hook-catalog.ts`
- Create: `src/codegen/hook-resolver.ts`
- Create: `tests/hook-resolver.test.ts`

The catalog declares each hook ID and its expected TS signature. The resolver uses the TypeScript compiler API to find the export in `src/hooks.ts` and compare signatures.

- [ ] **Step 1: Create `src/schema/hook-catalog.ts`**

```ts
// Each entry declares the hook id and the exact TS signature the user's src/hooks.ts must export.
export interface HookCatalogEntry {
  id: string;
  // Human-readable expected signature for error messages.
  expectedSignature: string;
  // Names of the parameter types and return type — used for structural matching by hook-resolver.
  parameterTypes: string[];
  returnType: string;
}

export const HOOK_CATALOG: HookCatalogEntry[] = [
  {
    id: 'detectGameVersion',
    expectedSignature: '(ctx: GameContext) => Promise<string | null>',
    parameterTypes: ['GameContext'],
    returnType: 'Promise<string | null>',
  },
];

export const findHook = (id: string): HookCatalogEntry | undefined =>
  HOOK_CATALOG.find(h => h.id === id);
```

- [ ] **Step 2: Failing tests in `tests/hook-resolver.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHooks } from '../src/codegen/hook-resolver.js';

describe('resolveHooks', () => {
  it('returns OK when src/hooks.ts exports the expected hook with matching signature', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'hooks.ts'), `
import type { GameContext } from '@gdl/runtime';
export const detectGameVersion = async (ctx: GameContext): Promise<string | null> => {
  return '1.0.0';
};
`);
    const errors = await resolveHooks(dir, ['detectGameVersion']);
    expect(errors).toEqual([]);
  });

  it('returns an error when the hook export is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'hooks.ts'), `export const somethingElse = 1;`);
    const errors = await resolveHooks(dir, ['detectGameVersion']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('GDL070');
  });

  it('returns an error when src/hooks.ts does not exist but hooks are referenced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    const errors = await resolveHooks(dir, ['detectGameVersion']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('GDL071');
  });

  it('returns no errors when no hooks are referenced even without src/hooks.ts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-hook-'));
    const errors = await resolveHooks(dir, []);
    expect(errors).toEqual([]);
  });
});
```

Run: `pnpm test hook-resolver`
Expected: FAIL.

- [ ] **Step 3: Implement `src/codegen/hook-resolver.ts`**

```ts
import ts from 'typescript';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildError } from '../errors.js';
import { findHook } from '../schema/hook-catalog.js';

export const resolveHooks = async (cwd: string, referencedHookIds: string[]): Promise<BuildError[]> => {
  if (referencedHookIds.length === 0) return [];

  const hooksPath = join(cwd, 'src', 'hooks.ts');
  const span = { file: hooksPath, line: 1, column: 1, offset: 0, length: 0 };

  if (!existsSync(hooksPath)) {
    return [{
      code: 'GDL071',
      message: `\`src/hooks.ts\` is required because the YAML references hook(s): ${referencedHookIds.join(', ')}`,
      span,
    }];
  }

  // Use the TypeScript compiler API to introspect the file.
  const program = ts.createProgram({
    rootNames: [hooksPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(hooksPath);
  if (!source) {
    return [{
      code: 'GDL072',
      message: `could not load \`src/hooks.ts\``,
      span,
    }];
  }

  const exportedNames = new Set<string>();
  ts.forEachChild(source, (node) => {
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exportedNames.add(decl.name.text);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && node.name) {
      exportedNames.add(node.name.text);
    }
  });

  void checker; // Reserved for signature comparison in a future iteration; structural-only for MVP+Plan 2.

  const errors: BuildError[] = [];
  for (const id of referencedHookIds) {
    const entry = findHook(id);
    if (!entry) {
      errors.push({
        code: 'GDL073',
        message: `hook \`${id}\` is not in the GDL hook catalog`,
        span,
        hint: 'check spelling, or this hook id requires a newer GDL version',
      });
      continue;
    }
    if (!exportedNames.has(id)) {
      errors.push({
        code: 'GDL070',
        message: `\`src/hooks.ts\` does not export \`${id}\``,
        span,
        hint: `expected signature: ${entry.expectedSignature}`,
      });
    }
  }
  return errors;
};
```

> **Note on signature checking:** the MVP+Plan 2 resolver verifies that the named export *exists*. Full signature matching via `checker.getTypeOfSymbolAtLocation()` and structural compatibility is a follow-up. Existence checking already catches the common error (missing hook) and shapes the error UX. Type-mismatch errors will surface at webpack bundle time via `ts-loader` (with transpileOnly off for `src/hooks.ts`).

- [ ] **Step 4: Run tests**

Run: `pnpm test hook-resolver`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/schema/hook-catalog.ts src/codegen/hook-resolver.ts tests/hook-resolver.test.ts
git commit -m "Add hook catalog and hook-export resolver via TS compiler API"
```

---

## Task 13: Wire hook resolution into the build command

**Files:**
- Modify: `src/commands/build.ts`

After parse+validate, walk the document to collect referenced hook IDs, then call `resolveHooks`. Any errors are added to the BuildErrors stream and fail the build.

- [ ] **Step 1: Extend `src/commands/build.ts`**

Add imports:

```ts
import { resolveHooks } from '../codegen/hook-resolver.js';
import type { DocumentNode, HookRefNode, ValueNode } from '../parser/ast.js';
```

Add a small AST walker to collect hook references:

```ts
const collectHookIds = (doc: DocumentNode): string[] => {
  const ids = new Set<string>();
  const visitValue = (v: ValueNode): void => {
    if (v.kind === 'hookRef') ids.add(v.hookId);
    if (v.kind === 'storeBranch' || v.kind === 'osBranch' || v.kind === 'versionBranch') {
      for (const arm of Object.values(v.arms)) visitValue(arm);
      visitValue(v.default);
    }
  };
  if (doc.discovery?.version) ids.add(doc.discovery.version.hookId);
  for (const b of doc.context?.bindings ?? []) visitValue(b.value);
  for (const mt of doc.modTypes ?? []) visitValue(mt.path);
  return [...ids];
};
```

Modify `buildExtension` to call `resolveHooks` between validate and emit. The relevant section becomes:

```ts
  const errors = validate(doc);
  if (errors.length) throw new BuildErrors(errors);

  const hookErrors = await resolveHooks(args.cwd, collectHookIds(doc));
  if (hookErrors.length) throw new BuildErrors(hookErrors);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: existing tests all pass; e2e still passes (no hooks referenced in that fixture).

- [ ] **Step 3: Commit**

```bash
git add src/commands/build.ts
git commit -m "Resolve hooks during build (fail closed when src/hooks.ts is missing)"
```

---

## Task 14: Codegen — emit hook imports and discovery wiring

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `src/runtime/vortex-shim.ts`

Generated code needs to `import { detectGameVersion } from '../src/hooks.js'` (when used) and pass it to the runtime for version detection. The shim grows a way to call the hook during discovery.

- [ ] **Step 1: Extend the emit function**

In `src/codegen/emit.ts`, after rendering installers but before constructing the extension template, gather hook references:

```ts
const hookIds = new Set<string>();
if (doc.discovery?.version) hookIds.add(doc.discovery.version.hookId);
// (extend if other hook sites appear later)
const hookImports = hookIds.size
  ? `import * as hooks from '../src/hooks.js';`
  : '';

const versionHook = doc.discovery?.version
  ? `hooks.${doc.discovery.version.hookId}`
  : 'undefined';
```

Update the emitted extension to include hook imports and pass the version hook to the runtime. The `registerGame` call grows a sixth parameter:

```ts
const extension = `${banner(doc.game.span.file)}
import { GdlRuntime } from '@gdl/runtime';
import type { IExtensionContext } from 'vortex-api';
${hookImports}

export default function main(api: IExtensionContext): boolean {
  const runtime = new GdlRuntime(api);
  runtime.registerGame(
    { /* game decl */ },
    [ /* stores */ ],
    { bindings: [ /* context */ ] },
    [ /* modTypes */ ],
    [
${installers}
    ],
    {
      versionHook: ${versionHook},
    },
  );
  return true;
}
`;
```

> **Note on file paths:** `hooks.ts` lives in the extension repo at `src/hooks.ts`. The generated code lives in `.gdl-out/extension.ts`. The relative import is `../src/hooks.js` (because compiled output uses `.js` per NodeNext). Webpack + ts-loader will resolve `.js` → `.ts` via the existing `extensionAlias` config.

- [ ] **Step 2: Extend `src/runtime/vortex-shim.ts` to accept the version hook**

Add a sixth parameter to `registerGame`:

```ts
  registerGame(
    decl: GameDecl,
    stores: StoreDecl[],
    contextSpec: ContextSpec,
    modTypes: ModTypeDecl[],
    installers: InstallerRule[],
    discovery?: { versionHook?: (ctx: DiscoveryFacts) => Promise<string | null> },
  ) {
```

Inside `queryPath`, after computing `facts`, run the version hook if present:

```ts
      queryPath: async () => {
        const facts = await this.discover(stores);
        if (!facts) return '';
        if (discovery?.versionHook) {
          try {
            const v = await discovery.versionHook(facts);
            if (v) (facts as { version?: string }).version = v;
          } catch {
            // Version detection failure is non-fatal — log via vortex-api if needed; resolver
            // simply omits `version` from the resolved context, and !versionBranch falls through
            // to `default`.
          }
        }
        this.resolvedCtx = resolveContext(contextSpec, facts);
        return { path: facts.installPath, store: facts.store };
      },
```

- [ ] **Step 3: Failing test for hook emission in `tests/codegen.test.ts`**

Add a new test that exercises the hook path:

```ts
describe('emit hooks', () => {
  const HOOKED = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
discovery:
  version: !hook detectGameVersion
`;

  it('emits hook import and passes version hook to registerGame', () => {
    const doc = parseYaml(HOOKED, 'hooked.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path.endsWith('extension.ts'))!;
    expect(ext.contents).toContain(`import * as hooks from '../src/hooks.js'`);
    expect(ext.contents).toContain(`versionHook: hooks.detectGameVersion`);
  });
});
```

Run: `pnpm test codegen`
Expected: PASS (with the new test).

- [ ] **Step 4: Typecheck and full test**

Run: `pnpm typecheck && pnpm test`
Expected: PASS across all suites.

- [ ] **Step 5: Commit**

```bash
git add src/codegen/emit.ts src/runtime/vortex-shim.ts tests/codegen.test.ts
git commit -m "Emit hook imports and wire version detection through the shim"
```

---

## Task 15: Real discovery via `GameStoreHelper`

**Files:**
- Modify: `src/types/vortex-api.d.ts`
- Modify: `src/runtime/vortex-shim.ts`

Replace the `discover()` stub with a real implementation that iterates declared stores and asks Vortex's `GameStoreHelper` to find the install.

- [ ] **Step 1: Extend `src/types/vortex-api.d.ts`**

Inside the `declare module 'vortex-api'` block, add the helper types:

```ts
  export interface IFoundGame {
    gamePath: string;
    gameStoreId: string;
  }

  export const GameStoreHelper: {
    findByAppId(appId: string | string[], storeId?: string): Promise<IFoundGame | null>;
  };

  export const log: (level: string, message: string, meta?: unknown) => void;
```

> **Note:** the real `vortex-api`'s `GameStoreHelper.findByAppId` may take a slightly different shape. If the e2e bundle fails to load in Vortex (Task 17), adjust the d.ts to match what `vortex-api` actually exports.

- [ ] **Step 2: Update the `discover()` method in `src/runtime/vortex-shim.ts`**

Replace the stubbed `discover` with:

```ts
  private async discover(stores: StoreDecl[]): Promise<DiscoveryFacts | null> {
    const { GameStoreHelper } = await import('vortex-api');
    for (const s of stores) {
      const appId = String(s.value);
      try {
        const found = await GameStoreHelper.findByAppId(appId, s.id);
        if (found) {
          return {
            store: found.gameStoreId,
            os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
            arch: process.arch === 'arm64' ? 'arm64' : 'x64',
            installPath: found.gamePath,
            executablePath: found.gamePath,   // refined by Vortex later via game.executable()
          };
        }
      } catch {
        // Helper threw — try the next store.
      }
    }
    return null;
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: all suites pass (the e2e test doesn't actually run discovery — it just checks the bundle contains the right code).

- [ ] **Step 4: Commit**

```bash
git add src/types/vortex-api.d.ts src/runtime/vortex-shim.ts
git commit -m "Wire GameStoreHelper-based discovery through the shim"
```

---

## Task 16: Source maps — YAML → generated TS

**Files:**
- Create: `src/codegen/source-map.ts`
- Modify: `src/codegen/emit.ts`
- Create: `tests/source-map.test.ts`

Emit a `.map` file next to each generated `.ts` that maps generated line ranges back to YAML positions. Webpack chains this through the bundle's source map.

- [ ] **Step 1: Create `src/codegen/source-map.ts`**

```ts
// We emit a basic Source Map v3 — only lines, no columns precision — pointing at the YAML.
// This is enough for stack traces from inside an installer rule to land near the right YAML line.

export interface SourceMap {
  version: 3;
  file: string;
  sourceRoot: '';
  sources: [string];     // single source: the YAML
  names: [];
  mappings: string;      // VLQ-encoded
}

// VLQ-encode a single signed integer.
const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_SHIFT = 5;
const VLQ_MASK  = (1 << VLQ_SHIFT) - 1;
const VLQ_CONT  = 1 << VLQ_SHIFT;

const encode = (n: number): string => {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let s = '';
  do {
    let digit = v & VLQ_MASK;
    v >>>= VLQ_SHIFT;
    if (v > 0) digit |= VLQ_CONT;
    s += VLQ_CHARS[digit]!;
  } while (v > 0);
  return s;
};

export interface LineMapping {
  generatedLine: number;     // 1-based
  yamlLine: number;          // 1-based
  yamlColumn: number;        // 1-based
}

export const buildSourceMap = (
  generatedTsFileName: string,
  yamlFileName: string,
  lineMappings: LineMapping[],
): SourceMap => {
  // Source Map v3 mappings are organised by generated-line, semicolon-separated.
  // Each segment within a line is comma-separated and VLQ-encoded as 5 ints:
  //   [genCol, sourceIdx, srcLine, srcCol, nameIdx?]
  // genCol and sourceIdx are deltas relative to the previous segment.

  const byGenLine = new Map<number, LineMapping[]>();
  for (const m of lineMappings) {
    const arr = byGenLine.get(m.generatedLine) ?? [];
    arr.push(m);
    byGenLine.set(m.generatedLine, arr);
  }

  const maxLine = Math.max(0, ...byGenLine.keys());
  const lines: string[] = [];
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  for (let gl = 1; gl <= maxLine; gl++) {
    const segs = byGenLine.get(gl) ?? [];
    if (segs.length === 0) { lines.push(''); continue; }
    const parts: string[] = [];
    let prevGenCol = 0;
    for (const m of segs) {
      const genCol = 0;
      const sourceIdx = 0;
      const srcLine = m.yamlLine - 1;
      const srcCol = m.yamlColumn - 1;
      parts.push(
        encode(genCol - prevGenCol) +
        encode(sourceIdx) +
        encode(srcLine - prevSrcLine) +
        encode(srcCol - prevSrcCol),
      );
      prevGenCol = genCol;
      prevSrcLine = srcLine;
      prevSrcCol = srcCol;
    }
    lines.push(parts.join(','));
  }

  return {
    version: 3,
    file: generatedTsFileName,
    sourceRoot: '',
    sources: [yamlFileName],
    names: [],
    mappings: lines.join(';'),
  };
};
```

- [ ] **Step 2: Failing test in `tests/source-map.test.ts`**

```ts
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
    // Mappings has at least 8 semicolons (1 per generated line up to line 8).
    expect(sm.mappings.split(';').length).toBeGreaterThanOrEqual(8);
  });
});
```

Run: `pnpm test source-map`
Expected: FAIL.

- [ ] **Step 3: Run after implementation**

Run: `pnpm test source-map`
Expected: PASS.

- [ ] **Step 4: Wire emission of `.map` files in `src/codegen/emit.ts`**

Add a `lineMappings: LineMapping[]` to the emit function's local state. Each major AST node's emitted block records the YAML line/column it came from. For Plan 2, mappings are coarse — one mapping per installer rule and per modType — since the engine's runtime errors will trace to those.

Extend `emit()` to collect mappings as it builds the extension string. After the extension string is built, call `buildSourceMap` and return `{ path: 'extension.ts.map', contents: JSON.stringify(map) }` as an additional emitted file.

Append a `//# sourceMappingURL=extension.ts.map` line to the bottom of the emitted `extension.ts`.

Concrete snippet to add at the end of the extension template construction:

```ts
  const map = buildSourceMap('extension.ts', doc.game.span.file, [
    { generatedLine: 1, yamlLine: doc.game.span.line, yamlColumn: doc.game.span.column },
    ...(doc.installers ?? []).map((inst, i) => ({
      generatedLine: 6 + i,            // approximate — the installer block starts after a fixed prelude
      yamlLine: inst.span.line,
      yamlColumn: inst.span.column,
    })),
  ]);

  const extensionWithMapRef = extension + `\n//# sourceMappingURL=extension.ts.map\n`;

  return [
    { path: 'extension.ts',     contents: extensionWithMapRef },
    { path: 'extension.ts.map', contents: JSON.stringify(map) },
    { path: 'info.json',        contents: info },
  ];
```

> **Note on precision:** the generatedLine numbers are approximate because the emitted TS is built from string templates and we don't track line numbers precisely during emission. For Plan 2 a coarse mapping (each installer points to its YAML rule) is enough to make stack traces useful. A future refactor can build the extension via an AST/printer to get exact mappings.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all suites pass; the codegen test's filesystem check (Task 12 from Plan 1) now also writes `extension.ts.map`. If a test asserts an exact file count, update it to expect the map file.

- [ ] **Step 6: Commit**

```bash
git add src/codegen/source-map.ts src/codegen/emit.ts tests/source-map.test.ts
git commit -m "Emit source maps from generated TS back to YAML positions"
```

---

## Task 17: Webpack — chain source maps through the bundle

**Files:**
- Modify: `src/bundler/webpack.config.ts`

Enable webpack's devtool so the bundle picks up the `.gdl-out/extension.ts.map` and merges it into a single `dist/extension.js.map`.

- [ ] **Step 1: Update `src/bundler/webpack.config.ts`**

Add `devtool: 'source-map'` to the config:

```ts
export const buildConfig = (cwd: string): Configuration => ({
  mode: 'production',
  devtool: 'source-map',
  entry: join(cwd, '.gdl-out', 'extension.ts'),
  // ... rest unchanged ...
});
```

- [ ] **Step 2: Update the bundler test in `tests/bundler.test.ts` to expect a `.map` file**

After the existing assertions, add:

```ts
    expect(existsSync(join(dir, 'dist', 'extension.js.map'))).toBe(true);
```

- [ ] **Step 3: Run tests**

Run: `pnpm test bundler && pnpm test e2e`
Expected: PASS — `extension.js.map` exists alongside the bundle.

Run: `pnpm test`
Expected: full suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/bundler/webpack.config.ts tests/bundler.test.ts
git commit -m "Enable webpack source maps so bundle traces back to YAML"
```

---

## Task 18: Final E2E — subnautica2-shaped fixture

**Files:**
- Create: `tests/fixtures/subnautica2-shaped/game.yaml`
- Create: `tests/fixtures/subnautica2-shaped/package.json`
- Create: `tests/fixtures/subnautica2-shaped/src/hooks.ts`
- Modify: `tests/e2e.test.ts`

A fixture that mirrors subnautica2's actual shape: three mod types (pak/logic-mod/ue4ss-lua), three installers, store branches, version hook. Not a real port — just shape-equivalent.

- [ ] **Step 1: Create `tests/fixtures/subnautica2-shaped/game.yaml`**

```yaml
gdl: 1
game:
  id: subnautica2-shaped
  name: Subnautica 2 (Shape Test)
  executable: SubnauticaZero.exe
  requiredFiles: [SubnauticaZero.exe]

stores:
  steam: 264710
  epic:  Subnautica2
  xbox:  Unknown.Subnautica2

context:
  paksRoot: !storeBranch
    xbox:    ${installPath}/Content/Paks/~mods
    default: ${installPath}/SubnauticaZero/Content/Paks/~mods
  logicModsRoot: ${installPath}/SubnauticaZero/Content/Paks/LogicMods
  ue4ssModsRoot: ${installPath}/SubnauticaZero/Binaries/Win64/Mods

modTypes:
  - { id: pak,        name: Pak Mod,       path: "${paksRoot}" }
  - { id: logic-mod,  name: LogicMod,      path: "${logicModsRoot}" }
  - { id: ue4ss-lua,  name: UE4SS Lua Mod, path: "${ue4ssModsRoot}" }

installers:
  - id: ue4ss-lua
    priority: 10
    when:    !hasFile "**/Scripts/*.lua"
    anchor:  "**/Scripts/"
    take:    parent
    placeAt: "${ue4ssModsRoot}"
    modType: ue4ss-lua

  - id: logic-mod
    priority: 20
    when:    !hasFile "**/LogicMods/**/*.pak"
    anchor:  "**/LogicMods/"
    take:    self
    placeAt: "${logicModsRoot}"
    modType: logic-mod

  - id: pak
    priority: 30
    when:    !hasFile "**/*.pak"
    anchor:  "**/*.pak"
    take:    parent
    placeAt: "${paksRoot}"
    modType: pak

  - id: composite-mod
    priority: 99
    when: !all
      - !hasFile "**/*.pak"
      - !hasFile "**/Scripts/*.lua"
    route:
      - match:   "**/Scripts/*.lua"
        anchor:  "**/Scripts/"
        take:    parent
        placeAt: "${ue4ssModsRoot}"
        modType: ue4ss-lua
      - match:   "**/*.pak"
        anchor:  "**/*.pak"
        take:    parent
        placeAt: "${paksRoot}"
        modType: pak

discovery:
  version: !hook detectGameVersion
```

- [ ] **Step 2: Create `tests/fixtures/subnautica2-shaped/package.json`**

```json
{
  "name": "game-subnautica2-shaped",
  "version": "0.0.1",
  "private": true
}
```

- [ ] **Step 3: Create `tests/fixtures/subnautica2-shaped/src/hooks.ts`**

```ts
import type { GameContext } from '@gdl/runtime';

export const detectGameVersion = async (_ctx: GameContext): Promise<string | null> => {
  // Test stub — real implementation would parse the game exe.
  return '1.0.0';
};
```

> **Note:** `GameContext` should be re-exported from the runtime barrel. If it's not yet exported under that name, alias `DiscoveryFacts` as `GameContext` in `src/runtime/index.ts`:

In `src/runtime/index.ts`, add:

```ts
export type { DiscoveryFacts as GameContext } from './context-resolver.js';
```

- [ ] **Step 4: Failing e2e test in `tests/e2e.test.ts`**

Add a second test (or new file `tests/e2e-subnautica2.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExtension } from '../src/commands/build.js';

describe('end-to-end (subnautica2-shaped)', () => {
  it('builds a subnautica2-shaped extension', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-sub2-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'subnautica2-shaped'), work, { recursive: true });

    await buildExtension({ cwd: work });

    expect(existsSync(join(work, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'extension.js.map'))).toBe(true);
    expect(existsSync(join(work, 'dist', 'info.json'))).toBe(true);

    const bundle = readFileSync(join(work, 'dist', 'extension.js'), 'utf8');
    expect(bundle).toMatch(/registerInstaller/);
    expect(bundle).toMatch(/'ue4ss-lua'/);
    expect(bundle).toMatch(/'logic-mod'/);
    expect(bundle).toMatch(/'composite-mod'/);
    expect(bundle).toMatch(/detectGameVersion/);
  }, 90000);
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm test e2e`
Expected: PASS (within 90s).

If the test fails, debug the specific failure — most likely candidates:
- A pattern parse error (check the fixture's YAML carefully)
- A hook-resolver path issue (check `src/hooks.ts` location)
- A webpack alias issue (the alias must resolve `@gdl/runtime` to the source)
- A modType validation error (each installer's modType must be declared)

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/ tests/e2e.test.ts src/runtime/index.ts
git commit -m "E2E: subnautica2-shaped fixture covers all installer features"
```

---

## Task 19: Polish — bundler tsconfig and runtime barrel

**Files:**
- Modify: `src/bundler/tsconfig.bundle.json`
- Modify: `src/runtime/index.ts`

Two small cleanups identified during Plan 1's final review that affect Plan 2.

- [ ] **Step 1: Align `tsconfig.bundle.json` strictness**

The MVP added a separate bundler tsconfig to avoid ts-loader's `TS18002` when bundling extensions. Make it match the project's strictness:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": false,
    "noEmit": true
  }
}
```

- [ ] **Step 2: Export `GameContext` and other public types from the runtime barrel**

Update `src/runtime/index.ts` to ensure the runtime presents a clean public API. Make sure these are exported (some may already be):

```ts
export * from './context-resolver.js';
export * from './interpolate.js';
export * from './branch-tags.js';
export * from './vortex-shim.js';
export * from './glob.js';
export * from './pattern-matcher.js';
export * from './predicate.js';
export * from './installer-engine.js';

// Public type alias for hook authors.
export type { DiscoveryFacts as GameContext } from './context-resolver.js';
```

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/bundler/tsconfig.bundle.json src/runtime/index.ts
git commit -m "Polish: align bundler tsconfig strictness; expose GameContext"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` — all suites pass (estimated 35+ tests across 11 suites by end of plan)
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm build` — produces dist/cli.js + runtime + bundler artifacts
- [ ] `node dist/cli.js build` against the subnautica2-shaped fixture produces a valid `dist/extension.js`, `dist/extension.js.map`, `dist/info.json`
- [ ] Hook validation: deleting `src/hooks.ts` from a fixture that needs it produces a `GDL071` error pointing at the missing file
- [ ] Installer pattern matching: a fixture archive with `MyMod/Scripts/main.lua` routes through the ue4ss-lua installer
- [ ] All 19 Plan 2 tasks committed in order; commit log readable

---

## What this plan does not deliver (and where it goes)

- **`tests.cases:` block emission to Vitest, corpus runs, Nexus client** → Plan 3.
- **`gdl package`, `gdl publish`, `gdl init`, GH Actions workflow templates** → Plan 4.
- **Real `game-subnautica2` port + diff against the legacy bundle** → Plan 5.
- **Tools (`tools:`), load order (`loadOrder:`), prelaunch (`prelaunch:`), diagnostics (`diagnostics:`)** → Plan 3 or later, as needed by ported games.
- **Full structural signature matching for hooks** (currently we only verify the export exists) → Plan 3 or revisit if a real bug surfaces.
- **`renderInstaller`'s branch-tag fallthrough in `placeAt`** — currently emits `'undefined'`. If a fixture exercises it, extend `renderInstaller`. Out of scope today.
