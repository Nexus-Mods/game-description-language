# GDL Final Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining two gaps in `docs/superpowers/gaps.md`: (1) installer-side arch handling, via a new `scope.stores: [...]` field that restricts an installer to specific stores, useful when a future game ships different markers per arch; (2) per-instance `getPath` re-evaluation, where the shim's modType getPath callback re-interpolates the path template on each call using the current game's `gamePath`, so re-discovery after a path change is reflected.

**Architecture:** Two independent additions, both small:
1. **`scope.stores`** is an optional array on installer rules. AST/parser accept it; the shim's installer dispatcher checks the current store against the scope before consulting the engine. The engine itself is unchanged; store-scoping is a game-state filter, not an archive-content filter.
2. **Lazy modType `getPath`** changes the shim from "compute path once at registerModType" to "compute on every call." The callback that Vortex invokes captures the path template (not the resolved string) and re-interpolates against a context that overrides `installPath` with the current game's `gamePath`.

**Tech Stack:** Existing stack. No new dependencies.

**Spec reference:** `docs/superpowers/gaps.md` open items 1 (Xbox/WinGDK arch) and 2 (per-instance getPath).

---

## File structure (delta from Plan 10)

```
game-description-language/
├── src/
│   ├── parser/
│   │   ├── ast.ts                     # +scope?: { stores?: string[] } on InstallerNode
│   │   └── index.ts                   # parse scope.stores
│   ├── runtime/
│   │   ├── installer-engine.ts        # +scope on InstallerRule (data only)
│   │   └── vortex-shim.ts             # filter by scope in installer wrapper; lazy getPath
│   └── codegen/
│       └── emit.ts                    # emit scope on installer
└── tests/
    ├── parser.test.ts                 # +parse scope.stores
    ├── codegen.test.ts                # +emit scope
    ├── vortex-shim.test.ts            # +scope filter, +lazy getPath
    ├── e2e.test.ts                    # +bundle assertions
    └── fixtures/
        └── subnautica2-shaped/game.yaml  # +Xbox-scoped placeholder installer demonstrating scope
```

---

## Task 1: AST + parser: `scope: { stores: [...] }` on installer rules

**Files:**
- Modify: `src/parser/ast.ts`
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`

`scope` is an optional object on installer rules with a single field `stores: string[]`. When omitted or empty, the installer runs for all stores (current behavior).

- [ ] **Step 1: Extend `InstallerNode` in `src/parser/ast.ts`**

Find the existing `InstallerNode` interface:

```ts
export interface InstallerNode extends Node {
  kind: 'installer';
  id: string;
  priority: number;
  when: PredicateNode;
  unless?: PredicateNode;
  single?: SingleInstallerForm;
  route?: RouteEntry[];
  modType?: string;
}
```

Add an optional `scope`:

```ts
export interface InstallerNode extends Node {
  kind: 'installer';
  id: string;
  priority: number;
  when: PredicateNode;
  unless?: PredicateNode;
  scope?: InstallerScope;
  single?: SingleInstallerForm;
  route?: RouteEntry[];
  modType?: string;
}

