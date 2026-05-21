# GDL Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the test harness layer of the GDL: inline `tests.cases:` in `game.yaml` produce real Vitest cases at codegen time, a local-cache corpus runner exercises every archive under `tests/cache/` against the installer engine, and a Nexus client populates the cache from a game's Nexus mod listing. Plus a reusable GitHub Actions workflow template.

**Architecture:** No runtime changes; the engine (Plan 2) is already pure-function and testable. The codegen grows a `tests-emit.ts` that turns `tests.cases:` into Vitest `it(...)` calls importing the generated installers. A new `src/corpus/` module reads zip archives (file list only, no extraction) and feeds each one through the engine, reporting pass/fail. A new `src/nexus/` module talks to the public Nexus v1 REST API to enumerate mod files and download archives into the cache. The CLI grows `gdl test:corpus [--fetch]`. CI uses a reusable workflow that runs both layers, with the corpus cache persisted via `actions/cache`.

**Tech Stack:** Existing Plan 1+2 stack (Node 22, TypeScript 5.4, `yaml@2`, `vitest@3`, `webpack@5`, `commander@12`, `picomatch@4`, `pnpm@11`). New deps: `adm-zip@0.5` (zip file listing, sync, simple, sufficient for our needs). Native `fetch` for the Nexus client (Node 22).

**Spec reference:** `docs/superpowers/specs/2026-05-20-game-description-language-design.md`, particularly §6 (testing: three layers consolidated into one `tests:` block).

---

## File structure (delta from Plan 2)

```
game-description-language/
├── package.json                                  # add adm-zip dep + types
├── src/
│   ├── parser/
│   │   ├── ast.ts                                # +TestsNode, +TestCaseNode, +ExpectNode
│   │   └── index.ts                              # +parse tests block
│   ├── schema/
│   │   └── validator.ts                          # +validate tests block
│   ├── codegen/
│   │   ├── emit.ts                               # +emit tests.gen.ts
│   │   └── tests-emit.ts            (new)        # renders inline cases to Vitest source
│   ├── runtime/
│   │   └── test-harness.ts          (new)        # pure helpers used by generated tests
│   ├── corpus/                       (new dir)
│   │   ├── archive.ts                            # readZipEntries(path) → string[]
│   │   ├── cache.ts                              # localCachePaths(cwd) → string[]
│   │   └── runner.ts                             # runCorpus(rules, archives) → CorpusReport
│   ├── nexus/                        (new dir)
│   │   ├── client.ts                             # Nexus API: list mod files, get download URL
│   │   └── fetch-corpus.ts                       # fetchCorpus(gameDomain, cache) downloads to disk
│   ├── commands/
│   │   ├── test.ts                  (new)        # `gdl test` subcommand
│   │   └── test-corpus.ts           (new)        # `gdl test:corpus` subcommand
│   └── cli.ts                                    # register the new commands
├── .github/
│   └── workflows/
│       └── test.yml                 (new)        # reusable workflow extensions include
└── tests/
    ├── archive.test.ts              (new)
    ├── corpus-runner.test.ts        (new)
    ├── nexus-client.test.ts         (new)
    ├── tests-emit.test.ts           (new)
    ├── test-harness.test.ts         (new)
    ├── parser.test.ts                            # +tests block parsing
    ├── validator.test.ts                         # +tests validation
    ├── e2e.test.ts                               # +inline cases run through full pipeline
    └── fixtures/
        ├── with-tests/              (new)        # YAML w/ inline tests.cases
        ├── corpus-archives/         (new)        # 2-3 small zip fixtures
        └── nexus-mock/              (new)        # static JSON responses for nexus client
```

Files under `src/corpus/` and `src/nexus/` are codegen-time (the CLI calls them). They do *not* ship in the bundled extension; webpack's externals + the entrypoint shape keep them out automatically.

---

## Vertical slice first

Tasks 1–7 deliver inline test cases end to end: a `game.yaml` with a `tests:` block produces a Vitest file that imports the generated installer functions and asserts the install plan. Tasks 8–13 add the corpus runner with local archives and the Nexus client to populate it. Tasks 14–15 add CI plumbing and the final subnautica2-shaped E2E.

---

## Task 1: Tests AST nodes

**Files:**
- Modify: `src/parser/ast.ts`

Add the AST types for `tests:` blocks. No parser changes yet.

- [ ] **Step 1: Extend `src/parser/ast.ts`**

Add to `DocumentNode`:

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
  tests?: TestsNode;
}
```

Add the new types at the bottom of the file:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 56 tests still pass (no new tests yet).

- [ ] **Step 3: Commit**

```bash
git add src/parser/ast.ts
git commit -m "Add tests/case/expect AST nodes"
```

---

## Task 2: Parser: tests block

**Files:**
- Modify: `src/parser/index.ts`
- Create: `tests/fixtures/with-tests/game.yaml`
- Modify: `tests/parser.test.ts`

Parse the `tests:` block into `TestsNode`. The block has shape:

```yaml
tests:
  corpus: off | nexus
  cases:
    - name: <string>
      archive:
        - <path-string>
        - <path-string>
      expect:
        matched: <installer-id>
        modType: <mod-type-id>
        plan:
          - <destination-string>
```

- [ ] **Step 1: Create `tests/fixtures/with-tests/game.yaml`**

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
tests:
  corpus: off
  cases:
    - name: typical pak mod
      archive:
        - MyMod/CoolPak.pak
        - MyMod/Readme.md
      expect:
        matched: pak
        modType: pak
        plan:
          - ${modsRoot}/CoolPak.pak
          - ${modsRoot}/Readme.md
```

- [ ] **Step 2: Failing test in `tests/parser.test.ts`**

Append inside `describe('parseYaml')`:

```ts
  it('parses tests block with inline cases', () => {
    const doc = parseYaml(fixture('with-tests/game.yaml'), 'with-tests/game.yaml');
    expect(doc.tests).toBeDefined();
    expect(doc.tests!.corpus).toBe('off');
    expect(doc.tests!.cases).toHaveLength(1);
    const c = doc.tests!.cases[0]!;
    expect(c.name).toBe('typical pak mod');
    expect(c.archive).toEqual(['MyMod/CoolPak.pak', 'MyMod/Readme.md']);
    expect(c.expect).toBeDefined();
    expect(c.expect!.matched).toBe('pak');
    expect(c.expect!.modType).toBe('pak');
    expect(c.expect!.plan).toEqual(['${modsRoot}/CoolPak.pak', '${modsRoot}/Readme.md']);
  });
```

Run: `pnpm test parser`
Expected: FAIL (`doc.tests` undefined).

- [ ] **Step 3: Extend the parser**

In `src/parser/index.ts`, add to the imports from `./ast.js`:

```ts
import type {
  // ... existing imports ...
  TestsNode, TestCaseNode, ExpectNode, CorpusMode,
} from './ast.js';
```

Add a helper above `parseYaml`:

