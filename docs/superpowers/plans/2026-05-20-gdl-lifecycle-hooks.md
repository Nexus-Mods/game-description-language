# GDL Lifecycle Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gaps #1 and #2 from `docs/superpowers/gaps.md` (setup hook + did-deploy event hook). Add a declarative `setup: { ensureDirs: [...] }` block that compiles into Vortex's `IGame.setup` callback, and an `events: { did-deploy: !hook ... }` block that wires `api.events.on('did-deploy', ...)` to a user-supplied TS hook.

**Architecture:** Two parallel additions, both small. The `setup` block is purely declarative; Vortex extensions overwhelmingly use the setup callback just to call `fs.ensureDirWritableAsync` for each mod root directory. The `events.did-deploy` block needs the TS escape hatch (`!hook`) because the handler logic is per-game (regenerate `mods.txt`, refresh metadata, etc.). The hook catalog gains a `didDeploy` signature alongside the existing `detectGameVersion`. The shim's `registerGame` takes two new args (`setupDirs: string[]` and `eventHooks: { didDeploy?: HookFn }`); codegen emits both. The fixture exercises both end-to-end.

**Tech Stack:** Existing stack. The shim adds a thin call to `util.fs.ensureDirWritableAsync` (a vortex-api helper, declared in `vortex-api.d.ts`).

**Spec reference:** `docs/superpowers/gaps.md` open items 1 (setup) and 2 (did-deploy).

---

## File structure (delta from Plan 9)

```
game-description-language/
├── src/
│   ├── parser/
│   │   ├── ast.ts                     # +SetupNode, +EventsNode on DocumentNode
│   │   └── index.ts                   # parse setup, events blocks
│   ├── schema/
│   │   └── validator.ts               # validate setup.ensureDirs entries; validate events keys
│   ├── runtime/
│   │   ├── hooks.ts                   # +didDeploy signature in HOOK_CATALOG
│   │   └── vortex-shim.ts             # +setupDirs, +eventHooks params in registerGame
│   ├── codegen/
│   │   └── emit.ts                    # emit setupDirs array + eventHooks object
│   └── types/
│       └── vortex-api.d.ts            # +util.fs.ensureDirWritableAsync, +api.events.on
└── tests/
    ├── parser.test.ts                 # +parse setup, events blocks
    ├── validator.test.ts              # +validate setup & events
    ├── hooks.test.ts                  # +didDeploy in catalog
    ├── codegen.test.ts                # +emit setup function + event listener
    ├── e2e.test.ts                    # +bundle assertions
    └── fixtures/
        ├── subnautica2-shaped/
        │   ├── game.yaml              # +setup, +events blocks
        │   └── hooks.ts               # +regenerateModsTxt hook
        └── with-setup-events/         (new)
            ├── game.yaml              # minimal setup+events fixture for unit tests
            └── hooks.ts
```

---

## Task 1: AST + parser: `setup: { ensureDirs: [...] }`

**Files:**
- Modify: `src/parser/ast.ts`
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`

`setup` is a simple block with one field today: `ensureDirs` is an array of string templates (interpolated against context).

- [ ] **Step 1: Extend `src/parser/ast.ts`**

Add to `DocumentNode` (alongside the existing optional fields):

```ts
export interface DocumentNode extends Node {
  // ... existing fields (kind, gdl, game, stores, context, modTypes, installers, discovery, tests, nexus, toolbarActions) ...
  setup?: SetupNode;
  events?: EventsNode;   // Task 2 adds this
}
```

Add the SetupNode interface (and stub the EventsNode for Task 2):

```ts
// Declarative setup-hook: tell Vortex to ensure these directories exist before the game is moddable.
export interface SetupNode extends Node {
  kind: 'setup';
  ensureDirs: string[];   // path templates, interpolated against context
}

