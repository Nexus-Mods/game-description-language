# GDL Toolbar Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gap #7 from `docs/superpowers/gaps.md`: let `game.yaml` declare toolbar actions that Vortex renders next to the game's mod list. MVP supports two action kinds — `!openFile <template>` and `!openUrl <template>` — both of which interpolate against the resolved context. Each action shows only when the GDL-registered game is the active one in Vortex.

**Architecture:** New `toolbarActions:` top-level block in `game.yaml`. The parser recognises `!openFile`/`!openUrl` value tags. The shim grows `registerToolbarAction` that wraps Vortex's `context.registerAction('mod-icons', ...)`. At click time, the registered callback reads the resolved context and interpolates the path/URL template, then opens it via `util.opn` (the standard Vortex helper for both files and URLs).

**Tech Stack:** Existing Plans 1–4 stack. No new dependencies.

**Spec reference:** `docs/superpowers/gaps.md` item 7 (UI / toolbar actions).

---

## File structure (delta from Plan 4)

```
game-description-language/
├── src/
│   ├── parser/
│   │   ├── ast.ts                                # +ToolbarActionNode, +ToolbarActionKind
│   │   ├── tags.ts                               # +!openFile, +!openUrl
│   │   └── index.ts                              # +parse toolbarActions
│   ├── schema/
│   │   └── validator.ts                          # +validate toolbar actions
│   ├── runtime/
│   │   └── vortex-shim.ts                        # +registerToolbarAction
│   ├── codegen/
│   │   └── emit.ts                               # +emit toolbar registrations
│   └── types/
│       └── vortex-api.d.ts                       # +registerAction, +util.opn
└── tests/
    ├── parser.test.ts                            # +toolbar action parsing
    ├── validator.test.ts                         # +toolbar action validation
    ├── codegen.test.ts                           # +toolbar emit
    └── fixtures/
        ├── with-toolbar/                (new)    # YAML with toolbar actions
        ├── subnautica2-shaped/game.yaml          # +toolbar actions
        └── e2e/game.yaml                         # +one toolbar action
```

---

## Task 1: ToolbarAction AST nodes

**Files:**
- Modify: `src/parser/ast.ts`

Add the AST types. No parser changes yet.

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
  nexus?: NexusNode;
  toolbarActions?: ToolbarActionNode[];
}
```

Add the new types at the bottom:

```ts
// Toolbar action — declarative UI for opening a file or URL from Vortex's mod-icons toolbar.
export type ToolbarActionTarget =
  | { kind: 'openFile'; template: string }       // path template, interpolated against context
  | { kind: 'openUrl';  template: string };      // URL template, interpolated against context

export interface ToolbarActionNode extends Node {
  kind: 'toolbarAction';
  id: string;            // stable id (kebab-case)
  title: string;         // human-readable label
  priority: number;      // ordering (Vortex shows lower values earlier)
  target: ToolbarActionTarget;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 100 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/parser/ast.ts
git commit -m "Add ToolbarActionNode AST type"
```

---

## Task 2: Parser tags + toolbar actions block

**Files:**
- Modify: `src/parser/tags.ts`
- Modify: `src/parser/index.ts`
- Create: `tests/fixtures/with-toolbar/game.yaml`
- Modify: `tests/parser.test.ts`

Register `!openFile` and `!openUrl` as scalar-tagged values. Parse the `toolbarActions:` top-level array.

- [ ] **Step 1: Extend `src/parser/tags.ts`**

Add to the existing `customTags` array:

```ts
  // Action target tags — applied to scalar strings, carry the template through the YAML parser.
  { tag: '!openFile', resolve: (value: unknown) => value },
  { tag: '!openUrl',  resolve: (value: unknown) => value },
```

Also export the names as constants for the parser's tag-detection path:

```ts
export const TOOLBAR_ACTION_TARGET_TAG_NAMES: ReadonlySet<string> =
  new Set(['!openFile', '!openUrl']);
```

- [ ] **Step 2: Create `tests/fixtures/with-toolbar/game.yaml`**

```yaml
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: ${installPath}/Mods
toolbarActions:
  - id: open-settings
    title: Open Settings
    priority: 200
    target: !openFile "${modsRoot}/settings.ini"