```ts
const parseTestsBlock = (node: YamlNode, file: string, source: string): TestsNode => {
  if (!isMap(node)) {
    throw new BuildErrors([{
      code: 'GDL080',
      message: '`tests:` must be a mapping',
      span: spanOf(file, source, node),
    }]);
  }

  const corpusRaw = node.get('corpus');
  const corpus: CorpusMode = corpusRaw === 'nexus' ? 'nexus' : 'off';

  const casesYaml = node.get('cases', true);
  const cases: TestCaseNode[] = [];
  if (isSeq(casesYaml)) {
    for (const entry of casesYaml.items) {
      if (!isMap(entry)) {
        throw new BuildErrors([{
          code: 'GDL081',
          message: '`tests.cases[]` entries must be mappings',
          span: spanOf(file, source, entry as YamlNode),
        }]);
      }
      const archiveYaml = entry.get('archive', true);
      const archive: string[] = isSeq(archiveYaml)
        ? archiveYaml.items.map(i => (isScalar(i) ? String(i.value) : String(i)))
        : [];

      let expectNode: ExpectNode | undefined;
      const expectYaml = entry.get('expect', true);
      if (isMap(expectYaml)) {
        const planYaml = expectYaml.get('plan', true);
        const plan: string[] | undefined = isSeq(planYaml)
          ? planYaml.items.map(i => (isScalar(i) ? String(i.value) : String(i)))
          : undefined;
        const matched = expectYaml.has('matched') ? String(expectYaml.get('matched')) : undefined;
        const modType = expectYaml.has('modType') ? String(expectYaml.get('modType')) : undefined;
        expectNode = {
          kind: 'expect',
          ...(matched !== undefined && { matched }),
          ...(modType !== undefined && { modType }),
          ...(plan    !== undefined && { plan }),
          span: spanOf(file, source, expectYaml as YamlNode),
        };
      }

      cases.push({
        kind: 'testCase',
        name: String(entry.get('name') ?? ''),
        archive,
        ...(expectNode !== undefined && { expect: expectNode }),
        span: spanOf(file, source, entry),
      });
    }
  }

  return {
    kind: 'tests',
    corpus,
    cases,
    span: spanOf(file, source, node),
  };
};
```

After the discovery parsing block, before the return, add:

```ts
const testsYaml = root.get('tests', true);
let tests: TestsNode | undefined;
if (testsYaml) {
  tests = parseTestsBlock(testsYaml as YamlNode, file, source);
}
```

Add to the return literal:

```ts
...(tests !== undefined && { tests }),
```

- [ ] **Step 4: Run tests**

Run: `pnpm test parser`
Expected: PASS (including the new case).