// Wired in Task 2.
export interface EventsNode extends Node {
  kind: 'events';
  didDeploy?: HookRef;
}
```

`HookRef` already exists (from Plan 2's `!hook` machinery, used by `discovery.version`). Find its definition and confirm; if absent, use:

```ts
export interface HookRef {
  kind: 'hookRef';
  name: string;
  span: Span;
}
```

- [ ] **Step 2: Failing test in `tests/parser.test.ts`**

Append inside `describe('parseYaml')`:

```ts
  it('parses setup.ensureDirs', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  paksRoot:  \${installPath}/Mods/Paks
  logicRoot: \${installPath}/Mods/Logic
setup:
  ensureDirs:
    - \${paksRoot}
    - \${logicRoot}
`, 'inline.yaml');
    expect(doc.setup).toBeDefined();
    expect(doc.setup!.ensureDirs).toEqual(['${paksRoot}', '${logicRoot}']);
  });
```

Run: `pnpm test parser`
Expected: FAIL (`doc.setup` is undefined).

- [ ] **Step 3: Extend `src/parser/index.ts`**

Add the SetupNode import (alongside other AST type imports):

```ts
import type {
  // ... existing imports ...
  SetupNode,
} from './ast.js';
```

After the existing block parsing (after toolbarActions, before `nexus` or wherever the block order ends), add:

```ts
const setupYaml = root.get('setup', true);
let setup: SetupNode | undefined;
if (isMap(setupYaml)) {
  const ensureDirsYaml = setupYaml.get('ensureDirs', true);
  const dirs: string[] = [];
  if (isSeq(ensureDirsYaml)) {
    for (const item of ensureDirsYaml.items) {
      if (isScalar(item) && typeof item.value === 'string') {
        dirs.push(item.value);
      } else {
        throw new BuildErrors([{
          code: 'GDL150',
          message: 'setup.ensureDirs entries must be strings',
          span: spanOf(file, source, item as YamlNode),
        }]);
      }
    }
  }
  setup = {
    kind: 'setup',
    ensureDirs: dirs,
    span: spanOf(file, source, setupYaml),
  };
}
```

Add to the return literal (conditional spread):

```ts
...(setup !== undefined && { setup }),
```

- [ ] **Step 4: Run tests**

Run: `pnpm test parser`
Expected: PASS.

Run: `pnpm test`
Expected: 125 tests pass (124 + 1).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/parser/ast.ts src/parser/index.ts tests/parser.test.ts
git commit -m "Parse setup.ensureDirs block"
```

---

## Task 2: AST + parser + hook catalog: `events: { did-deploy: !hook ... }`

**Files:**
- Modify: `src/parser/ast.ts`
- Modify: `src/parser/index.ts`
- Modify: `src/runtime/hooks.ts`
- Modify: `tests/parser.test.ts`
- Modify: `tests/hooks.test.ts`

`events.did-deploy` carries a `!hook <name>` reference. The hook catalog grows a `didDeploy` entry with its signature.

- [ ] **Step 1: Confirm `EventsNode` already in `ast.ts`** (added in Task 1's stub)

The EventsNode added in Task 1 expects `didDeploy?: HookRef`. If `HookRef` doesn't exist yet (Plan 2 added it for `!hook` in discovery), find or add the type.

- [ ] **Step 2: Failing test in `tests/parser.test.ts`**

Append:

```ts
  it('parses events.did-deploy with !hook reference', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
events:
  did-deploy: !hook regenerateMetadata
`, 'inline.yaml');
    expect(doc.events).toBeDefined();
    expect(doc.events!.didDeploy).toBeDefined();
    expect(doc.events!.didDeploy!.kind).toBe('hookRef');
    expect(doc.events!.didDeploy!.name).toBe('regenerateMetadata');
  });
```

Run: `pnpm test parser`
Expected: FAIL.

- [ ] **Step 3: Extend `src/parser/index.ts`**

Add to the type imports:

```ts
import type {
  // ... existing imports ...
  EventsNode, HookRef,
} from './ast.js';
```

After the setup block parsing (Task 1), add:

```ts
const eventsYaml = root.get('events', true);
let events: EventsNode | undefined;
if (isMap(eventsYaml)) {
  const didDeployYaml = eventsYaml.get('did-deploy', true);
  let didDeploy: HookRef | undefined;
  if (didDeployYaml !== undefined && didDeployYaml !== null) {
    if (isScalar(didDeployYaml) && typeof didDeployYaml.tag === 'string' && didDeployYaml.tag === '!hook' && typeof didDeployYaml.value === 'string') {
      didDeploy = {
        kind: 'hookRef',
        name: didDeployYaml.value,
        span: spanOf(file, source, didDeployYaml),
      };
    } else {
      throw new BuildErrors([{
        code: 'GDL151',
        message: 'events.did-deploy must be a `!hook <name>` reference',
        span: spanOf(file, source, didDeployYaml as YamlNode),
      }]);
    }
  }
  events = {
    kind: 'events',
    ...(didDeploy !== undefined && { didDeploy }),
    span: spanOf(file, source, eventsYaml),
  };
}
```

Add to the return literal:

```ts
...(events !== undefined && { events }),
```

- [ ] **Step 4: Failing test for hook catalog in `tests/hooks.test.ts`**

Append:

```ts
  it('catalog declares didDeploy hook signature', () => {
    const sig = HOOK_CATALOG.didDeploy;
    expect(sig).toBeDefined();
    expect(sig.returnType).toBe('Promise<void>');
    expect(sig.paramType).toContain('profileId');
    expect(sig.paramType).toContain('deployment');
  });
```

Run: `pnpm test hooks`
Expected: FAIL (`HOOK_CATALOG.didDeploy` undefined).

- [ ] **Step 5: Add `didDeploy` to `HOOK_CATALOG` in `src/runtime/hooks.ts`**

Find the existing `HOOK_CATALOG` (it has one entry, `detectGameVersion`). Add a second entry:

```ts
export const HOOK_CATALOG = {
  detectGameVersion: {
    paramType: '{ gamePath: string }',
    returnType: 'Promise<string | null>',
  },
  didDeploy: {
    paramType: '{ profileId: string; deployment: unknown; api: unknown }',
    returnType: 'Promise<void>',
  },
} as const;
```

If `HOOK_CATALOG`'s shape uses interfaces or other definitions, follow the existing pattern. The exact field names may be `signature` / `argType`; match the existing catalog.

- [ ] **Step 6: Run tests**

Run: `pnpm test parser hooks`
Expected: PASS.

Run: `pnpm test`
Expected: 127 tests pass (125 + 2).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/parser/ast.ts src/parser/index.ts src/runtime/hooks.ts \
        tests/parser.test.ts tests/hooks.test.ts
git commit -m "Parse events.did-deploy + register didDeploy hook signature"
```

---

## Task 3: Validator: setup + events

**Files:**
- Modify: `src/schema/validator.ts`
- Modify: `tests/validator.test.ts`

Both blocks need minimal structural validation. The hook reference for didDeploy gets the same treatment as discovery.version's !hook: a deferred check (build-time, separate phase) confirms the function exists in `hooks.ts`.

- [ ] **Step 1: Failing tests in `tests/validator.test.ts`**

Append:

```ts
  it('rejects setup.ensureDirs with empty entry', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
setup:
  ensureDirs:
    - ""
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL152')).toBe(true);
  });

  it('accepts setup.ensureDirs with non-empty templates', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
setup:
  ensureDirs:
    - \${installPath}/Mods
`);
    const errors = validate(doc);
    expect(errors).toEqual([]);
  });

  it('accepts events.did-deploy with hook reference', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
events:
  did-deploy: !hook regenerateMetadata
`);
    const errors = validate(doc);
    expect(errors).toEqual([]);
  });