  - id: open-website
    title: Open Website
    priority: 201
    target: !openUrl https://example.com/${gameId}
```

> Note: `${gameId}` isn't defined in the context; this is intentional. The test only checks that parsing handles the template; resolution happens at runtime where unbound vars surface as errors. (For real usage, the author would add `gameId` to context bindings.)

- [ ] **Step 3: Failing test in `tests/parser.test.ts`**

Append inside `describe('parseYaml')`:

```ts
  it('parses toolbarActions with !openFile and !openUrl', () => {
    const doc = parseYaml(fixture('with-toolbar/game.yaml'), 'with-toolbar/game.yaml');
    expect(doc.toolbarActions).toHaveLength(2);
    const [a, b] = doc.toolbarActions!;
    expect(a!.id).toBe('open-settings');
    expect(a!.title).toBe('Open Settings');
    expect(a!.priority).toBe(200);
    expect(a!.target).toEqual({ kind: 'openFile', template: '${modsRoot}/settings.ini' });
    expect(b!.target).toEqual({ kind: 'openUrl', template: 'https://example.com/${gameId}' });
  });
```

Run: `pnpm test parser`
Expected: FAIL — `doc.toolbarActions` undefined.

- [ ] **Step 4: Extend `src/parser/index.ts`**

Add to the type imports from `./ast.js`:

```ts
import type {
  // ... existing imports ...
  ToolbarActionNode, ToolbarActionTarget,
} from './ast.js';
```

Add a helper above `parseYaml`:

```ts
const parseToolbarActionTarget = (node: YamlNode, file: string, source: string): ToolbarActionTarget => {
  const span = spanOf(file, source, node);
  if (isScalar(node) && typeof node.value === 'string') {
    const tag = typeof node.tag === 'string' ? node.tag : '';
    if (tag === '!openFile') return { kind: 'openFile', template: node.value };
    if (tag === '!openUrl')  return { kind: 'openUrl',  template: node.value };
  }
  throw new BuildErrors([{
    code: 'GDL140',
    message: 'toolbar action `target:` must be `!openFile <path>` or `!openUrl <url>`',
    span,
  }]);
};
```

After the nexus block parsing (before the return literal), add toolbar actions:

```ts
const toolbarYaml = root.get('toolbarActions', true);
let toolbarActions: ToolbarActionNode[] | undefined;
if (isSeq(toolbarYaml)) {
  toolbarActions = [];
  for (const entry of toolbarYaml.items) {
    if (!isMap(entry)) {
      throw new BuildErrors([{
        code: 'GDL141',
        message: 'toolbarActions entries must be mappings',
        span: spanOf(file, source, entry as YamlNode),
      }]);
    }
    toolbarActions.push({
      kind: 'toolbarAction',
      id:       String(entry.get('id') ?? ''),
      title:    String(entry.get('title') ?? ''),
      priority: Number(entry.get('priority') ?? 100),
      target:   parseToolbarActionTarget(entry.get('target', true) as YamlNode, file, source),
      span:     spanOf(file, source, entry),
    });
  }
}
```

Add to the return literal (conditional spread):

```ts
...(toolbarActions !== undefined && { toolbarActions }),
```

- [ ] **Step 5: Run tests**

Run: `pnpm test parser`
Expected: PASS.

Run: `pnpm test`
Expected: 101 tests pass (100 + 1 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/parser/ tests/parser.test.ts tests/fixtures/with-toolbar/
git commit -m "Parse toolbarActions block with !openFile and !openUrl"
```

---

## Task 3: Validator — toolbar actions

**Files:**
- Modify: `src/schema/validator.ts`
- Modify: `tests/validator.test.ts`

- [ ] **Step 1: Failing tests in `tests/validator.test.ts`**

Append inside `describe('validate')`:

```ts
  it('rejects toolbar action with empty title', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - id: x
    title: ""
    priority: 100
    target: !openUrl https://x
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL142')).toBe(true);
  });

  it('rejects duplicate toolbar action ids', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - { id: dup, title: A, priority: 100, target: !openUrl https://a }
  - { id: dup, title: B, priority: 101, target: !openUrl https://b }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL143')).toBe(true);
  });

  it('rejects malformed toolbar action id', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - { id: "Bad Id", title: A, priority: 100, target: !openUrl https://a }
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL144')).toBe(true);
  });
```

Run: `pnpm test validator`
Expected: FAIL.

- [ ] **Step 2: Extend `src/schema/validator.ts`**

After the `if (doc.nexus) { ... }` block, before `return errors;`, add:

```ts
if (doc.toolbarActions) {
  const seen = new Set<string>();
  for (const action of doc.toolbarActions) {
    if (!ID_PATTERN.test(action.id)) {
      errors.push({
        code: 'GDL144',
        message: `toolbarAction.id \`${action.id}\` must match ${ID_PATTERN}`,
        span: action.span,
      });
    }
    if (seen.has(action.id)) {
      errors.push({
        code: 'GDL143',
        message: `duplicate toolbarAction id \`${action.id}\``,
        span: action.span,
      });
    }
    seen.add(action.id);
    if (!action.title.trim()) {
      errors.push({
        code: 'GDL142',
        message: 'toolbarAction.title is required',
        span: action.span,
      });
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test validator`
Expected: PASS.

Run: `pnpm test`
Expected: 104 tests pass (101 + 3).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/schema/validator.ts tests/validator.test.ts
git commit -m "Validate toolbar actions: id pattern, title required, no duplicates"
```

---

## Task 4: Extend vortex-api.d.ts with `registerAction` + `util.opn`

**Files:**
- Modify: `src/types/vortex-api.d.ts`

Add the Vortex API surfaces the shim will call.

- [ ] **Step 1: Extend `src/types/vortex-api.d.ts`**

Inside the `declare module 'vortex-api'` block, add:

```ts
  // Visibility predicate runs every render frame; return false to hide.
  export type ActionVisibilityFn = (instanceIds?: string[]) => boolean;

  // Click handler. Vortex passes instanceIds when the action is bound to a list row;
  // for the mod-icons toolbar the array is empty.
  export type ActionRunFn = (instanceIds?: string[]) => void;
```

Extend the `IExtensionContext` interface to add `registerAction`:

```ts
  export interface IExtensionContext {
    registerGame: (game: IGame) => void;
    registerModType: ( /* existing */
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
    registerAction: (
      group: string,                  // typically 'mod-icons'
      position: number,
      iconOrComponent: string,        // typically 'open-ext' for the open-file/url glyph
      options: Record<string, unknown>,
      titleOrProps: string,
      action: ActionRunFn,
      condition?: ActionVisibilityFn,
    ) => void;
  }
```

Add a `util` namespace export at the bottom (Vortex's standard pattern):

```ts
  export const util: {
    opn: (target: string) => Promise<void>;
    // ... existing util fields (if any)
  };

  // Vortex selectors — needed for the "is this game active" visibility predicate.
  export const selectors: {
    activeGameId: (state: unknown) => string | undefined;
  };
```

> **Note:** if `util` or `selectors` are already declared elsewhere in the file (from earlier tasks), extend the existing block rather than re-declaring.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 104 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/types/vortex-api.d.ts
git commit -m "Vortex-api types: registerAction, util.opn, selectors.activeGameId"
```

---

## Task 5: Runtime shim — `registerToolbarAction`

**Files:**
- Modify: `src/runtime/vortex-shim.ts`

Add a new method `registerToolbarActions` to `GdlRuntime` that takes a list of declarations and registers each with Vortex.

- [ ] **Step 1: Extend `src/runtime/vortex-shim.ts`**

Add the imports:

```ts
import type { ActionVisibilityFn, ActionRunFn } from 'vortex-api';
import { interpolate } from './interpolate.js';
```

Add the new declaration interface:

```ts
export interface ToolbarActionDecl {
  id: string;
  title: string;
  priority: number;
  target:
    | { kind: 'openFile'; template: string }
    | { kind: 'openUrl';  template: string };
}
```

Modify the `registerGame` method's signature to accept a `toolbarActions` parameter:

```ts
  registerGame(
    decl: GameDecl,
    stores: StoreDecl[],
    contextSpec: ContextSpec,
    modTypes: ModTypeDecl[],
    installers: InstallerRule[] = [],
    discovery: { versionHook?: (ctx: DiscoveryFacts) => Promise<string | null> } = {},
    toolbarActions: ToolbarActionDecl[] = [],
  ) {
```

After the installer-registration loop (and before the method ends), add:

```ts
    for (const action of toolbarActions) {
      this.registerToolbarAction(decl.id, action);
    }
```

Add the helper method (private, alongside `registerInstallerRule`):

```ts
  private registerToolbarAction(gameId: string, action: ToolbarActionDecl): void {
    // Lazy import vortex-api so unit tests don't need it on disk.
    const isThisGameActive: ActionVisibilityFn = () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { selectors } = require('vortex-api') as typeof import('vortex-api');
        // Walk up via the api's getState if available — fallback to the runtime's stored state isn't
        // accessible from here, so we use a global API reference via the registered game's queryPath.
        const state = (globalThis as { __vortexApi?: { getState?: () => unknown } }).__vortexApi?.getState?.();
        if (!state) return true;   // visibility errs on the side of showing
        return selectors.activeGameId(state) === gameId;
      } catch {
        return true;
      }
    };

    const run: ActionRunFn = () => {
      const ctx = this.resolvedCtx ?? {};
      try {
        const target =
          action.target.kind === 'openFile'
            ? interpolate(action.target.template, ctx)
            : interpolate(action.target.template, ctx);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { util } = require('vortex-api') as typeof import('vortex-api');
        void util.opn(target);
      } catch (err) {
        // Swallow — toolbar action failures shouldn't crash Vortex.
        // eslint-disable-next-line no-console
        console.error(`gdl toolbar action ${action.id} failed:`, err);
      }
    };

    this.api.registerAction(
      'mod-icons',
      action.priority,
      'open-ext',
      {},
      action.title,
      run,
      isThisGameActive,
    );
  }
```

> **Note on the visibility approach:** the legacy subnautica2 extension reads `context.api.getState()` directly to check the active game. The shim doesn't have a direct reference to `context.api` outside of construction. The simplest robust fix is to store `this.api` (we already do) and add a small helper that reads state via the api. Use `this.api.getState?.()` if the API surface exists; otherwise fall back to `true` (show the action). The pattern above does the fallback via the globalThis trick because `IExtensionContext` doesn't expose `getState` in our vendored types; if you find it's cleaner to extend `IExtensionContext` to include `getState`, do so.

**Cleaner alternative for the visibility predicate:** extend `IExtensionContext` in `vortex-api.d.ts` with `api: { getState: () => unknown }` and call `this.api.api.getState()` inside the predicate. If you take this path, update Task 4 accordingly and document the change in this task's commit message.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 104 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/vortex-shim.ts src/types/vortex-api.d.ts
git commit -m "Shim: registerToolbarAction wires open-file/open-url to Vortex mod-icons"
```

---

## Task 6: Codegen — emit toolbar action registrations

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `tests/codegen.test.ts`

Emit toolbar actions in the generated `extension.ts`, passing them as the new 7th argument to `runtime.registerGame`.

- [ ] **Step 1: Failing test in `tests/codegen.test.ts`**

Add a new `describe` block:

```ts
describe('emit toolbar actions', () => {
  const TINY = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
toolbarActions:
  - id: open-settings
    title: Open Settings
    priority: 200
    target: !openFile /games/Hello/settings.ini
  - id: open-website
    title: Open Website
    priority: 201
    target: !openUrl https://example.com/x
`;

  it('emits toolbar action registrations in extension.ts', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc);
    const ext = files.find(f => f.path === 'extension.ts')!;
    expect(ext.contents).toContain("id: 'open-settings'");
    expect(ext.contents).toContain("title: 'Open Settings'");
    expect(ext.contents).toContain("priority: 200");
    expect(ext.contents).toContain("kind: 'openFile'");
    expect(ext.contents).toContain("template: '/games/Hello/settings.ini'");
    expect(ext.contents).toContain("kind: 'openUrl'");
    expect(ext.contents).toContain("template: 'https://example.com/x'");
  });
});
```

Run: `pnpm test codegen`
Expected: FAIL.

- [ ] **Step 2: Extend `src/codegen/emit.ts`**

Add the AST type to the imports:

```ts
import type {
  // ... existing imports ...
  ToolbarActionNode,
} from '../parser/ast.js';
```

Add a render helper next to `renderInstaller`:

```ts
const renderToolbarAction = (a: ToolbarActionNode): string =>
  `{ id: ${sq(a.id)}, title: ${sq(a.title)}, priority: ${a.priority}, target: { kind: ${sq(a.target.kind)}, template: ${sq(a.target.template)} } }`;