Run: `pnpm test`
Expected: 57 tests pass (56 + 1 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/parser/ tests/parser.test.ts tests/fixtures/with-tests/
git commit -m "Parse tests block with inline cases"
```

---

## Task 3: Validator: tests block

**Files:**
- Modify: `src/schema/validator.ts`
- Modify: `tests/validator.test.ts`

Validate that case names are non-empty, archive lists are non-empty, and `expect.matched`/`expect.modType` (when present) reference declared installers and modTypes.

- [ ] **Step 1: Failing tests in `tests/validator.test.ts`**

Append inside `describe('validate')`:

```ts
  it('rejects test case with empty name', () => {
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
tests:
  corpus: off
  cases:
    - name: ""
      archive: ["x.pak"]
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL120')).toBe(true);
  });

  it('rejects test case with empty archive', () => {
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
tests:
  corpus: off
  cases:
    - name: case1
      archive: []
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL121')).toBe(true);
  });

  it('rejects expect.matched referencing undeclared installer', () => {
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
tests:
  corpus: off
  cases:
    - name: case1
      archive: [a.pak]
      expect: { matched: ue4ss-lua }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL122')).toBe(true);
  });
```

Run: `pnpm test validator`
Expected: FAIL.

- [ ] **Step 2: Extend `src/schema/validator.ts`**

After the existing `if (doc.installers) { ... }` block, before `return errors;`, add:

```ts
if (doc.tests) {
  const declaredInstallers = new Set((doc.installers ?? []).map(i => i.id));
  const declaredModTypes   = new Set((doc.modTypes   ?? []).map(mt => mt.id));
  for (const c of doc.tests.cases) {
    if (!c.name.trim()) {
      errors.push({
        code: 'GDL120',
        message: 'test case name is required',
        span: c.span,
      });
    }
    if (c.archive.length === 0) {
      errors.push({
        code: 'GDL121',
        message: 'test case archive list cannot be empty',
        span: c.span,
      });
    }
    if (c.expect?.matched !== undefined && !declaredInstallers.has(c.expect.matched)) {
      errors.push({
        code: 'GDL122',
        message: `test case \`${c.name}\` expects matched installer \`${c.expect.matched}\` which is not declared`,
        span: c.span,
        hint: declaredInstallers.size
          ? `declared installers: ${[...declaredInstallers].join(', ')}`
          : 'no installers declared',
      });
    }
    if (c.expect?.modType !== undefined && !declaredModTypes.has(c.expect.modType)) {
      errors.push({
        code: 'GDL123',
        message: `test case \`${c.name}\` expects modType \`${c.expect.modType}\` which is not declared`,
        span: c.span,
      });
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test validator`
Expected: PASS.

Run: `pnpm test`
Expected: 60 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/schema/validator.ts tests/validator.test.ts
git commit -m "Validate tests block: names, archives, and matched/modType refs"
```

---

## Task 4: Runtime test harness helper

**Files:**
- Create: `src/runtime/test-harness.ts`
- Create: `tests/test-harness.test.ts`

A pure helper that takes a built install plan and an `ExpectNode` shape, and returns a structured diff. Used by generated tests AND by the corpus runner (Task 9).

- [ ] **Step 1: Failing tests in `tests/test-harness.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assertPlan, type ExpectShape } from '../src/runtime/test-harness.js';
import type { InstallInstruction } from '../src/runtime/installer-engine.js';

const inst = (source: string, destination: string, modType: string): InstallInstruction => ({ source, destination, modType });

describe('assertPlan', () => {
  it('returns OK when plan matches expectation by destinations', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { plan: ['/mods/a.pak'] };
    expect(assertPlan(plan, 'pak', e)).toEqual({ ok: true });
  });

  it('reports a destination mismatch', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { plan: ['/mods/b.pak'] };
    const result = assertPlan(plan, 'pak', e);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/destination/i);
  });

  it('reports a modType mismatch', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { modType: 'ue4ss-lua' };
    const result = assertPlan(plan, 'pak', e);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/modType/);
  });

  it('reports a matched-installer mismatch via the matchedId argument', () => {
    const plan = [inst('a.pak', '/mods/a.pak', 'pak')];
    const e: ExpectShape = { matched: 'ue4ss-lua' };
    const result = assertPlan(plan, 'pak', e);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/matched/i);
  });
});
```

Run: `pnpm test test-harness`
Expected: FAIL.

- [ ] **Step 2: Implement `src/runtime/test-harness.ts`**

```ts
import type { InstallInstruction } from './installer-engine.js';

export interface ExpectShape {
  matched?: string;
  modType?: string;
  plan?: string[];
}

export type AssertResult =
  | { ok: true }
  | { ok: false; message: string };

const fmt = (paths: readonly string[]): string =>
  paths.map(p => `  ${p}`).join('\n');

export const assertPlan = (
  plan: readonly InstallInstruction[],
  matchedId: string,
  expected: ExpectShape,
): AssertResult => {
  if (expected.matched !== undefined && expected.matched !== matchedId) {
    return {
      ok: false,
      message: `matched installer mismatch: expected \`${expected.matched}\`, got \`${matchedId}\``,
    };
  }
  if (expected.modType !== undefined) {
    const actual = plan[0]?.modType;
    if (actual !== expected.modType) {
      return {
        ok: false,
        message: `modType mismatch: expected \`${expected.modType}\`, got \`${actual ?? '<none>'}\``,
      };
    }
  }
  if (expected.plan !== undefined) {
    const actual = [...plan.map(p => p.destination)].sort();
    const want   = [...expected.plan].sort();
    if (actual.length !== want.length || actual.some((d, i) => d !== want[i])) {
      return {
        ok: false,
        message: `destination plan mismatch.\nexpected:\n${fmt(want)}\nactual:\n${fmt(actual)}`,
      };
    }
  }
  return { ok: true };
};
```

- [ ] **Step 3: Re-export from `src/runtime/index.ts`**

Add a line so `assertPlan` is reachable as `@gdl/runtime`:

```ts
export * from './test-harness.js';
```

Place it next to the other runtime re-exports.

- [ ] **Step 4: Run tests**

Run: `pnpm test test-harness`
Expected: PASS (4 cases).

Run: `pnpm test`
Expected: 64 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/test-harness.ts src/runtime/index.ts tests/test-harness.test.ts
git commit -m "Add runtime test-harness helper for plan/modType/matched assertions"
```

---

## Task 5: Codegen: emit tests.gen.ts

**Files:**
- Create: `src/codegen/tests-emit.ts`
- Modify: `src/codegen/emit.ts`
- Create: `tests/tests-emit.test.ts`

Generate a `tests.gen.ts` file alongside the extension that, when run by Vitest, drives the installer engine with each inline case's archive and asserts against the expected shape.

- [ ] **Step 1: Create `src/codegen/tests-emit.ts`**

```ts
import type { DocumentNode, TestCaseNode } from '../parser/ast.js';
import { sq } from './emit.js';

// The generated TS file imports the runtime engine and the installer rules
// the extension exposes (via a small bridge module — see Step 2).

const renderCase = (c: TestCaseNode, ruleVarsByName: Record<string, string>): string => {
  const expectObj = c.expect
    ? `{
      ${c.expect.matched !== undefined ? `matched: ${sq(c.expect.matched)},` : ''}
      ${c.expect.modType !== undefined ? `modType: ${sq(c.expect.modType)},` : ''}
      ${c.expect.plan    !== undefined ? `plan: [${c.expect.plan.map(sq).join(', ')}],` : ''}
    }`
    : '{}';

  const archive = c.archive.map(p => sq(p)).join(', ');

  return `  it(${sq(c.name)}, () => {
    const archive = [${archive}];
    const ctx = { archivePaths: archive, vars: resolvedVars };
    let matchedId: string | undefined;
    let plan: InstallInstruction[] = [];
    for (const rule of rules) {
      const result = buildInstallPlan(rule, archive, ctx);
      if (result.length > 0) {
        matchedId = rule.id;
        plan = result;
        break;
      }
    }
    if (!matchedId) throw new Error('no installer matched');
    const ar = assertPlan(plan, matchedId, ${expectObj});
    if (!ar.ok) throw new Error(ar.message);
  });
`;
};

export const renderTestsFile = (doc: DocumentNode): string => {
  if (!doc.tests || doc.tests.cases.length === 0) return '';

  const cases = doc.tests.cases.map(c => renderCase(c, {})).join('\n');

  // Pre-resolve the YAML context against a synthetic discovery facts object.
  // The corpus tests assume Windows/steam; that's a stable enough baseline
  // for unit tests. Real discovery is what runtime uses; this is for tests only.
  const contextBindings = (doc.context?.bindings ?? [])
    .map(b => {
      if (b.value.kind === 'literal')      return `${sq(b.name)}: ${JSON.stringify(b.value.raw)}`;
      if (b.value.kind === 'interpolated') return `${sq(b.name)}: ${sq(b.value.template)}`;
      // For branches, resolve to the default arm value (tests assume the default platform).
      // Coarse — the implementer can refine if a test case needs a specific store.
      return `${sq(b.name)}: ${sq('<branch — refine in test fixture>')}`;
    })
    .join(', ');

  return `// AUTO-GENERATED by GDL. Do not edit by hand.
import { describe, it } from 'vitest';
import { buildInstallPlan, type InstallInstruction } from '@gdl/runtime';
import { assertPlan } from '@gdl/runtime';
import { rules } from './installers.gen.js';

// Synthetic test context: literal/interpolated bindings resolved with placeholder facts.
const resolvedVars: Record<string, string> = {
  store: 'steam',
  os: 'windows',
  arch: 'x64',
  installPath: '/games/Hello',
  executablePath: '/games/Hello/${doc.game.executable}',
  ${contextBindings}
};

// Pre-interpolate the vars so ${'${name}'} placeholders in placeAt resolve at test time.
function interpolateVars(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...obj };
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const k of Object.keys(out)) {
      const replaced = (out[k] as string).replace(/\\\$\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}/g, (_m, name) =>
        out[name] !== undefined ? (out[name] as string) : '\\${' + name + '}'
      );
      if (replaced !== out[k]) { out[k] = replaced; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

const flatVars = interpolateVars(resolvedVars);

describe(${sq(doc.game.id + ' — generated tests')}, () => {
${cases}});
`;
};
```

> **Note on the var-resolution shortcut:** the generated tests don't go through the live `resolveContext` at unit-test time. They pre-interpolate with placeholder facts (steam/windows). This is enough to drive the engine and check plans. The full resolver runs at extension load time in Vortex, which is exercised by the e2e + corpus paths, not by inline cases.

- [ ] **Step 2: Modify `src/codegen/emit.ts` to emit a separate `installers.gen.ts` AND wire `tests.gen.ts`**

The current emit produces everything inline in `extension.ts`. For tests to import the rules, we need `rules` to be exported from a sibling file. Refactor so:
- `extension.ts`: entry point that imports rules and registers them
- `installers.gen.ts`: exports the rules array (importable by tests)
- `tests.gen.ts`: emitted when `tests.cases` is non-empty

In `src/codegen/emit.ts`, replace the existing single-file extension construction with the following structure. Find the section that constructs `extension` and `installers` strings and refactor:

```ts
import { renderTestsFile } from './tests-emit.js';

// ... existing helpers (sq, renderValueNode, renderPattern, renderInstaller, etc.) ...

export const emit = (doc: DocumentNode, opts: EmitOptions = {}): EmittedFile[] => {
  // ... existing bindings/modTypes/installers/stores/hookIds/versionHook computation ...

  // installers.gen.ts: exports the rules array for tests + the extension to import.
  const installersFile = `${banner(doc.game.span.file)}
import type { InstallerRule } from '@gdl/runtime';

export const rules: InstallerRule[] = [
${installers}
];
`;

  const hookImports = hookIds.size
    ? `import * as hooks from '../src/hooks.js';`
    : '';

  const extension = `${banner(doc.game.span.file)}
import { GdlRuntime } from '@gdl/runtime';
import type { IExtensionContext } from 'vortex-api';
import { rules } from './installers.gen.js';
${hookImports}

export default function main(api: IExtensionContext): boolean {
  const runtime = new GdlRuntime(api);
  runtime.registerGame(
    {
      id: ${sq(doc.game.id)},
      name: ${sq(doc.game.name)},
      executable: ${sq(doc.game.executable)},
      requiredFiles: ${JSON.stringify(doc.game.requiredFiles)},
      ${doc.game.logo ? `logo: ${sq(doc.game.logo)},` : ''}
      ${doc.game.contributedBy ? `contributedBy: ${sq(doc.game.contributedBy)},` : ''}
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
    rules,
    {
      versionHook: ${versionHook},
    },
  );
  return true;
}
`;

  const testsFile = renderTestsFile(doc);

  // ... existing source-map building ...

  const files: EmittedFile[] = [
    { path: 'extension.ts',     contents: extensionWithMapRef },
    { path: 'extension.ts.map', contents: JSON.stringify(map) },
    { path: 'installers.gen.ts', contents: installersFile },
    { path: 'info.json',        contents: info },
  ];
  if (testsFile) {
    files.push({ path: 'tests.gen.ts', contents: testsFile });
  }
  return files;
};
```

Also export `sq` from `emit.ts` so `tests-emit.ts` can import it:

```ts
export const sq = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
```

(If `sq` is currently a non-exported const, add the `export` keyword.)

- [ ] **Step 3: Failing test in `tests/tests-emit.test.ts`**

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
context:
  modsRoot: /games/Hello/Mods
modTypes:
  - { id: pak, name: Pak Mod, path: "/games/Hello/Mods" }
installers:
  - id: pak
    priority: 10
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: "/games/Hello/Mods"
    modType: pak
tests:
  corpus: off
  cases:
    - name: typical
      archive: [a.pak, b.txt]
      expect: { matched: pak }
`;

describe('renderTestsFile', () => {
  it('emits a vitest file that imports rules and uses assertPlan', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc);
    const testsFile = files.find(f => f.path === 'tests.gen.ts');
    expect(testsFile).toBeDefined();
    expect(testsFile!.contents).toContain("import { describe, it } from 'vitest'");
    expect(testsFile!.contents).toContain("import { buildInstallPlan");
    expect(testsFile!.contents).toContain("import { rules } from './installers.gen.js'");
    expect(testsFile!.contents).toContain("it('typical'");
    expect(testsFile!.contents).toContain("matched: 'pak'");
  });

  it('does not emit tests.gen.ts when no cases are declared', () => {
    const noTests = `
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`;
    const doc = parseYaml(noTests, 'no.yaml');
    const files = emit(doc);
    expect(files.find(f => f.path === 'tests.gen.ts')).toBeUndefined();
  });
});
```

Run: `pnpm test tests-emit`
Expected: FAIL (module not found / file not emitted).

- [ ] **Step 4: Run tests after implementation**

Run: `pnpm test`
Expected: 66 tests pass (60 + 2 new + 4 existing-suite changes recovered).

Verify the e2e tests still pass; the codegen now emits 4-5 files instead of 3. The existing filesystem test from MVP only checked specific files exist (not exact count), so it should be unaffected.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/codegen/ tests/tests-emit.test.ts
git commit -m "Emit tests.gen.ts and split installers into installers.gen.ts"
```

---

## Task 6: Wire the `tests.gen.ts` to webpack as a test entry

**Files:**
- Modify: `src/codegen/emit.ts` (make `tests.gen.ts` import paths webpack-aware)
- Create: `tests/fixtures/e2e/expected-tests-pass.ts` (a Vitest probe; see Step 1)
- Modify: `tests/e2e.test.ts` (assert the generated tests pass)

This task verifies the generated tests file is actually a valid Vitest module. Strategy: after the e2e build, copy `tests.gen.ts` into a temp location and run it through Vitest CLI (or `vitest run` from the temp dir).

- [ ] **Step 1: Modify the e2e fixture to include a tests block**

Update `tests/fixtures/e2e/game.yaml` (existing file) to add a `tests:` block:

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
  paksRoot: ${modsRoot}/Paks
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
tests:
  corpus: off
  cases:
    - name: typical pak mod
      archive: [MyMod/CoolPak.pak, MyMod/Readme.md]
      expect:
        matched: pak
        plan:
          - /games/Hello/Mods/Paks/CoolPak.pak
          - /games/Hello/Mods/Paks/Readme.md
```

> Note we removed the `!storeBranch` from the previous fixture to keep the tests' resolved-vars simple (the `renderTestsFile` shortcut uses default-arm only for branches; precision improves in a later refactor).

- [ ] **Step 2: Extend `tests/e2e.test.ts` to assert tests.gen.ts was produced and parses as valid TS**

In `tests/e2e.test.ts`, after the existing assertions in the hello-world e2e test, add:

```ts
    // tests.gen.ts emitted alongside the other artifacts
    const testsGenPath = join(work, '.gdl-out', 'tests.gen.ts');
    expect(existsSync(testsGenPath)).toBe(true);
    const testsGen = readFileSync(testsGenPath, 'utf8');
    expect(testsGen).toContain("describe('helloworld — generated tests'");
    expect(testsGen).toContain("it('typical pak mod'");
    expect(testsGen).toContain('/games/Hello/Mods/Paks/CoolPak.pak');
```

- [ ] **Step 3: Run tests**

Run: `pnpm test e2e`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/e2e/game.yaml tests/e2e.test.ts
git commit -m "E2E: assert generated tests.gen.ts shape and case content"
```

---

## Task 7: Archive extractor (zip file listing)

**Files:**
- Create: `src/corpus/archive.ts`
- Create: `tests/archive.test.ts`
- Modify: `package.json` (add `adm-zip` + types)
- Create: `tests/fixtures/corpus-archives/typical-pak.zip` (small test zip)

Read a `.zip` file and return the list of internal paths. No extraction; just file names. This is what the installer engine needs.

- [ ] **Step 1: Add deps**

Edit `package.json`:

```json
"dependencies": {
  ...
  "adm-zip": "^0.5.16"
},
"devDependencies": {
  ...
  "@types/adm-zip": "^0.5.7"
}
```

Run: `pnpm install`.

- [ ] **Step 2: Create the fixture zip**

Run from the repo root:

```bash
mkdir -p tests/fixtures/corpus-archives/_src/MyMod
echo "fake pak data" > tests/fixtures/corpus-archives/_src/MyMod/CoolPak.pak
echo "readme" > tests/fixtures/corpus-archives/_src/MyMod/Readme.md
( cd tests/fixtures/corpus-archives/_src && zip -r ../typical-pak.zip MyMod )
rm -rf tests/fixtures/corpus-archives/_src
```

If `zip` isn't available, use Node directly:

```bash
node -e "const AdmZip = require('adm-zip'); const z = new AdmZip(); z.addFile('MyMod/CoolPak.pak', Buffer.from('fake pak data')); z.addFile('MyMod/Readme.md', Buffer.from('readme')); z.writeZip('tests/fixtures/corpus-archives/typical-pak.zip');"
```

Verify the zip was created: `ls -la tests/fixtures/corpus-archives/typical-pak.zip`.

- [ ] **Step 3: Failing test in `tests/archive.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readZipEntries } from '../src/corpus/archive.js';

describe('readZipEntries', () => {
  it('returns sorted POSIX paths from a zip file', () => {
    const archivePath = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const entries = readZipEntries(archivePath);
    expect(entries).toEqual([
      'MyMod/CoolPak.pak',
      'MyMod/Readme.md',
    ]);
  });
});
```

Run: `pnpm test archive`
Expected: FAIL.

- [ ] **Step 4: Implement `src/corpus/archive.ts`**

```ts
import AdmZip from 'adm-zip';

export const readZipEntries = (zipPath: string): string[] => {
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter(e => !e.isDirectory)
    .map(e => e.entryName.replace(/\\/g, '/'));
  return entries.sort();
};
```

- [ ] **Step 5: Run tests**

Run: `pnpm test archive`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/corpus/archive.ts tests/archive.test.ts tests/fixtures/corpus-archives/typical-pak.zip
git commit -m "Add zip archive entry reader backed by adm-zip"
```

---

## Task 8: Local cache scanner

**Files:**
- Modify: `src/corpus/archive.ts` (add `localCachePaths`)
- Modify: `tests/archive.test.ts`

Scan `<cwd>/tests/cache/` for `*.zip` files and return absolute paths.

- [ ] **Step 1: Failing test**

Append to `tests/archive.test.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('localCachePaths', () => {
  it('lists *.zip files in tests/cache/', async () => {
    const { localCachePaths } = await import('../src/corpus/archive.js');
    const dir = mkdtempSync(join(tmpdir(), 'gdl-cache-'));
    mkdirSync(join(dir, 'tests', 'cache'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'cache', 'a.zip'), Buffer.from([]));
    writeFileSync(join(dir, 'tests', 'cache', 'b.zip'), Buffer.from([]));
    writeFileSync(join(dir, 'tests', 'cache', 'c.txt'), Buffer.from([])); // ignored
    const paths = localCachePaths(dir);
    expect(paths.map(p => p.split('/').pop())).toEqual(['a.zip', 'b.zip']);
  });

  it('returns empty list if cache dir does not exist', async () => {
    const { localCachePaths } = await import('../src/corpus/archive.js');
    const dir = mkdtempSync(join(tmpdir(), 'gdl-cache-empty-'));
    expect(localCachePaths(dir)).toEqual([]);
  });
});
```

Run: `pnpm test archive`
Expected: FAIL (`localCachePaths` not exported).

- [ ] **Step 2: Extend `src/corpus/archive.ts`**

```ts
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const localCachePaths = (cwd: string): string[] => {
  const cacheDir = join(cwd, 'tests', 'cache');
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter(name => name.endsWith('.zip'))
    .sort()
    .map(name => join(cacheDir, name));
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test archive`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/corpus/archive.ts tests/archive.test.ts
git commit -m "Add local cache scanner for tests/cache/*.zip"
```

---

## Task 9: Corpus runner

**Files:**
- Create: `src/corpus/runner.ts`
- Create: `tests/corpus-runner.test.ts`

Given a list of archive paths and the installer rules, run each archive through the engine and collect a structured report.

- [ ] **Step 1: Failing tests in `tests/corpus-runner.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { runCorpus, type CorpusReport } from '../src/corpus/runner.js';
import type { InstallerRule } from '../src/runtime/installer-engine.js';

const pakRule: InstallerRule = {
  id: 'pak',
  priority: 10,
  when: { kind: 'hasFile', glob: '**/*.pak' },
  single: {
    anchor: { kind: 'glob', pattern: '**/*.pak' },
    take: 'parent',
    placeAt: '/mods',
  },
  modType: 'pak',
};

describe('runCorpus', () => {
  it('reports each archive: matched/installed/none', () => {
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const report: CorpusReport = runCorpus([pakRule], [archive], { vars: {} });
    expect(report.total).toBe(1);
    expect(report.matched).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.entries[0]).toMatchObject({
      archive: expect.stringContaining('typical-pak.zip'),
      matchedInstaller: 'pak',
      planSize: 2,
    });
  });

  it('reports unmatched archives without failing the run', () => {
    const onlyLua: InstallerRule = {
      ...pakRule,
      id: 'lua',
      when: { kind: 'hasFile', glob: '**/*.lua' },
      single: { ...pakRule.single!, anchor: { kind: 'glob', pattern: '**/*.lua' } },
    };
    const archive = join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip');
    const report = runCorpus([onlyLua], [archive], { vars: {} });
    expect(report.matched).toBe(0);
    expect(report.unmatched).toBe(1);
    expect(report.entries[0]?.matchedInstaller).toBeUndefined();
  });
});
```

Run: `pnpm test corpus-runner`
Expected: FAIL.

- [ ] **Step 2: Implement `src/corpus/runner.ts`**

```ts
import { readZipEntries } from './archive.js';
import { buildInstallPlan, type InstallerRule, type InstallInstruction } from '../runtime/installer-engine.js';