```

Run: `pnpm test validator`
Expected: FAIL (first test; empty entry not rejected).

- [ ] **Step 2: Extend `src/schema/validator.ts`**

After the existing top-level block checks (after the toolbarActions block if present), add:

```ts
if (doc.setup) {
  for (let i = 0; i < doc.setup.ensureDirs.length; i++) {
    if (doc.setup.ensureDirs[i]!.trim() === '') {
      errors.push({
        code: 'GDL152',
        message: `setup.ensureDirs[${i}] must not be empty`,
        span: doc.setup.span,
      });
    }
  }
}
// events.did-deploy structural check already done in parser; the hook-reference
// resolution check happens in the build step alongside discovery.version's hook.
```

- [ ] **Step 3: Run tests**

Run: `pnpm test validator`
Expected: PASS (all three new cases).

Run: `pnpm test`
Expected: 130 tests pass (127 + 3).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/schema/validator.ts tests/validator.test.ts
git commit -m "Validate setup.ensureDirs entries; allow events.did-deploy with !hook"
```

---

## Task 4: vortex-api.d.ts: `util.fs.ensureDirWritableAsync` + `api.events`

**Files:**
- Modify: `src/types/vortex-api.d.ts`

The shim's setup function will call `util.fs.ensureDirWritableAsync(path)`. The did-deploy listener calls `context.api.events.on('did-deploy', handler)`. Both need type declarations.

- [ ] **Step 1: Read the current `vortex-api.d.ts`**

Confirm what `util` already exports (Plan 6 added `util.opn`). Then extend.

- [ ] **Step 2: Extend `src/types/vortex-api.d.ts`**

Inside the `declare module 'vortex-api'` block, extend the `util` export to add `fs.ensureDirWritableAsync`:

```ts
  export const util: {
    opn: (target: string) => Promise<void>;
    fs: {
      ensureDirWritableAsync: (path: string) => Promise<void>;
    };
  };
```