export interface InstallerScope {
  stores?: string[];
}
```

- [ ] **Step 2: Failing test in `tests/parser.test.ts`**

Append:

```ts
  it('parses installer with scope.stores', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: xbox-only
    priority: 30
    when: !hasFile "**/*.pak"
    scope:
      stores: [xbox]
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.scope).toBeDefined();
    expect(inst.scope!.stores).toEqual(['xbox']);
  });

  it('leaves installer.scope undefined when the YAML omits it', () => {
    const doc = parseYaml(`
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
    priority: 30
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    expect(doc.installers![0]!.scope).toBeUndefined();
  });
```

Run: `pnpm test parser`
Expected: FAIL (`inst.scope` undefined in the first case).

- [ ] **Step 3: Extend `src/parser/index.ts`**

Add `InstallerScope` to the AST type imports:

```ts
import type {
  // ... existing imports ...
  InstallerScope,
} from './ast.js';
```

Find the installer-entry parsing (inside `if (isSeq(installersYaml))`). After the `unless` parsing line, add:

```ts
const scopeYaml = entry.get('scope', true);
let scope: InstallerScope | undefined;
if (isMap(scopeYaml)) {
  const storesYaml = scopeYaml.get('stores', true);
  const stores: string[] = [];
  if (isSeq(storesYaml)) {
    for (const item of storesYaml.items) {
      if (isScalar(item) && typeof item.value === 'string') {
        stores.push(item.value);
      } else {
        throw new BuildErrors([{
          code: 'GDL160',
          message: 'installer.scope.stores entries must be strings',
          span: spanOf(file, source, item as YamlNode),
        }]);
      }
    }
  }
  scope = { ...(stores.length > 0 && { stores }) };
}
```

In the `installers.push({ ... })` object literal, add the conditional spread for `scope` alongside the others:

```ts
installers.push({
  kind: 'installer',
  id,
  priority,
  when,
  ...(unless !== undefined && { unless }),
  ...(scope  !== undefined && { scope }),
  ...(single !== undefined && { single }),
  ...(route  !== undefined && { route }),
  ...(modType !== undefined && { modType }),
  span: spanOf(file, source, entry),
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test parser`
Expected: PASS (both new cases).

Run: `pnpm test`
Expected: 136 tests pass (134 + 2 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/parser/ast.ts src/parser/index.ts tests/parser.test.ts
git commit -m "Parse installer scope.stores (per-store installer scoping)"
```

---

## Task 2: Runtime + shim: filter installers by scope.stores

**Files:**
- Modify: `src/runtime/installer-engine.ts`
- Modify: `src/runtime/vortex-shim.ts`
- Modify: `tests/vortex-shim.test.ts` (create if not present)

The engine type `InstallerRule` gains `scope?: { stores?: string[] }` as a data-carrying field; the engine itself doesn't filter on it (that's a game-state check, not an archive check). The shim's installer wrapper checks the current store before consulting the engine.

- [ ] **Step 1: Extend `InstallerRule` in `src/runtime/installer-engine.ts`**

Find:

```ts
export interface InstallerRule {
  id: string;
  priority: number;
  when: PredicateExpr;
  unless?: PredicateExpr;
  single?: SingleForm;
  route?: RouteEntry[];
  modType?: string;
}
```

Add `scope?`:

```ts
export interface InstallerRule {
  id: string;
  priority: number;
  when: PredicateExpr;
  unless?: PredicateExpr;
  scope?: { stores?: string[] };
  single?: SingleForm;
  route?: RouteEntry[];
  modType?: string;
}
```

No engine logic changes; `scope` is data-only here, the shim consumes it.

- [ ] **Step 2: Failing test in the shim**

Look for an existing `tests/vortex-shim.test.ts`. If it doesn't exist, create a minimal one. Add a focused unit test for scope filtering:

```ts
import { describe, it, expect, vi } from 'vitest';
import { GdlRuntime } from '../src/runtime/vortex-shim.js';
import type { IExtensionContext } from 'vortex-api';

describe('GdlRuntime — installer scope.stores filtering', () => {
  it('skips installer when current store is not in scope', async () => {
    const registerInstaller = vi.fn();
    const ctx: IExtensionContext = {
      registerGame: vi.fn(),
      registerModType: vi.fn(),
      registerInstaller,
      registerAction: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;
    const runtime = new GdlRuntime(ctx);
    runtime.setDiscoveredStore('steam');

    const rule = {
      id: 'xbox-only',
      priority: 30,
      when: { kind: 'hasFile' as const, glob: '**/*.pak' },
      scope: { stores: ['xbox'] },
      single: {
        anchor: { kind: 'glob' as const, pattern: '**/*.pak' },
        take: 'parent' as const,
        placeAt: '/dest',
      },
      modType: 'pak',
    };
    runtime.registerInstallerRulePublic('subnautica2', rule);

    const testFn = registerInstaller.mock.calls[0]![2];
    const result = await testFn(['Some/Mod/file.pak'], 'subnautica2');
    expect(result).toMatchObject({ supported: false });
  });

  it('runs installer when current store is in scope', async () => {
    const registerInstaller = vi.fn();
    const ctx: IExtensionContext = {
      registerGame: vi.fn(),
      registerModType: vi.fn(),
      registerInstaller,
      registerAction: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;
    const runtime = new GdlRuntime(ctx);
    runtime.setDiscoveredStore('xbox');

    const rule = {
      id: 'xbox-only',
      priority: 30,
      when: { kind: 'hasFile' as const, glob: '**/*.pak' },
      scope: { stores: ['xbox'] },
      single: {
        anchor: { kind: 'glob' as const, pattern: '**/*.pak' },
        take: 'parent' as const,
        placeAt: '/dest',
      },
      modType: 'pak',
    };
    runtime.registerInstallerRulePublic('subnautica2', rule);

    const testFn = registerInstaller.mock.calls[0]![2];
    const result = await testFn(['Some/Mod/file.pak'], 'subnautica2');
    expect(result).toMatchObject({ supported: true });
  });
});
```

> **Note:** the test calls `runtime.setDiscoveredStore(...)` and `runtime.registerInstallerRulePublic(...)`. These are test-only seams. The shim already has `registerInstallerRule` as a private method (see Task 2 of Plan 7). We need to expose a public version of it (or test via the full registerGame flow). The simplest path: add a test-only public method `registerInstallerRulePublic` that wraps the private one, or remove `private` and rely on convention. Pick whatever's least invasive. Same for `setDiscoveredStore`; we need a way to set the current store from tests; add a public setter or accept it as a registerGame arg.

Run: `pnpm test vortex-shim`
Expected: FAIL (methods don't exist yet).

- [ ] **Step 3: Update the shim**

In `src/runtime/vortex-shim.ts`:

**A. Track the discovered store on the runtime.** Add a private field and a setter (used internally after discovery completes):

```ts
  private discoveredStore: string | undefined;

  // Test-only seam (also used internally after discovery).
  setDiscoveredStore(store: string | undefined): void {
    this.discoveredStore = store;
  }
```

**B. Update the discover flow to set this field.** Find the existing `discover` method (it returns `DiscoveryFacts | null`). Where the result is computed, also set `this.discoveredStore = found.gameStoreId`. The setter is already called via:

```ts
this.setDiscoveredStore(found.gameStoreId);
```

Add that line right before the return statement of the success path inside `discover`.

**C. Update `registerInstallerRule` to filter by scope.** Find the private method that registers an installer (the one wrapped around `context.registerInstaller`). Inside the test/testSupported closure, add an early-return when scope.stores is set and doesn't include the current store. The test/testSupported function shape is roughly:

```ts
async (files, gameId) => {
  if (gameId !== expectedGameId) return { supported: false };
  // ... existing logic that calls engine ...
}
```

Change to:

```ts
async (files, gameId) => {
  if (gameId !== expectedGameId) return { supported: false };
  if (rule.scope?.stores && rule.scope.stores.length > 0) {
    if (!this.discoveredStore || !rule.scope.stores.includes(this.discoveredStore)) {
      return { supported: false };
    }
  }
  // ... existing logic ...
}
```

**D. Expose `registerInstallerRulePublic` for tests.** Below the private method, add:

```ts
  // Test-only seam: lets unit tests register a single rule without going through registerGame.
  registerInstallerRulePublic(gameId: string, rule: InstallerRule): void {
    this.registerInstallerRule(gameId, rule);
  }
```

If `registerInstallerRule` takes a different argument order, match it.

- [ ] **Step 4: Run tests**

Run: `pnpm test vortex-shim`
Expected: PASS (both new tests).

Run: `pnpm test`
Expected: 138 tests pass (136 + 2 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/installer-engine.ts src/runtime/vortex-shim.ts tests/vortex-shim.test.ts
git commit -m "Shim: filter installers by scope.stores against the discovered store"
```

---

## Task 3: Codegen: emit `scope` on installer rules

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `tests/codegen.test.ts`

`renderInstaller` builds the per-rule TS object literal. Add a `scope: { stores: [...] }` field when the installer has it.

- [ ] **Step 1: Failing test in `tests/codegen.test.ts`**

Add a new describe block:

```ts
describe('emit installer with scope', () => {
  it('emits scope.stores when set', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: xbox-only
    priority: 30
    when: !hasFile "**/*.pak"
    scope:
      stores: [xbox]
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).toMatch(/scope:\s*\{\s*stores:\s*\[\s*'xbox'\s*\]\s*\}/);
  });

  it('does not emit scope when the YAML omits it', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
modTypes:
  - { id: pak, name: Pak Mod, path: /a }
installers:
  - id: pak
    priority: 30
    when: !hasFile "**/*.pak"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).not.toMatch(/\bscope\s*:/);
  });
});
```

Run: `pnpm test codegen`
Expected: FAIL on the first new test (scope not emitted yet).

- [ ] **Step 2: Extend `renderInstaller` in `src/codegen/emit.ts`**

Find `renderInstaller`. It currently has a `parts: string[]` array. After the existing `if (inst.unless !== undefined)` block, add the analogous block for scope:

```ts
  if (inst.scope?.stores && inst.scope.stores.length > 0) {
    const storesLit = inst.scope.stores.map(s => sq(s)).join(', ');
    parts.push(`scope: { stores: [${storesLit}] }`);
  }
```

Place this between the existing `unless` and `single/route` handling.

- [ ] **Step 3: Run tests**

Run: `pnpm test codegen`
Expected: PASS (both new cases).

Run: `pnpm test`
Expected: 140 tests pass (138 + 2).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/codegen/emit.ts tests/codegen.test.ts
git commit -m "Codegen: emit scope.stores on installer rules when present"
```

---

## Task 4: Shim: lazy modType `getPath`

**Files:**
- Modify: `src/runtime/vortex-shim.ts`
- Modify: `tests/vortex-shim.test.ts`

Currently the shim's modType registration computes the path once at `registerModType` time (uses `this.resolvedCtx`). Change it: the callback Vortex invokes re-interpolates the path template each time, overriding `installPath` with the current game's `gamePath`.

- [ ] **Step 1: Failing test in `tests/vortex-shim.test.ts`**

Append:

```ts
describe('GdlRuntime — lazy modType getPath', () => {
  it('re-interpolates the modType path with the current game.gamePath', async () => {
    const registerModType = vi.fn();
    const ctx: IExtensionContext = {
      registerGame: vi.fn(),
      registerModType,
      registerInstaller: vi.fn(),
      registerAction: vi.fn(),
      api: { getState: () => ({}), events: { on: vi.fn() } },
    } as unknown as IExtensionContext;
    const runtime = new GdlRuntime(ctx);

    // resolvedCtx at registration time had installPath = "/initial".
    runtime.setResolvedCtxForTesting({ installPath: '/initial' });
    runtime.registerModTypePublic('pak', 'Paks (~mods)', '${installPath}/Mods/Paks');

    // Vortex calls registerModType with (id, priority, isSupported, getPath, test, options)
    const getPath = registerModType.mock.calls[0]![3];

    // First call with the initial game path matches the registration-time install.
    expect(getPath({ gamePath: '/initial' } as unknown)).toBe('/initial/Mods/Paks');

    // After re-discovery the game.gamePath changes — getPath must reflect it.
    expect(getPath({ gamePath: '/relocated' } as unknown)).toBe('/relocated/Mods/Paks');
  });
});
```

> **Note:** uses `setResolvedCtxForTesting` and `registerModTypePublic` as test-only seams. Add them like the ones from Task 2. The signature of `registerModTypePublic` should match the args used by the shim internally to register a modType.

Run: `pnpm test vortex-shim`
Expected: FAIL (`getPath` returns the value computed at registration time and doesn't pick up the new gamePath).

- [ ] **Step 2: Change the modType registration to lazy in `src/runtime/vortex-shim.ts`**

Find the part of `registerGame` (or a helper like `registerModTypeInternal`) that calls `this.api.registerModType(...)`. The current code probably looks like:

```ts
    for (const mt of modTypes) {
      const path = this.resolveModTypePath(mt);
      this.api.registerModType(
        mt.id,
        100,
        (gameId: string) => gameId === decl.id,
        () => path,
        async () => true,
        { name: mt.name },
      );
    }
```

Change the `getPath` arg to re-interpolate per call using the current game's `gamePath`:

```ts
    for (const mt of modTypes) {
      const template = mt.pathTemplate;  // store template, not resolved path
      this.api.registerModType(
        mt.id,
        100,
        (gameId: string) => gameId === decl.id,
        (game: { gamePath?: string } | unknown) => {
          const gamePath = (game as { gamePath?: string } | null)?.gamePath;
          const ctx = {
            ...this.resolvedCtx ?? {},
            ...(gamePath !== undefined && { installPath: gamePath }),
          };
          return interpolate(template, ctx);
        },
        async () => true,
        { name: mt.name },
      );
    }
```

If `ModTypeDecl` doesn't have `pathTemplate` (i.e., the path was already pre-interpolated), look at how it's currently shaped. The fix may require storing the original template alongside the resolved path. If the current `ModTypeDecl.path` is the template, use it directly.

- [ ] **Step 3: Add test seams**

```ts
  // Test-only seam.
  setResolvedCtxForTesting(ctx: Record<string, string>): void {
    this.resolvedCtx = ctx;
  }

  // Test-only seam: register a single mod type without going through registerGame.
  registerModTypePublic(id: string, name: string, pathTemplate: string): void {
    this.api.registerModType(
      id,
      100,
      () => true,
      (game: { gamePath?: string } | unknown) => {
        const gamePath = (game as { gamePath?: string } | null)?.gamePath;
        const ctx = {
          ...this.resolvedCtx ?? {},
          ...(gamePath !== undefined && { installPath: gamePath }),
        };
        return interpolate(pathTemplate, ctx);
      },
      async () => true,
      { name },
    );
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm test vortex-shim`
Expected: PASS (the new lazy-getPath test).

Run: `pnpm test`
Expected: 141 tests pass (140 + 1).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/vortex-shim.ts tests/vortex-shim.test.ts
git commit -m "Shim: modType getPath re-interpolates per call with current game.gamePath"
```

---

## Task 5: E2E: subnautica2-shaped fixture exercises scope

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/e2e.test.ts`

Add a placeholder Xbox-scoped installer to demonstrate the scope feature flows through to the bundle. (No new test case for runtime; Task 2's unit tests cover that. This is just an end-to-end smoke test that the YAML + codegen + bundling work.)

- [ ] **Step 1: Modify `tests/fixtures/subnautica2-shaped/game.yaml`**

Add a placeholder installer at the bottom of the `installers:` list:

```yaml
  - id: xbox-injector-placeholder
    priority: 16
    when:    !hasFile "**/xinput1_4.dll"
    scope:
      stores: [xbox]
    anchor:  "**/xinput1_4.dll"
    take:    parent
    placeAt: "${ue4ssInjectorRoot}"
    modType: ue4ss-injector
```

> **Reasoning:** This installer is conceptually "Xbox-only UE4SS injector" (fictional, but demonstrates the syntax). When running on Steam/Epic, the shim's scope filter would skip it (lower priority than the generic `ue4ss-injector` at 15 means the generic one wins first anyway, but the scope filter still applies as a defense-in-depth).

- [ ] **Step 2: Extend the subnautica2-shaped e2e test**

Find the subnautica2-shaped describe block. After the existing assertions add:

```ts
    expect(bundle).toMatch(/['"]xbox-injector-placeholder['"]/);
    expect(bundle).toMatch(/scope:\s*\{\s*stores:\s*\[\s*['"]xbox['"]\s*\]\s*\}/);
```

- [ ] **Step 3: Run tests**

Run: `pnpm test e2e`
Expected: PASS.

Run: `pnpm test`
Expected: 141 tests still pass.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/game.yaml tests/e2e.test.ts
git commit -m "E2E: subnautica2-shaped fixture exercises scope.stores on an installer"
```

---

## Task 6: Close the last two gaps in `docs/superpowers/gaps.md`

**Files:**
- Modify: `docs/superpowers/gaps.md`

After this plan, the Open section is empty. Move the two remaining open items (Xbox arch + getPath re-evaluation) to Closed.

- [ ] **Step 1: Read the current `docs/superpowers/gaps.md`**

The Open section currently has two items: Xbox / WinGDK arch handling, and per-instance getPath re-evaluation.

- [ ] **Step 2: Move both items to Closed**

Delete the entire `## Open` content. Replace with:

```md
## Open

(none — all gaps surfaced by the subnautica2 port are closed)
```

Add to the Closed section under a "### Discovery" subsection (extending the existing one) and a "### Mod types" subsection (new):

```md
### Discovery

- **Xbox / WinGDK arch handling beyond simple `!storeBranch`.** Closed by
  Plan 11 (`2026-05-21-gdl-final-gaps.md`). Installer rules now accept an
  optional `scope: { stores: [...] }` field. When set, the shim's installer
  dispatcher checks the discovered store against the scope before consulting
  the engine. Combined with brace-expansion globs and `!storeBranch` for
  destination paths, the full "different markers on different platforms"
  pattern is expressible as N store-scoped installers with the same priority.

### Mod types

- **Per-game-instance `getPath` re-evaluation.** Closed by Plan 11. The
  shim's `IModType.getPath` callback now re-interpolates the path template
  on each call, overriding the resolved-context's `installPath` with the
  current game's `gamePath`. Re-discovery after Vortex updates the game's
  path is now reflected on the next path query.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/gaps.md
git commit -m "Close last two gaps (Xbox arch scoping, lazy getPath) — implemented in Plan 11"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` (141 tests pass)
- [ ] `pnpm typecheck` (clean)
- [ ] `pnpm build` (produces dist/cli.js)
- [ ] The subnautica2-shaped fixture's bundle contains `xbox-injector-placeholder` and `scope: { stores: ['xbox'] }`
- [ ] `docs/superpowers/gaps.md` has 0 open items

---

## After this plan: update the subnautica2 port (final)

Once Plan 11 lands, bump the subnautica2 port's GDL submodule. No new game.yaml changes are strictly required for subnautica2 (the markers are the same across arches), but the port author can opt-in to scope.stores if desired. Also bump the port's GAPS.md to remove the closed items.

This is the LAST follow-up port update; after this, every gap surfaced by the subnautica2 port is closed and the port's GAPS.md is empty.

## What this plan does not deliver (and where it goes)

- **OS-scoped installers** (e.g., `scope: { os: [windows] }`): same pattern as `stores`, but no real game has needed it yet. Add when there's a concrete use case.
- **Dynamic discovery re-runs**: Vortex calls `getPath(game)` with the current game record, so we re-interpolate from that. We don't re-call `GameStoreHelper.findByAppId` on each getPath call (would be too expensive). If a game's discovery state mutates more deeply than just `gamePath`, a future revision can refresh the broader discovery facts (store, arch) too.
- **Path template syntax beyond `${var}`**: installs use simple variable interpolation. If we ever need expressions (`${installPath}/${store === 'xbox' ? 'WinGDK' : 'Win64'}`), that's a meaningful extension; `!storeBranch` covers the current cases.