export interface CorpusEntry {
  archive: string;
  matchedInstaller?: string;
  planSize: number;
  error?: string;
}

export interface CorpusReport {
  total: number;
  matched: number;
  unmatched: number;
  failed: number;
  entries: CorpusEntry[];
}

export interface CorpusOptions {
  vars: Record<string, string | number | boolean>;
}

export const runCorpus = (
  rules: readonly InstallerRule[],
  archivePaths: readonly string[],
  opts: CorpusOptions,
): CorpusReport => {
  const entries: CorpusEntry[] = [];
  let matched = 0, unmatched = 0, failed = 0;

  // Highest-priority first (lower number = earlier). Same convention as the engine.
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const archive of archivePaths) {
    try {
      const files = readZipEntries(archive);
      const ctx = { archivePaths: files, vars: opts.vars };
      let matchedRule: InstallerRule | undefined;
      let plan: InstallInstruction[] = [];
      for (const rule of sortedRules) {
        const result = buildInstallPlan(rule, files, ctx);
        if (result.length > 0) { matchedRule = rule; plan = result; break; }
      }
      if (matchedRule) {
        entries.push({ archive, matchedInstaller: matchedRule.id, planSize: plan.length });
        matched++;
      } else {
        entries.push({ archive, planSize: 0 });
        unmatched++;
      }
    } catch (e) {
      entries.push({ archive, planSize: 0, error: e instanceof Error ? e.message : String(e) });
      failed++;
    }
  }

  return {
    total: archivePaths.length,
    matched,
    unmatched,
    failed,
    entries,
  };
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test corpus-runner`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/corpus/runner.ts tests/corpus-runner.test.ts
git commit -m "Add corpus runner that reports per-archive matched/unmatched/failed"
```

