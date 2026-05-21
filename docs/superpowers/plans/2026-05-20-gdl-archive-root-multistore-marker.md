# GDL: `archive-root` Take + Multi-Store Discover + Marker Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gaps #1 (marker-find-then-walk-up routing, partially) and #2 (root installer) from `docs/superpowers/gaps.md`, plus #5 (multi-store queryPath). Three independent changes: add a `take: archive-root` strategy that preserves archive paths as-is (unblocking the root installer); change the Vortex shim's `discover` to pass all store appIds in a single array call (matching the legacy idiom); switch the subnautica2-shaped `ue4ss-lua` installer to a file-anchor + `take: parent.parent` shape and add a second installer for the `enabled.txt`-only archive layout.

**Architecture:** Three independent changes, all small:
1. **`take: archive-root`** is a new variant of `TakeStrategy`. The engine bypasses `stripPath`'s dropCount math and returns each path as-is. No filter. The codegen emits the new variant alongside the existing ones.
2. **Multi-store discover** is a 5-line change in `src/runtime/vortex-shim.ts`: collect all stores' `appId` values into one array, pass to `GameStoreHelper.findByAppId(ids)`. The result's `gameStoreId` field tells us which store hit. Drop the per-store loop.
3. **Marker fix** is fixture-only: the subnautica2-shaped `ue4ss-lua` installer changes from `anchor: "**/Scripts/"` + `take: parent` (which loses the mod-name in the destination) to `anchor: "**/Scripts/*.lua"` + `take: parent.parent` (which preserves it because dropCount=0 when the marker is at depth 3). A second installer with `anchor: "**/enabled.txt"` + `take: parent.parent` + `unless: !hasFile "**/Scripts/*.lua"` handles the enabled.txt-only form. This is "marker-find-then-walk-up" expressed through composition, not new engine primitives.

**Tech Stack:** Existing stack. No new dependencies.

**Spec reference:** `docs/superpowers/gaps.md` items 1, 2, 5.

---

## File structure (delta from Plan 8)

```
game-description-language/
├── src/
│   ├── parser/
│   │   ├── ast.ts                     # +'archive-root' in TakeStrategy
│   │   └── index.ts                   # accept 'archive-root' in parseTakeStrategy
│   ├── runtime/
│   │   ├── installer-engine.ts        # handle take=archive-root (no strip, no filter)
│   │   └── vortex-shim.ts             # discover: pass all appIds in one array call
│   └── codegen/
│       └── emit.ts                    # renderTake accepts 'archive-root'
└── tests/
    ├── parser.test.ts                 # +parse take: archive-root
    ├── installer-engine.test.ts       # +runtime archive-root behavior
    ├── codegen.test.ts                # +emit archive-root
    └── fixtures/
        └── subnautica2-shaped/game.yaml  # +root installer, +dual ue4ss-lua installers
```

---

## Task 1: AST + parser: `take: archive-root`

**Files:**
- Modify: `src/parser/ast.ts`
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`

Add `'archive-root'` to the `TakeStrategy` union; teach `parseTakeStrategy` to accept the new literal.

- [ ] **Step 1: Extend `TakeStrategy` in `src/parser/ast.ts`**

Find:

```ts
export type TakeStrategy = 'self' | 'parent' | 'parent.parent' | { depth: number };
```

Change to:

```ts
export type TakeStrategy = 'self' | 'parent' | 'parent.parent' | 'archive-root' | { depth: number };
```

- [ ] **Step 2: Failing test in `tests/parser.test.ts`**

Append inside `describe('parseYaml')`:

```ts
  it('parses take: archive-root', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: root, name: Root, path: /game }
installers:
  - id: root
    priority: 23
    when: !hasFile "**/Subnautica2/**"
    anchor: "**/*"
    take: archive-root
    placeAt: /game
    modType: root
`, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.single!.take).toBe('archive-root');
  });
```

Run: `pnpm test parser`
Expected: FAIL (`parseTakeStrategy` rejects `archive-root`).

- [ ] **Step 3: Extend `parseTakeStrategy` in `src/parser/index.ts`**

Find the existing helper:

```ts
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
```

Replace with:

```ts
const parseTakeStrategy = (node: YamlNode | null | undefined, file: string, source: string): TakeStrategy => {
  if (isScalar(node)) {
    const v = node.value;
    if (v === 'self' || v === 'parent' || v === 'parent.parent' || v === 'archive-root') return v;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { depth: v };
  }
  throw new BuildErrors([{
    code: 'GDL041',
    message: '`take:` must be one of `self`, `parent`, `parent.parent`, `archive-root`, or a non-negative integer depth',
    span: spanOf(file, source, node ?? null),
  }]);
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm test parser`
Expected: PASS.