```

Inside `emit()`, after the existing installers rendering block, add:

```ts
  const toolbarActions = (doc.toolbarActions ?? [])
    .map(a => `      ${renderToolbarAction(a)}`)
    .join(',\n');
```

Update the `registerGame` call in the extension template to add the toolbar actions as the 7th argument (after `{ versionHook }`). The exact change in the template string:

Find:
```
    {
      versionHook: ${versionHook},
    },
  );
```

Replace with:
```
    {
      versionHook: ${versionHook},
    },
    [
${toolbarActions}
    ],
  );
```

- [ ] **Step 3: Run tests**

Run: `pnpm test codegen`
Expected: PASS.

Run: `pnpm test`
Expected: 105 tests pass (104 + 1).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/codegen/emit.ts tests/codegen.test.ts
git commit -m "Emit toolbar action registrations in generated extension.ts"
```

---

## Task 7: E2E — subnautica2-shaped fixture with toolbar actions

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/e2e.test.ts`

Add three toolbar actions to the subnautica2-shaped fixture, mirroring the legacy extension's three actions.

- [ ] **Step 1: Append a `toolbarActions:` block to `tests/fixtures/subnautica2-shaped/game.yaml`**

Append (after the existing `tests:` block):

```yaml

toolbarActions:
  - id: open-ue4ss-settings
    title: Open UE4SS Settings INI
    priority: 200
    target: !openFile "${ue4ssModsRoot}/../UE4SS-settings.ini"

  - id: open-mods-txt
    title: Open UE4SS mods.txt
    priority: 201
    target: !openFile "${ue4ssModsRoot}/mods.txt"

  - id: open-nexus-page
    title: Open Nexus Page
    priority: 202
    target: !openUrl https://www.nexusmods.com/subnautica2