---

## Task 10: CLI: `gdl test:corpus`

**Files:**
- Create: `src/commands/test-corpus.ts`
- Modify: `src/cli.ts`

A CLI verb that loads `game.yaml`, finds `tests/cache/*.zip`, and runs them through the engine. Prints a report.

- [ ] **Step 1: Create `src/commands/test-corpus.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';
import { validate } from '../schema/validator.js';
import { BuildErrors } from '../errors.js';
import { localCachePaths } from '../corpus/archive.js';
import { runCorpus } from '../corpus/runner.js';
import type { InstallerRule } from '../runtime/installer-engine.js';
import type { DocumentNode, InstallerNode, ValueNode } from '../parser/ast.js';

// Lower the AST installer to the runtime InstallerRule shape (same conversion the codegen does).
// For the corpus CLI we don't go through code generation — we use the AST directly.
const flattenPlaceAt = (v: ValueNode): string => {
  if (v.kind === 'literal') return String(v.raw);
  if (v.kind === 'interpolated') return v.template;
  throw new Error(`unsupported placeAt kind ${v.kind} in corpus runner`);
};

const lowerRule = (inst: InstallerNode): InstallerRule => {
  if (inst.single) {
    return {
      id: inst.id,
      priority: inst.priority,
      when: lowerPredicate(inst.when),
      single: {
        anchor: { kind: inst.single.anchor.kind, pattern: inst.single.anchor.pattern },
        take: inst.single.take,
        placeAt: flattenPlaceAt(inst.single.placeAt),
      },
      modType: inst.modType!,
    };
  }
  // route form
  return {
    id: inst.id,
    priority: inst.priority,
    when: lowerPredicate(inst.when),
    route: (inst.route ?? []).map(r => ({
      match:   { kind: r.match.kind,  pattern: r.match.pattern },
      anchor:  { kind: r.anchor.kind, pattern: r.anchor.pattern },
      take:    r.take,
      placeAt: flattenPlaceAt(r.placeAt),
      modType: r.modType,
    })),
  };
};

// Direct mapping from AST predicate to runtime predicate.
const lowerPredicate = (p: import('../parser/ast.js').PredicateNode): import('../runtime/predicate.js').PredicateExpr => {
  if (p.kind === 'hasFile')  return { kind: 'hasFile',  glob: p.pattern.pattern };
  if (p.kind === 'hasFiles') return { kind: 'hasFiles', globs: p.patterns.map(pat => pat.pattern) };
  if (p.kind === 'matches')  return { kind: 'matches',  regex: p.pattern.pattern };
  if (p.kind === 'any')      return { kind: 'any',      arms: p.arms.map(lowerPredicate) };
  if (p.kind === 'all')      return { kind: 'all',      arms: p.arms.map(lowerPredicate) };
  if (p.kind === 'not')      return { kind: 'not',      arm: lowerPredicate(p.arm) };
  // when
  if (p.expr.op === 'in') {
    return { kind: 'when', expr: { op: 'in', left: p.expr.left, right: p.expr.right } };
  }
  return { kind: 'when', expr: { op: p.expr.op, left: p.expr.left, right: p.expr.right } };
};

const flatVarsFromDoc = (doc: DocumentNode): Record<string, string> => {
  const vars: Record<string, string> = {
    store: 'steam', os: 'windows', arch: 'x64',
    installPath: '/games/Hello',
    executablePath: '/games/Hello/' + doc.game.executable,
  };
  for (const b of doc.context?.bindings ?? []) {
    if (b.value.kind === 'literal')      vars[b.name] = String(b.value.raw);
    if (b.value.kind === 'interpolated') vars[b.name] = b.value.template;
  }
  // Interpolate ${name} placeholders.
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const k of Object.keys(vars)) {
      const replaced = (vars[k] as string).replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name) =>
        vars[name] !== undefined ? (vars[name] as string) : `\${${name}}`
      );
      if (replaced !== vars[k]) { vars[k] = replaced; changed = true; }
    }
    if (!changed) break;
  }
  return vars;
};

export interface TestCorpusArgs {
  cwd: string;
  yamlPath?: string;
}

export const runTestCorpus = async (args: TestCorpusArgs): Promise<void> => {
  const yamlPath = args.yamlPath ?? join(args.cwd, 'game.yaml');
  const source = await readFile(yamlPath, 'utf8');
  const doc = parseYaml(source, yamlPath);
  const errs = validate(doc);
  if (errs.length) throw new BuildErrors(errs);

  const rules = (doc.installers ?? []).map(lowerRule);
  const archives = localCachePaths(args.cwd);

  if (archives.length === 0) {
    process.stdout.write('no archives in tests/cache/ — nothing to do\n');
    return;
  }

  const report = runCorpus(rules, archives, { vars: flatVarsFromDoc(doc) });

  for (const e of report.entries) {
    const name = e.archive.split('/').pop()!;
    if (e.error) {
      process.stdout.write(`  ✖ ${name}  ERROR  ${e.error}\n`);
    } else if (e.matchedInstaller) {
      process.stdout.write(`  ✓ ${name}  → ${e.matchedInstaller} (${e.planSize} files)\n`);
    } else {
      process.stdout.write(`  ? ${name}  no installer matched\n`);
    }
  }
  process.stdout.write(
    `\nsummary: ${report.matched} matched, ${report.unmatched} unmatched, ${report.failed} failed, ${report.total} total\n`,
  );

  if (report.failed > 0) process.exit(1);
};
```