If `util` is currently declared as a single-property object literal, MERGE rather than replacing: add the `fs` field alongside `opn`.

Extend the `IExtensionContext.api` field to add `events`:

```ts
  export interface IExtensionContext {
    // ... existing fields (registerGame, registerModType, registerInstaller, registerAction) ...
    api: {
      getState: () => unknown;
      events: {
        on: (event: string, handler: (...args: unknown[]) => void) => void;
      };
    };
  }
```

If `api` is already declared with just `getState`, extend it to add `events`.

- [ ] **Step 3: Extend the `IGame` interface with `setup`**

In the same file, find the `IGame` interface (used by `registerGame`). Add:

```ts
  export interface IGame {
    // ... existing fields ...
    setup?: (discovery: { gamePath?: string } | unknown) => Promise<void>;
  }
```

- [ ] **Step 4: Typecheck and test**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 130 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/vortex-api.d.ts
git commit -m "Vortex-api types: util.fs.ensureDirWritableAsync, api.events.on, IGame.setup"
```

---

## Task 5: Shim: `registerGame` accepts setup + event hooks

**Files:**
- Modify: `src/runtime/vortex-shim.ts`

`registerGame` gains two more parameters (8th: `setupDirs: string[]`; 9th: `eventHooks: { didDeploy?: HookFn }`). Inside the method, if `setupDirs` is non-empty, attach a `setup` function to the game decl before passing to `context.registerGame`. If `eventHooks.didDeploy` is provided, wire `context.api.events.on('did-deploy', ...)`.

- [ ] **Step 1: Read the current `vortex-shim.ts`**

Note the existing shape of `GdlRuntime.registerGame(decl, stores, contextSpec, modTypes, installers, discovery, toolbarActions)`. After Plan 9 this should match.

- [ ] **Step 2: Extend `registerGame` signature**

Add two new optional parameters at the end:

```ts
import type { IGame } from 'vortex-api';

export type DidDeployHook = (ctx: {
  profileId: string;
  deployment: unknown;
  api: unknown;
}) => Promise<void>;