Run: `pnpm test`
Expected: 121 tests pass (120 + 1 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/parser/ast.ts src/parser/index.ts tests/parser.test.ts
git commit -m "Add 'archive-root' take strategy to AST and parser"
```

---

## Task 2: Runtime engine: `take: archive-root` keeps paths as-is

**Files:**
- Modify: `src/runtime/installer-engine.ts`
- Modify: `tests/installer-engine.test.ts`

When `take === 'archive-root'`, `stripPath` returns the path unchanged. `buildInstallPlan` keeps every file in the archive. No filtering. The destination of each file = `${placeAt}/${source}`.

- [ ] **Step 1: Failing tests in `tests/installer-engine.test.ts`**

Append:

```ts
describe('buildInstallPlan — archive-root take', () => {
  it('preserves the full archive path as the relative destination', () => {
    const rule: InstallerRule = {
      id: 'root',
      priority: 23,
      when: { kind: 'hasFile', glob: '**/Subnautica2/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*' },
        take: 'archive-root',
        placeAt: '/games/Hello',
      },
      modType: 'root',
    };
    const archive = [
      'Subnautica2/Content/Paks/foo.pak',
      'Engine/Content/bar.uasset',
      'Readme.md',
    ];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([
      { source: 'Subnautica2/Content/Paks/foo.pak', destination: '/games/Hello/Subnautica2/Content/Paks/foo.pak', modType: 'root' },
      { source: 'Engine/Content/bar.uasset',         destination: '/games/Hello/Engine/Content/bar.uasset',         modType: 'root' },
      { source: 'Readme.md',                          destination: '/games/Hello/Readme.md',                          modType: 'root' },
    ]);
  });

  it('archive-root preserves nested archive structure regardless of anchor depth', () => {
    const rule: InstallerRule = {
      id: 'root',
      priority: 23,
      when: { kind: 'hasFile', glob: '**/Engine/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*' },
        take: 'archive-root',
        placeAt: '/dest',
      },
      modType: 'root',
    };
    const archive = ['a/b/c/d.txt'];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([
      { source: 'a/b/c/d.txt', destination: '/dest/a/b/c/d.txt', modType: 'root' },
    ]);
  });
});
```

Run: `pnpm test installer-engine`
Expected: FAIL.

- [ ] **Step 2: Handle `archive-root` in `stripPath` in `src/runtime/installer-engine.ts`**

Find the start of `stripPath`:

```ts
const stripPath = (
  path: string,
  take: TakeStrategy,
  anchorMatch: string,
  anchorPattern: string,
): string => {
  if (anchorPattern.endsWith('/')) {
    // ... directory-anchor branch ...
  }

  // File-shaped anchor branch ...
};
```

Add a new short-circuit at the very top (before the directory-anchor branch):

```ts
const stripPath = (
  path: string,
  take: TakeStrategy,
  anchorMatch: string,
  anchorPattern: string,
): string => {
  if (take === 'archive-root') {
    // Keep the path as-is from the archive root — no segments stripped, no filtering.
    return path;
  }
  if (anchorPattern.endsWith('/')) {
    // ... directory-anchor branch (unchanged) ...
  }
  // ... file-shaped anchor branch (unchanged) ...
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test installer-engine`
Expected: PASS (both new cases).

Run: `pnpm test`
Expected: 123 tests pass (121 + 2 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/installer-engine.ts tests/installer-engine.test.ts
git commit -m "Engine: take 'archive-root' keeps the archive path as-is in the destination"
```

---

## Task 3: Codegen: emit `take: archive-root`

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `tests/codegen.test.ts`

`renderTake` currently returns a single-quoted string for `'self' | 'parent' | 'parent.parent'` and a `{ depth: N }` literal for the object case. Add `'archive-root'` to the string-literal handling.

- [ ] **Step 1: Inspect the current `renderTake`**

It looks like:

```ts
const renderTake = (t: TakeStrategy): string => {
  if (typeof t === 'string') return sq(t);
  return `{ depth: ${t.depth} }`;
};
```

The `typeof t === 'string'` branch already handles any string variant via `sq()` (including the new `'archive-root'`). **No code change required.** But add a test to pin the behavior.

- [ ] **Step 2: Failing-then-passing test in `tests/codegen.test.ts`**

Add a new describe block (alongside the others):

```ts
describe('emit installer with take: archive-root', () => {
  const WITH_ARCHIVE_ROOT = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
modTypes:
  - { id: root, name: Root, path: /game }
installers:
  - id: root
    priority: 23
    when: !hasFile "**/Subnautica2/**"
    anchor: "**/*"
    take: archive-root
    placeAt: /game
    modType: root
`;

  it('emits take: \\'archive-root\\' as a single-quoted string literal', () => {
    const doc = parseYaml(WITH_ARCHIVE_ROOT, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).toMatch(/take:\s*'archive-root'/);
  });
});
```

Run: `pnpm test codegen`
Expected: PASS (already works because `renderTake` uses `sq()` for any string).

Run: `pnpm test`
Expected: 124 tests pass (123 + 1).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add tests/codegen.test.ts
git commit -m "Codegen: regression test that take: archive-root emits correctly"
```