```

- [ ] **Step 2: Extend the subnautica2-shaped e2e test in `tests/e2e.test.ts`**

After the existing assertions in the subnautica2-shaped describe block, add:

```ts
    expect(bundle).toMatch(/registerAction/);
    expect(bundle).toMatch(/['"]open-ue4ss-settings['"]/);
    expect(bundle).toMatch(/['"]open-mods-txt['"]/);
    expect(bundle).toMatch(/['"]open-nexus-page['"]/);
```

- [ ] **Step 3: Run tests**

Run: `pnpm test e2e`
Expected: PASS.

Run: `pnpm test`
Expected: 105 tests pass.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/game.yaml tests/e2e.test.ts
git commit -m "E2E: subnautica2-shaped fixture exercises toolbar actions in the bundle"
```

---

## Task 8: Mark gap #7 as closed in `docs/superpowers/gaps.md`

**Files:**
- Modify: `docs/superpowers/gaps.md`

- [ ] **Step 1: Move item 7 from Open → Closed**

In `docs/superpowers/gaps.md`, delete the "UI / 7. Toolbar actions" section under "Open" and add to the "Closed" section:

```md
## Closed

### UI

7. **Toolbar actions.** Closed by Plan 6 (`2026-05-20-gdl-toolbar-actions.md`).
   YAML now supports `toolbarActions:` with `!openFile` and `!openUrl` targets;
   each action is registered on Vortex's `mod-icons` toolbar and is visible only
   when the GDL-registered game is the active one. Custom click handlers (via a
   future `!hook`) and other action groups (mods-list, gamemode-toolbar) are
   follow-up; the current surface covers the subnautica2 port's three actions.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/gaps.md
git commit -m "Close gap #7 (toolbar actions) — implemented in Plan 6"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` — all 105 tests pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm build` — produces dist/cli.js cleanly
- [ ] The subnautica2-shaped e2e fixture's bundle contains `registerAction` and the three action ids
- [ ] `docs/superpowers/gaps.md` has item 7 moved to "Closed"

---

## After this plan: update the subnautica2 port

Once Plan 6 lands on `gdl-mvp` and is pushed to `Nexus-Mods/game-description-language`, bump the subnautica2 port's submodule and add the toolbar actions to its `game.yaml`. That's a small follow-up, not part of this plan.

## What this plan does not deliver (and where it goes)

- **Custom click handlers via `!hook <id>`** — for the rare action that needs TS logic. Add when a real game needs it.
- **Other Vortex action groups** (mods-list, gamemode-toolbar). Add as needed.
- **Conditional visibility predicates** beyond "game-active." For example, "only show when a specific mod is installed." Add when a real game needs it.
- **Icon customization.** Currently all actions use the `'open-ext'` glyph. Add an optional `icon:` field when there's a reason.