export interface EventHooks {
  didDeploy?: DidDeployHook;
}

  registerGame(
    decl: GameDecl,
    stores: StoreDecl[],
    contextSpec: ContextSpec,
    modTypes: ModTypeDecl[],
    installers: InstallerRule[] = [],
    discovery: { versionHook?: (ctx: DiscoveryFacts) => Promise<string | null> } = {},
    toolbarActions: ToolbarActionDecl[] = [],
    setupDirs: string[] = [],
    eventHooks: EventHooks = {},
  ) {
    // ... existing body ...
```

- [ ] **Step 3: Build the game decl with setup function**

Currently the method likely builds an `IGame` literal like:

```ts
    const game: IGame = {
      id: decl.id,
      name: decl.name,
      // ... other fields ...
      queryPath: () => this.discover(stores).then(...),
    };
    this.api.registerGame(game);
```

Add a `setup` function when `setupDirs.length > 0`. Insert before `this.api.registerGame(game)`:

```ts
    if (setupDirs.length > 0) {
      game.setup = async () => {
        const { util } = await import('vortex-api');
        const ctx = this.resolvedCtx ?? {};
        for (const tpl of setupDirs) {
          const path = interpolate(tpl, ctx);
          await util.fs.ensureDirWritableAsync(path);
        }
      };
    }
```

- [ ] **Step 4: Wire the did-deploy listener**

After the `registerInstaller` and `registerToolbarAction` loops (and before the method ends), add:

```ts
    if (eventHooks.didDeploy) {
      const userHook = eventHooks.didDeploy;
      this.api.api.events.on('did-deploy', (...args: unknown[]) => {
        const [profileId, deployment] = args as [string, unknown];
        void userHook({ profileId, deployment, api: this.api.api });
      });
    }
```

- [ ] **Step 5: Typecheck and test**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 130 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/vortex-shim.ts
git commit -m "Shim: registerGame accepts setupDirs and event hooks (did-deploy)"
```

---

## Task 6: Codegen: emit setup + events arguments

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `tests/codegen.test.ts`

`emit()` currently builds the `runtime.registerGame(...)` call with 7 arguments (after Plan 6's toolbarActions). Extend to 9: add `setupDirs` as the 8th argument (string array literal), and `eventHooks` as the 9th (object literal with optional `didDeploy` referencing the imported hook).

- [ ] **Step 1: Failing tests in `tests/codegen.test.ts`**

Append:

```ts
describe('emit setup + events', () => {
  it('emits setupDirs array when setup.ensureDirs is present', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  paksRoot: \${installPath}/Mods/Paks
setup:
  ensureDirs:
    - \${paksRoot}
    - \${installPath}/Mods/Logic
`, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain("'${paksRoot}'");
    expect(ext.contents).toContain("'${installPath}/Mods/Logic'");
  });

  it('emits eventHooks.didDeploy as a reference to the imported hook', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
events:
  did-deploy: !hook regenerateMetadata
`, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toMatch(/import\s+\{\s*regenerateMetadata\s*\}\s+from\s+['"]\.\.\/hooks/);
    expect(ext.contents).toMatch(/didDeploy:\s*regenerateMetadata/);
  });

  it('emits empty setupDirs and empty eventHooks when neither block is present', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain('[]');   // setupDirs default
    expect(ext.contents).toContain('{}');   // eventHooks default
  });
});
```

Run: `pnpm test codegen`
Expected: FAIL (current emit doesn't include either argument).

- [ ] **Step 2: Extend `src/codegen/emit.ts`**

Locate the `registerGame` template (currently has 7 args after Plan 6). It looks like:

```ts
  runtime.registerGame(
    ${gameDecl},
    ${stores},
    ${contextSpec},
    ${modTypes},
    [
${installers}
    ],
    {
      versionHook: ${versionHook},
    },
    [
${toolbarActions}
    ],
  );
```

Extend with two more args (8th: setupDirs, 9th: eventHooks):

```ts
  runtime.registerGame(
    ${gameDecl},
    ${stores},
    ${contextSpec},
    ${modTypes},
    [
${installers}
    ],
    {
      versionHook: ${versionHook},
    },
    [
${toolbarActions}
    ],
    [
${setupDirs}
    ],
    {
${eventHooks}
    },
  );
```

Add the rendering for setupDirs (just before the existing toolbarActions rendering):

```ts
  const setupDirs = (doc.setup?.ensureDirs ?? [])
    .map(d => `      ${sq(d)}`)
    .join(',\n');
```

Add the rendering for eventHooks:

```ts
  const didDeployRef = doc.events?.didDeploy?.name;
  const eventHooks = didDeployRef
    ? `      didDeploy: ${didDeployRef}`
    : '';
```

Add the import for `didDeploy` hook in the import block if present. The codegen already imports hooks for `discovery.version`. Extend the same machinery to include `didDeploy`. Look for where `versionHook` import is emitted; add an analogous emission for `didDeploy`:

```ts
  const hookImports: string[] = [];
  if (doc.discovery?.version?.kind === 'hookRef') {
    hookImports.push(doc.discovery.version.name);
  }
  if (doc.events?.didDeploy) {
    hookImports.push(doc.events.didDeploy.name);
  }
  const hooksImportLine = hookImports.length
    ? `import { ${hookImports.join(', ')} } from '../hooks.js';`
    : '';
```

If the existing codegen has different shape for the hook import (e.g., a per-hook line), follow the existing pattern. The key requirement: when `events.did-deploy` is present, the generated `extension.ts` imports the named function from `../hooks.js`.

- [ ] **Step 3: Run tests**

Run: `pnpm test codegen`
Expected: PASS (3 new cases).

Run: `pnpm test`
Expected: 133 tests pass (130 + 3).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/codegen/emit.ts tests/codegen.test.ts
git commit -m "Codegen: emit setupDirs and eventHooks (did-deploy) in registerGame call"
```

---

## Task 7: E2E: subnautica2-shaped fixture exercises setup + events

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/fixtures/subnautica2-shaped/hooks.ts`
- Modify: `tests/e2e.test.ts`

Add a `setup.ensureDirs` block listing the three mod roots, and an `events.did-deploy: !hook regenerateModsTxt` hook. Add the corresponding `regenerateModsTxt` function to the fixture's `hooks.ts`.

- [ ] **Step 1: Modify `tests/fixtures/subnautica2-shaped/game.yaml`**

Add after the `discovery:` block (or wherever else fits the existing order):

```yaml
setup:
  ensureDirs:
    - ${paksRoot}
    - ${logicModsRoot}
    - ${ue4ssModsRoot}

events:
  did-deploy: !hook regenerateModsTxt
```

- [ ] **Step 2: Add the hook to `tests/fixtures/subnautica2-shaped/hooks.ts`**

The fixture already has a `detectGameVersion` hook (from Plan 2). Append:

```ts
export async function regenerateModsTxt(ctx: { profileId: string; deployment: unknown; api: unknown }): Promise<void> {
  // Fixture stub — real implementation would scan the UE4SS Mods folder and write mods.txt.
  void ctx;
}
```

- [ ] **Step 3: Extend the subnautica2-shaped e2e test in `tests/e2e.test.ts`**

After the existing bundle assertions add:

```ts
    expect(bundle).toMatch(/ensureDirWritableAsync/);
    expect(bundle).toMatch(/events\.on\(['"]did-deploy['"]/);
    expect(bundle).toMatch(/['"]regenerateModsTxt['"]/);
```

Note: `regenerateModsTxt` is the function name; the bundle should include it as a string reference (it gets bundled in). Adjust the regex if necessary (e.g., the function might appear directly without quotes if webpack inlines it).

- [ ] **Step 4: Run tests**

Run: `pnpm test e2e`
Expected: PASS.

Run: `pnpm test`
Expected: 133 tests still pass.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/ tests/e2e.test.ts
git commit -m "E2E: subnautica2-shaped fixture exercises setup.ensureDirs + did-deploy hook"
```

---

## Task 8: Close gaps in `docs/superpowers/gaps.md`

**Files:**
- Modify: `docs/superpowers/gaps.md`

After Plan 9 the Open section's items 1 and 2 are "Setup hook" and "did-deploy event hook." Move both to Closed under a new "Lifecycle hooks" subsection.

- [ ] **Step 1: Read the current `docs/superpowers/gaps.md`**

Confirm items 1 and 2 are the setup + did-deploy entries. The remaining open items after this plan should be items 3 (Xbox arch) and 4 (per-game-instance getPath).

- [ ] **Step 2: Move items 1 and 2 to Closed**

In the Open section, delete the "### Lifecycle hooks" subsection entirely (both items). Renumber the remaining open items so they stay 1..N contiguous (Xbox becomes 1, getPath becomes 2).

Add to the Closed section under a new "### Lifecycle hooks" subsection:

```md
### Lifecycle hooks

- **Setup hook (`prepareForModding`).** Closed by Plan 10
  (`2026-05-20-gdl-lifecycle-hooks.md`). YAML now supports a declarative
  `setup: { ensureDirs: [...] }` block. Each entry is a path template
  interpolated against the resolved context; the shim compiles them into
  Vortex's `IGame.setup` callback, which calls `util.fs.ensureDirWritableAsync`
  for each directory the first time the game is managed. Covers the
  overwhelmingly common case (just ensure mod dirs exist). For setup work
  beyond directory creation, a future `setup: { hook: !hook ... }` escape
  hatch can be added.

- **`did-deploy` event hook.** Closed by Plan 10. YAML now supports
  `events: { did-deploy: !hook <name> }`. The hook signature is added to
  the hook catalog (`didDeploy`). The shim registers a listener on
  `api.events.on('did-deploy', ...)` that wraps the user's hook with a
  context object `{ profileId, deployment, api }`. The subnautica2-shaped
  fixture exercises it end-to-end via a `regenerateModsTxt` stub.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/gaps.md
git commit -m "Close lifecycle-hook gaps (setup + did-deploy) — implemented in Plan 10"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` (133 tests pass)
- [ ] `pnpm typecheck` (clean)
- [ ] `pnpm build` (produces dist/cli.js)
- [ ] The subnautica2-shaped fixture's bundle contains `ensureDirWritableAsync`, `events.on('did-deploy'`, and `regenerateModsTxt`
- [ ] `docs/superpowers/gaps.md` has 2 open items left (Xbox arch in installers + per-instance getPath)

---

## After this plan: update the subnautica2 port

Once Plan 10 lands, bump the subnautica2 port's GDL submodule and:
1. Add `setup.ensureDirs` listing the three mod roots.
2. Add `events.did-deploy: !hook regenerateModsTxt` and implement the real `mods.txt` regeneration in the port's `hooks.ts`.

Small follow-up.

## What this plan does not deliver (and where it goes)

- **Other lifecycle events** (`will-deploy`, `gamemode-activated`, etc.): extend `EventsNode` when a real game needs them.
- **`setup: { hook: !hook ... }` escape hatch** for non-directory-creation setup logic. Add when a real game needs it.
- **Type-safe `deployment` parameter** in the didDeploy hook. Currently `unknown`; users cast if they need the structure. Future: import Vortex's `IDeploymentManifest` into the hook catalog.