---

## Task 4: Vortex shim: pass all appIds in one `findByAppId` call

**Files:**
- Modify: `src/runtime/vortex-shim.ts`

The current `discover()` loops `for (const s of stores)` and calls `GameStoreHelper.findByAppId(appId, s.id)` per-store. Vortex's legacy idiom passes the full array at once, letting Vortex try each id against all stores. Change to the single-array form.

- [ ] **Step 1: Locate the current `discover` method**

In `src/runtime/vortex-shim.ts`, find:

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
            executablePath: found.gamePath,
          };
        }
      } catch {
        // try next store
      }
    }
    return null;
  }
```

- [ ] **Step 2: Replace with the single-array form**

```ts
  private async discover(stores: StoreDecl[]): Promise<DiscoveryFacts | null> {
    const appIds = stores.map(s => String(s.value));
    if (appIds.length === 0) return null;
    const { GameStoreHelper } = await import('vortex-api');
    try {
      const found = await GameStoreHelper.findByAppId(appIds);
      if (!found) return null;
      return {
        store: found.gameStoreId,
        os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
        installPath: found.gamePath,
        executablePath: found.gamePath,
      };
    } catch {
      return null;
    }
  }
```

The signature change: pass `appIds` (`string[]`) instead of one `appId` + `storeId`. Vortex's `findByAppId` already accepts `string | string[]`; we declared that in the d.ts in Plan 2.

- [ ] **Step 3: Tests and typecheck**

Run: `pnpm test`
Expected: 124 tests still pass. No test exercises `discover` directly (it's called lazily during `queryPath`, which the e2e bundle doesn't actually run; only string-asserts).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/vortex-shim.ts
git commit -m "Shim: discover passes all store appIds in one findByAppId call"
```

---

## Task 5: subnautica2-shaped fixture: root installer, dual ue4ss-lua

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/e2e.test.ts`

Three changes to the fixture:
1. Add a `root` mod type + installer using `take: archive-root` and an `unless:` that defers to logic-mod / ue4ss-lua / injector.
2. Replace the existing `ue4ss-lua` installer's `anchor: "**/Scripts/"` + `take: parent` with `anchor: "**/Scripts/*.lua"` + `take: parent.parent`. The new shape preserves the mod-name in the destination (`${ue4ssModsRoot}/MyMod/Scripts/main.lua` instead of the current `${ue4ssModsRoot}/Scripts/main.lua`).
3. Add a second `ue4ss-lua-enabled` installer for archives that have only `enabled.txt` (no Scripts/*.lua).

- [ ] **Step 1: Read the current fixture** (so the editor sees what's there)

Run: `cat tests/fixtures/subnautica2-shaped/game.yaml`

Note the current shape of the `ue4ss-lua` installer (priority 22, anchor `"**/Scripts/"`, take `parent`). It'll be modified, not removed.

- [ ] **Step 2: Modify the fixture**

**A. Replace the existing `ue4ss-lua` installer** entry (priority 22) with:

```yaml
  - id: ue4ss-lua
    priority: 22
    when:    !hasFile "**/Scripts/*.lua"
    anchor:  "**/Scripts/*.lua"
    take:    parent.parent
    placeAt: "${ue4ssModsRoot}"
    modType: ue4ss-lua
```

**B. Add a second installer for the enabled.txt-only form** right after the ue4ss-lua entry:

```yaml
  - id: ue4ss-lua-enabled
    priority: 23
    when:    !hasFile "**/enabled.txt"
    unless:  !hasFile "**/Scripts/*.lua"
    anchor:  "**/enabled.txt"
    take:    parent.parent
    placeAt: "${ue4ssModsRoot}"
    modType: ue4ss-lua