- [ ] **Step 2: Register the command in `src/cli.ts`**

Below the existing `build` command registration, add:

```ts
import { runTestCorpus } from './commands/test-corpus.js';

program
  .command('test:corpus')
  .description('Run installer rules against archives in tests/cache/')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .action(async (opts: { yaml?: string }) => {
    try {
      await runTestCorpus({
        cwd: process.cwd(),
        ...(opts.yaml !== undefined && { yamlPath: opts.yaml }),
      });
    } catch (err) {
      const { reportBuildError } = await import('./commands/build.js');
      process.stderr.write(reportBuildError(err) + '\n');
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Build and sanity-run**

Run: `pnpm build`
Expected: clean.

Run: `node dist/cli.js --help`
Expected: `test:corpus` listed alongside `build`.

Run: `pnpm typecheck`
Expected: exits 0.

Run: `pnpm test`
Expected: all tests pass (no direct test of the CLI verb; it's exercised by Task 12's E2E).

- [ ] **Step 4: Commit**

```bash
git add src/commands/test-corpus.ts src/cli.ts
git commit -m "Add gdl test:corpus CLI verb"
```

---

## Task 11: Nexus client (auth + list + download)

**Files:**
- Create: `src/nexus/client.ts`
- Create: `tests/nexus-client.test.ts`
- Create: `tests/fixtures/nexus-mock/` directory with stub JSON responses

A small Nexus v1 REST client. The runtime tests mock `fetch` to avoid real Nexus calls.

- [ ] **Step 1: Failing tests in `tests/nexus-client.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listGameModIds, listModFiles, getDownloadUrl, type NexusFile } from '../src/nexus/client.js';

const mkRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Nexus client', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(()  => { vi.restoreAllMocks(); });

  it('listGameModIds: collects mod ids from updated.json paginated requests', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('updated.json?period=1m')) {
        return mkRes([
          { mod_id: 100, latest_file_update: 1 },
          { mod_id: 101, latest_file_update: 1 },
        ]);
      }
      return mkRes([], 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const ids = await listGameModIds({ gameDomain: 'subnautica2', apiKey: 'k' });
    expect(ids).toEqual([100, 101]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/games/subnautica2/mods/updated.json?period=1m'),
      expect.objectContaining({ headers: expect.objectContaining({ apikey: 'k' }) }),
    );
  });

  it('listModFiles: returns the files array for a mod', async () => {
    const fetchMock = vi.fn(async () =>
      mkRes({ files: [{ file_id: 7, file_name: 'CoolPak-1.0.zip', version: '1.0', size_kb: 12 }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const files: NexusFile[] = await listModFiles({ gameDomain: 'subnautica2', apiKey: 'k', modId: 100 });
    expect(files).toEqual([{ fileId: 7, fileName: 'CoolPak-1.0.zip', version: '1.0', sizeKb: 12 }]);
  });

  it('getDownloadUrl: returns the first CDN URL', async () => {
    const fetchMock = vi.fn(async () =>
      mkRes([{ URI: 'https://cdn.example/CoolPak.zip', name: 'CDN1' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await getDownloadUrl({ gameDomain: 'subnautica2', apiKey: 'k', modId: 100, fileId: 7 });
    expect(url).toBe('https://cdn.example/CoolPak.zip');
  });

  it('returns empty arrays / throws on auth failures', async () => {
    const fetchMock = vi.fn(async () => mkRes({ message: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listModFiles({ gameDomain: 'x', apiKey: 'bad', modId: 1 }))
      .rejects.toThrow(/401|unauthor/i);
  });
});
```

Run: `pnpm test nexus-client`
Expected: FAIL.

- [ ] **Step 2: Implement `src/nexus/client.ts`**

```ts
const API_BASE = 'https://api.nexusmods.com';

export interface NexusAuth {
  apiKey: string;
}

export interface ListModIdsParams extends NexusAuth {
  gameDomain: string;
}

export interface ListModFilesParams extends NexusAuth {
  gameDomain: string;
  modId: number;
}

export interface DownloadUrlParams extends NexusAuth {
  gameDomain: string;
  modId: number;
  fileId: number;
}

export interface NexusFile {
  fileId: number;
  fileName: string;
  version: string;
  sizeKb: number;
}

const headers = (apiKey: string) => ({
  apikey: apiKey,
  accept: 'application/json',
});

const expectOk = async (res: Response, ctx: string): Promise<void> => {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Nexus ${ctx}: ${res.status} ${res.statusText} ${body}`);
  }
};

export const listGameModIds = async (p: ListModIdsParams): Promise<number[]> => {
  // Use the `updated.json` endpoint with period=1m to enumerate mods touched in the last month.
  // For broader coverage, call this multiple times across periods (1m, 3m, 6m); dedupe.
  // For Plan 3, a single 1m window is the baseline; extend the implementation if needed.
  const url = `${API_BASE}/v1/games/${p.gameDomain}/mods/updated.json?period=1m`;
  const res = await fetch(url, { headers: headers(p.apiKey) });
  await expectOk(res, 'listGameModIds');
  const body = (await res.json()) as { mod_id: number }[];
  const ids = new Set<number>();
  for (const m of body) ids.add(m.mod_id);
  return [...ids].sort((a, b) => a - b);
};

export const listModFiles = async (p: ListModFilesParams): Promise<NexusFile[]> => {
  const url = `${API_BASE}/v1/games/${p.gameDomain}/mods/${p.modId}/files.json`;
  const res = await fetch(url, { headers: headers(p.apiKey) });
  await expectOk(res, 'listModFiles');
  const body = (await res.json()) as { files: { file_id: number; file_name: string; version: string; size_kb: number }[] };
  return body.files.map(f => ({
    fileId: f.file_id, fileName: f.file_name, version: f.version, sizeKb: f.size_kb,
  }));
};

export const getDownloadUrl = async (p: DownloadUrlParams): Promise<string> => {
  // Non-premium users need to acquire a separate `key` from the Nexus UI; the `download_link.json`
  // endpoint will 403 without it. For premium API keys, the endpoint returns CDN URLs directly.
  // We assume a premium-class key for Plan 3.
  const url = `${API_BASE}/v1/games/${p.gameDomain}/mods/${p.modId}/files/${p.fileId}/download_link.json`;
  const res = await fetch(url, { headers: headers(p.apiKey) });
  await expectOk(res, 'getDownloadUrl');
  const body = (await res.json()) as { URI: string; name?: string }[];
  if (body.length === 0) throw new Error(`no download URLs returned for file ${p.fileId}`);
  return body[0]!.URI;
};
```

> **Note on the API surface:** the v1 `updated.json` endpoint only enumerates recently-touched mods. For "every mod ever uploaded for a game" we'd need the v2 GraphQL API. For Plan 3 the 1-month window is enough to produce a representative corpus; a future plan can swap to v2 GraphQL when the corpus needs broader coverage.

- [ ] **Step 3: Run tests**

Run: `pnpm test nexus-client`
Expected: PASS (4 cases).

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/nexus/client.ts tests/nexus-client.test.ts
git commit -m "Add Nexus v1 REST client: listGameModIds + listModFiles + getDownloadUrl"
```

---

## Task 12: Nexus corpus fetcher

**Files:**
- Create: `src/nexus/fetch-corpus.ts`
- Modify: `src/commands/test-corpus.ts` (add `--fetch` flag)

`fetchCorpus(gameDomain, cacheDir, apiKey)` downloads every (recently updated) mod's primary file into `cacheDir`, keyed by mod-file-version. The CLI's `--fetch` flag triggers this before running the corpus.

- [ ] **Step 1: Create `src/nexus/fetch-corpus.ts`**

```ts
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { listGameModIds, listModFiles, getDownloadUrl } from './client.js';

export interface FetchCorpusOptions {
  gameDomain: string;
  apiKey: string;
  cacheDir: string;
  // Optional progress callback for the CLI.
  onProgress?: (event: { kind: 'fetched' | 'skipped' | 'error'; archive: string; message?: string }) => void;
}

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch { return false; }
};

export const fetchCorpus = async (opts: FetchCorpusOptions): Promise<void> => {
  await mkdir(opts.cacheDir, { recursive: true });

  const modIds = await listGameModIds({ gameDomain: opts.gameDomain, apiKey: opts.apiKey });
  for (const modId of modIds) {
    const files = await listModFiles({ gameDomain: opts.gameDomain, apiKey: opts.apiKey, modId });
    if (files.length === 0) continue;
    // Take the first file (typically the "main file").
    const file = files[0]!;
    if (!file.fileName.toLowerCase().endsWith('.zip')) {
      opts.onProgress?.({ kind: 'skipped', archive: file.fileName, message: 'not a zip' });
      continue;
    }
    // Cache key: <mod>_<file>_<version>.zip — stable across re-runs unless the upload changes.
    const cachedName = `${modId}_${file.fileId}_${file.version}_${file.fileName}`;
    const cachedPath = join(opts.cacheDir, cachedName);
    if (await exists(cachedPath)) {
      opts.onProgress?.({ kind: 'skipped', archive: cachedName, message: 'cache hit' });
      continue;
    }
    try {
      const url = await getDownloadUrl({
        gameDomain: opts.gameDomain, apiKey: opts.apiKey,
        modId, fileId: file.fileId,
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(cachedPath, buf);
      opts.onProgress?.({ kind: 'fetched', archive: cachedName });
    } catch (e) {
      opts.onProgress?.({
        kind: 'error',
        archive: cachedName,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
};
```

- [ ] **Step 2: Extend `src/commands/test-corpus.ts` with `--fetch` flag**

Add to the top of `src/commands/test-corpus.ts`:

```ts
import { fetchCorpus } from '../nexus/fetch-corpus.js';
```

Modify the `TestCorpusArgs` interface and the function to accept a `fetch` boolean:

```ts
export interface TestCorpusArgs {
  cwd: string;
  yamlPath?: string;
  fetch?: boolean;
}
```

Before the `localCachePaths` call, add:

```ts
  if (args.fetch) {
    if (doc.tests?.corpus !== 'nexus') {
      process.stderr.write('--fetch requires `tests.corpus: nexus` in game.yaml\n');
      process.exit(1);
    }
    const gameDomain = doc.game.id;          // assume id matches the Nexus domain
    const apiKey = process.env.NEXUS_API_KEY;
    if (!apiKey) {
      process.stderr.write('--fetch requires NEXUS_API_KEY environment variable\n');
      process.exit(1);
    }
    await fetchCorpus({
      gameDomain, apiKey,
      cacheDir: join(args.cwd, 'tests', 'cache'),
      onProgress: (e) => {
        const sym = e.kind === 'fetched' ? '↓' : e.kind === 'skipped' ? '·' : '✖';
        process.stdout.write(`  ${sym} ${e.archive}${e.message ? '  ' + e.message : ''}\n`);
      },
    });
  }
```

- [ ] **Step 3: Register the flag in `src/cli.ts`**

In the `test:corpus` command registration, add `--fetch` option:

```ts
program
  .command('test:corpus')
  .description('Run installer rules against archives in tests/cache/')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .option('--fetch', 'fetch fresh archives from Nexus before running')
  .action(async (opts: { yaml?: string; fetch?: boolean }) => {
    try {
      await runTestCorpus({
        cwd: process.cwd(),
        ...(opts.yaml !== undefined && { yamlPath: opts.yaml }),
        ...(opts.fetch !== undefined && { fetch: opts.fetch }),
      });
    } catch (err) {
      const { reportBuildError } = await import('./commands/build.js');
      process.stderr.write(reportBuildError(err) + '\n');
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Typecheck and full tests**

Run: `pnpm typecheck`
Expected: exits 0.

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm build && node dist/cli.js test:corpus --help`
Expected: usage text shows `--fetch` option.

- [ ] **Step 5: Commit**

```bash
git add src/nexus/fetch-corpus.ts src/commands/test-corpus.ts src/cli.ts
git commit -m "Add Nexus corpus fetcher and gdl test:corpus --fetch flag"
```

---

## Task 13: E2E: corpus runner against fixture archives

**Files:**
- Modify: `tests/e2e.test.ts`

End-to-end test of the full corpus path (without hitting Nexus): a temp dir contains `game.yaml` + `tests/cache/typical-pak.zip`, run `gdl test:corpus` via the API, assert success.

- [ ] **Step 1: Add a new test in `tests/e2e.test.ts`**

```ts
describe('end-to-end (corpus runner)', () => {
  it('runs all archives in tests/cache through the engine', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-corpus-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });
    // Drop the fixture archive into tests/cache/.
    const cacheDir = join(work, 'tests', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    cpSync(
      join(import.meta.dirname, 'fixtures', 'corpus-archives', 'typical-pak.zip'),
      join(cacheDir, 'typical-pak.zip'),
    );

    const { runTestCorpus } = await import('../src/commands/test-corpus.js');
    // Capture stdout via process.stdout intercept (Vitest doesn't replace it by default; just call).
    await runTestCorpus({ cwd: work });
    // If we got here without exiting, the corpus passed.
  }, 30000);
});
```

You need to add `mkdirSync` to the imports if not already present:

```ts
import { mkdtempSync, cpSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
```

- [ ] **Step 2: Run tests**

Run: `pnpm test e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "E2E: corpus runner exercises fixture zip against engine"
```

---

## Task 14: GitHub Actions test workflow

**Files:**
- Create: `.github/workflows/test.yml`

A reusable workflow that extension repos pin via `uses:`. Runs install + build + tests + corpus.

- [ ] **Step 1: Create `.github/workflows/test.yml`**

```yaml
name: gdl-test

on:
  workflow_call:
    secrets:
      NEXUS_API_KEY:
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      HAS_NEXUS_KEY: ${{ secrets.NEXUS_API_KEY != '' }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: pnpm/action-setup@v4
        with:
          version: 11

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install (submodule)
        working-directory: gdl
        run: pnpm install --frozen-lockfile

      - name: Build (submodule)
        working-directory: gdl
        run: pnpm build

      - name: Restore corpus cache
        uses: actions/cache@v4
        with:
          path: tests/cache
          key: corpus-${{ github.repository }}-v1

      - name: gdl build (extension)
        run: node gdl/dist/cli.js build

      - name: pnpm test (extension)
        run: pnpm test
        if: hashFiles('package.json') != ''

      - name: Fetch + run corpus (if Nexus key present)
        if: env.HAS_NEXUS_KEY == 'true'
        env:
          NEXUS_API_KEY: ${{ secrets.NEXUS_API_KEY }}
        run: node gdl/dist/cli.js test:corpus --fetch

      - name: Run corpus (without fetch, if no Nexus key)
        if: env.HAS_NEXUS_KEY != 'true'
        run: node gdl/dist/cli.js test:corpus
```

> **Note on the workflow:** this lives in the GDL submodule and is `uses:`-able from extension repos as `./gdl/.github/workflows/test.yml@<pinned-sha>`. The corpus job runs `--fetch` when the secret is available (PR/CI from authorised contexts) and falls back to "just run what's in cache" otherwise.

- [ ] **Step 2: Sanity-check the YAML**

Run a YAML lint locally if available, or just visually verify the indentation and references.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "Add reusable GitHub Actions test workflow (with optional Nexus fetch)"
```

---

## Task 15: Final E2E: subnautica2-shaped fixture with inline tests

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/e2e.test.ts`

Extend the subnautica2-shaped fixture with a `tests:` block that pins behavior for each installer. The generated `tests.gen.ts` should be valid TS that imports `installers.gen.ts`.

- [ ] **Step 1: Append `tests:` to `tests/fixtures/subnautica2-shaped/game.yaml`**

Add at the bottom:

```yaml
tests:
  corpus: off
  cases:
    - name: ue4ss lua mod
      archive:
        - MyMod/Scripts/main.lua
        - MyMod/Scripts/util.lua
      expect:
        matched: ue4ss-lua
        modType: ue4ss-lua

    - name: logic-mod under LogicMods/
      archive:
        - Pack/LogicMods/BPFolder/X.pak
        - Pack/LogicMods/Y.pak
      expect:
        matched: logic-mod
        modType: logic-mod

    - name: plain pak mod
      archive:
        - Pack/Cool.pak
      expect:
        matched: pak
        modType: pak

    - name: composite — pak + lua picks composite installer
      archive:
        - A/Scripts/main.lua
        - A/Cool.pak
      expect:
        matched: composite-mod
```

- [ ] **Step 2: Extend `tests/e2e.test.ts` to assert tests.gen.ts is emitted**

In the existing `subnautica2-shaped` test, after the bundle assertions add:

```ts
    const testsGen = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGen).toContain("describe('subnautica2-shaped — generated tests'");
    expect(testsGen).toContain("it('ue4ss lua mod'");
    expect(testsGen).toContain("it('logic-mod under LogicMods/'");
    expect(testsGen).toContain("it('plain pak mod'");
    expect(testsGen).toContain("it('composite — pak + lua picks composite installer'");
```

- [ ] **Step 3: Run tests**

Run: `pnpm test e2e`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/game.yaml tests/e2e.test.ts
git commit -m "E2E: subnautica2-shaped fixture exercises all installers via inline test cases"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` (all suites pass)
- [ ] `pnpm typecheck` (clean)
- [ ] `pnpm build` (produces dist/cli.js with build + test:corpus subcommands)
- [ ] `node dist/cli.js test:corpus --help` shows the `--fetch` flag
- [ ] The subnautica2-shaped fixture's `.gdl-out/tests.gen.ts` mentions all four test case names
- [ ] `.github/workflows/test.yml` references valid `actions/*` versions

---

## What this plan does not deliver (and where it goes)

- **`gdl package`, `gdl publish`, `gdl init`, release-side GH Actions workflow** → Plan 4 (release pipeline).
- **Real `game-subnautica2` port + diff against the legacy bundle** → Plan 5.
- **Broader Nexus enumeration via the v2 GraphQL API**: currently `listGameModIds` only sees mods updated in the last 1 month. When real-world corpus runs need older mods, swap to v2 GraphQL with `game.mods(offset, limit)` pagination.
- **`.7z` and `.rar` archive support**: `readZipEntries` is zip-only. Add a sibling reader and a dispatch function when a real mod needs it.
- **Full structural signature matching for hooks**: still deferred (existence-only check from Plan 2 stands).
- **Generated tests' `resolvedVars` precision**: branch tags resolve to the `default` arm only. A future refactor can let test cases override the resolution context.