```

**C. Add a `root` modType** to the `modTypes:` list:

```yaml
  - { id: root,            name: Root (game folder), path: "${installPath}" }
```

**D. Add a `root` installer** at the bottom of the `installers:` list (highest priority number; runs last):

```yaml
  - id: root
    priority: 24
    when: !any
      - !hasFile "**/Subnautica2/**"
      - !hasFile "**/Engine/**"
      - !hasFile "**/Binaries/**"
    unless: !any
      - !hasFile "**/LogicMods/**"
      - !hasFile "**/Scripts/*.lua"
      - !hasFile "**/{dwmapi.dll,xinput1_4.dll,ue4ss-settings.ini}"
    anchor: "**/*"
    take: archive-root
    placeAt: "${installPath}"
    modType: root
```

**E. Append three new test cases** to the `tests.cases:` list:

```yaml
    - name: enabled.txt-only ue4ss mod preserves mod-name in destination
      archive:
        - MyLuaMod/enabled.txt
        - MyLuaMod/data.json
      expect:
        matched: ue4ss-lua-enabled
        modType: ue4ss-lua
        plan:
          - ${ue4ssModsRoot}/MyLuaMod/enabled.txt
          - ${ue4ssModsRoot}/MyLuaMod/data.json

    - name: ue4ss lua with Scripts preserves mod-name in destination
      archive:
        - MyLuaMod/Scripts/main.lua
        - MyLuaMod/Scripts/util.lua
      expect:
        matched: ue4ss-lua
        plan:
          - ${ue4ssModsRoot}/MyLuaMod/Scripts/main.lua
          - ${ue4ssModsRoot}/MyLuaMod/Scripts/util.lua

    - name: root installer takes whole game-folder archives as-is
      archive:
        - Subnautica2/Content/Paks/foo.pak
        - Engine/Content/bar.uasset
      expect:
        matched: root
        modType: root
        plan:
          - ${installPath}/Subnautica2/Content/Paks/foo.pak
          - ${installPath}/Engine/Content/bar.uasset
```

- [ ] **Step 3: Extend the subnautica2-shaped e2e test in `tests/e2e.test.ts`**

Find the subnautica2-shaped describe block. After the existing assertions add:

```ts
    const testsGenRoot = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGenRoot).toContain("it('enabled.txt-only ue4ss mod preserves mod-name in destination'");
    expect(testsGenRoot).toContain("it('ue4ss lua with Scripts preserves mod-name in destination'");
    expect(testsGenRoot).toContain("it('root installer takes whole game-folder archives as-is'");
    expect(bundle).toMatch(/['"]root['"]/);
    expect(bundle).toMatch(/['"]ue4ss-lua-enabled['"]/);
    expect(bundle).toMatch(/archive-root/);
```

- [ ] **Step 4: Run tests**

Run: `pnpm test e2e`
Expected: PASS (the subnautica2-shaped test now also asserts the new fixture content).

Run: `pnpm test`
Expected: 124 tests still pass (no new `it` block; the assertions extend an existing one).

Run: `pnpm typecheck`
Expected: exits 0.

> **Heads-up:** the existing `'ue4ss lua mod'` test case in the fixture (the one added in Plan 2) only asserts `matched: ue4ss-lua` and `modType: ue4ss-lua` (not the plan). After this task, that case's plan changes from `${ue4ssModsRoot}/Scripts/main.lua` to `${ue4ssModsRoot}/MyLuaMod/Scripts/main.lua` (because the new file-anchor + take=parent.parent preserves the mod-name). The unchanged assertions still pass. The two new test cases (above, with explicit `plan:`) pin the new behavior.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/game.yaml tests/e2e.test.ts
git commit -m "Fixture: root installer + dual ue4ss-lua installers (preserve mod-name)"
```

---

## Task 6: Close gaps #1, #2, and #5 in `docs/superpowers/gaps.md`

**Files:**
- Modify: `docs/superpowers/gaps.md`

- [ ] **Step 1: Move items 1 (marker), 2 (root), and 5 (multi-store) to Closed**

In the Open section, delete items 1, 2, and 5. Renumber the remaining open items so they stay 1..N contiguous. The Open section after this task should contain:

```md
### Lifecycle hooks

1. **Setup hook (`prepareForModding`).** Legacy extension ensures specific mod
   folders exist on disk the first time the game is managed. GDL's hook catalog
   only declares `detectGameVersion`. Needs an additional catalog entry.

2. **`did-deploy` event hook.** Legacy extension regenerates UE4SS `mods.txt`
   after every deployment so UE4SS can find installed mods. No GDL hook covers
   this.

### Discovery

3. **Xbox / WinGDK arch handling beyond simple `!storeBranch`.** Legacy
   `ue4ssInjectorPath` chooses `Binaries/Win64/` vs `Binaries/WinGDK/` based on
   `discovery.store === 'xbox'`. GDL's `!storeBranch` can express this for a
   `modType.path`, but not for an installer's arch-specific marker recognition
   (e.g., looking for `xinput1_4.dll` vs a different marker on Xbox).

### Mod types

4. **Per-game-instance `getPath` re-evaluation.** Legacy `registerModType`
   passes a function that reads current discovery state every time Vortex asks
   for the path. GDL evaluates context bindings once at registration into a
   frozen `resolvedCtx`. For mod paths that depend on state that can change
   after first-discovery (rare but possible), GDL needs a re-evaluation seam.
```

Add three entries under the existing `### Installer features` heading in the Closed section:

```md
- **Marker-find-then-walk-up routing.** Addressed in Plan 9
  (`2026-05-20-gdl-archive-root-multistore-marker.md`) by composition rather
  than a new engine primitive. The subnautica2-shaped fixture now uses two
  ue4ss-lua installers: one for the `Scripts/*.lua` form (anchor
  `**/Scripts/*.lua` + `take: parent.parent`) and one for the
  `enabled.txt`-only form (anchor `**/enabled.txt` + `take: parent.parent` +
  `unless: !hasFile "**/Scripts/*.lua"`). Both preserve the mod-name in the
  destination by relying on the depth math: when the anchor's structural
  depth equals the take offset, dropCount is 0 and the full archive path
  flows through. Stray top-level files outside the mod-name directory are
  still routed (current `installRoot` is empty when dropCount is 0), which
  is the one edge case where this composition diverges from the legacy
  `findUE4SSModRoot` semantics. Acceptable for the typical archive shape;
  a future plan can introduce a `take: preserve-mod-root` strategy if a real
  game needs the strict legacy behavior.

- **`root` installer.** Closed by Plan 9. New `take: archive-root` strategy
  passes archive paths through unchanged — every file's destination is
  `${placeAt}/${source}`. Combined with `unless:` from Plan 7, the root
  installer in the fixture defers to logic-mod / ue4ss-lua / injector and
  catches archives shaped as `Subnautica2/...`, `Engine/...`, or
  `Binaries/...`.
```

Add a new subsection under Closed (or append to an existing one) for discovery:

```md
### Discovery

- **Multi-store-in-one-call `queryPath`.** Closed by Plan 9. The shim's
  `discover()` now collects every declared store's `appId` into one array
  and calls `GameStoreHelper.findByAppId(ids)` once. Vortex's own discovery
  logic picks the matching store and reports it back in the `gameStoreId`
  field. Matches the legacy idiom and lets Vortex's preference rules apply.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/gaps.md
git commit -m "Close gaps #1 (marker), #2 (root), #5 (multi-store) — implemented in Plan 9"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` (124 tests pass)
- [ ] `pnpm typecheck` (clean)
- [ ] `pnpm build` (produces dist/cli.js)
- [ ] The subnautica2-shaped fixture's bundle contains `'root'`, `'ue4ss-lua-enabled'`, and `archive-root`
- [ ] `docs/superpowers/gaps.md` has 4 open items left (lifecycle hooks ×2, discovery ×1, mod types ×1)

---

## After this plan: update the subnautica2 port

Once Plan 9 lands, bump the subnautica2 port's GDL submodule and mirror the fixture changes in its `game.yaml`:
1. Add the `root` modType + installer.
2. Switch the existing `ue4ss-lua` installer's anchor/take to the file-anchor + parent.parent shape.
3. Add the `ue4ss-lua-enabled` installer.
4. Update the port's `GAPS.md` to remove items 1 / 2 / 5 / 6 (renumbered).

Small follow-up; same pattern as Plans 6, 7, 8.

## What this plan does not deliver (and where it goes)

- **`take: preserve-mod-root` strategy**: a stricter version of the marker-find-then-walk-up logic that respects the mod-name directory as the install-root for scoping. Not needed for the common archive shapes; add when a real game requires it.
- **Per-store fallback rules inside the single `findByAppId` call**: Vortex's array-form handles this internally. We accept whatever its preference order is.
- **`take: archive-root` in route entries**: the new variant works there too (it's just a `TakeStrategy`), but no test exercises it. Add a test if a real game uses it.
