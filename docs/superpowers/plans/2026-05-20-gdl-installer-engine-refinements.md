# GDL Installer Engine Refinements (UE4SS Injector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gap #2 from `docs/superpowers/gaps.md` (the UE4SS injector pattern) by adding three small refinements to the installer engine: case-insensitive glob matching by default, shallowest-anchor selection by default, and install-root scoping for file-shaped anchors. With these, the UE4SS injector (and any other "find marker, route the directory containing it" installer) becomes expressible in the existing single-installer form.

**Architecture:** Three independent tweaks, all in `src/runtime/glob.ts` and `src/runtime/installer-engine.ts`. Each is additive against the current behavior:
- `compileGlob` flips `nocase: true` (no test should regress; existing tests use consistent casing).
- A new `findShallowest` joins `findFirst` in `glob.ts`; the installer engine swaps to it.
- The file-anchor branch of `stripPath` returns `''` for paths that aren't under the install root (same exclusion contract the directory-anchor branch already uses). Existing tests' archives all keep their files under the install root, so no regression.

**Tech Stack:** Existing stack. No new deps.

**Spec reference:** `docs/superpowers/gaps.md` item 2 (UE4SS injector installer pattern); see also item 3 (`root` installer, partially blocked on this), now informally addressable by the same primitives.

---

## File structure (delta from Plan 7)

```
game-description-language/
├── src/
│   └── runtime/
│       ├── glob.ts                  # +findShallowest; flip nocase default
│       └── installer-engine.ts      # use findShallowest; scope file-anchor to install root
└── tests/
    ├── glob.test.ts                 # +case-insensitive, +findShallowest tests
    ├── installer-engine.test.ts     # +install-root scoping tests
    ├── e2e.test.ts                  # +subnautica2-shaped injector assertions
    └── fixtures/
        └── subnautica2-shaped/game.yaml   # +ue4ss-injector installer
```

---

## Task 1: Case-insensitive glob matching by default

**Files:**
- Modify: `src/runtime/glob.ts`
- Modify: `tests/glob.test.ts`

Mods in the wild have inconsistent filename casing (`DwMapi.DLL` vs `dwmapi.dll`). The legacy subnautica2 code lowercases basenames before comparing. picomatch already supports case-insensitive matching via the `nocase` flag; we just need to flip it.

- [ ] **Step 1: Failing test in `tests/glob.test.ts`**

Append a new describe block:

```ts
describe('case insensitivity', () => {
  it('matches regardless of case in the input path', () => {
    const m = compileGlob('**/dwmapi.dll');
    expect(m('Pack/inject/dwmapi.dll')).toBe(true);
    expect(m('Pack/inject/DWMAPI.DLL')).toBe(true);
    expect(m('Pack/inject/DwMapi.Dll')).toBe(true);
  });

  it('matches regardless of case in the pattern', () => {
    const m = compileGlob('**/DWMAPI.DLL');
    expect(m('Pack/inject/dwmapi.dll')).toBe(true);
  });
});
```

Run: `pnpm test glob`
Expected: the three new assertions FAIL (current default is case-sensitive).

- [ ] **Step 2: Flip `nocase: true` in `src/runtime/glob.ts`**

Find the existing `compileGlob` function:

```ts
export const compileGlob = (pattern: string): GlobMatcher => {
  const normalised = pattern.endsWith('/') ? `${pattern}**/*` : pattern;
  const m = picomatch(normalised, { dot: true, nocase: false });
  return (path: string) => m(path);
};
```

Change `nocase: false` to `nocase: true`:

```ts
export const compileGlob = (pattern: string): GlobMatcher => {
  const normalised = pattern.endsWith('/') ? `${pattern}**/*` : pattern;
  const m = picomatch(normalised, { dot: true, nocase: true });
  return (path: string) => m(path);
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test glob`
Expected: PASS (all glob tests including the 2 new case-insensitivity ones).

Run: `pnpm test`
Expected: 112 tests pass (no regressions; every existing test uses consistent casing).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/glob.ts tests/glob.test.ts
git commit -m "Glob: match case-insensitively by default (matches Windows filesystem semantics)"
```

---

## Task 2: Shallowest-anchor selection

**Files:**
- Modify: `src/runtime/glob.ts`
- Modify: `src/runtime/installer-engine.ts`
- Modify: `tests/glob.test.ts`
- Modify: `tests/installer-engine.test.ts`

When multiple files match the anchor pattern, the engine should pick the shallowest one (fewest path segments), not the first one in archive order. The legacy `findInjectorMarker` does exactly this. Most archives put shallowest files first, so the change is invisible most of the time, but it is correct under all archive orderings.

- [ ] **Step 1: Failing test for `findShallowest` in `tests/glob.test.ts`**

Append a new describe block:

```ts
describe('findShallowest', () => {
  it('returns the matching path with the fewest segments', async () => {
    const { findShallowest } = await import('../src/runtime/glob.js');
    const m = compileGlob('**/dwmapi.dll');
    const paths = [
      'Pack/backup/old/dwmapi.dll',   // 4 segs
      'Pack/dwmapi.dll',              // 2 segs (shallowest)
      'Pack/sub/dwmapi.dll',          // 3 segs
    ];
    expect(findShallowest(paths, m)).toBe('Pack/dwmapi.dll');
  });

  it('returns undefined when nothing matches', async () => {
    const { findShallowest } = await import('../src/runtime/glob.js');
    const m = compileGlob('**/nope.dll');
    expect(findShallowest(['a.dll', 'b.dll'], m)).toBeUndefined();
  });

  it('returns the first encountered path on ties', async () => {
    const { findShallowest } = await import('../src/runtime/glob.js');
    const m = compileGlob('**/dwmapi.dll');
    expect(findShallowest(['Pack/dwmapi.dll', 'Other/dwmapi.dll'], m))
      .toBe('Pack/dwmapi.dll');
  });
});
```

Run: `pnpm test glob`
Expected: FAIL (`findShallowest` not exported).

- [ ] **Step 2: Add `findShallowest` to `src/runtime/glob.ts`**

Add the new function alongside `findFirst`:

```ts
export const findShallowest = (
  paths: readonly string[],
  matcher: GlobMatcher,
): string | undefined => {
  let best: string | undefined;
  let bestDepth = Infinity;
  for (const p of paths) {
    if (!matcher(p)) continue;
    const depth = p.split('/').length;
    if (depth < bestDepth) {
      best = p;
      bestDepth = depth;
    }
  }
  return best;
};
```

- [ ] **Step 3: Failing test for installer-engine using shallowest**

Append to `tests/installer-engine.test.ts`:

```ts
describe('buildInstallPlan — shallowest anchor selection', () => {
  it('picks the shallowest matching file as the anchor, not the first in archive order', () => {
    const rule: InstallerRule = {
      id: 'injector',
      priority: 15,
      when: { kind: 'hasFile', glob: '**/dwmapi.dll' },
      single: {
        anchor: { kind: 'glob', pattern: '**/dwmapi.dll' },
        take: 'parent',
        placeAt: '/binaries',
      },
      modType: 'injector',
    };
    // Archive lists the deeper marker FIRST; engine must still pick the shallowest.
    const archive = [
      'Pack/backup/old/dwmapi.dll',  // deeper, listed first
      'Pack/dwmapi.dll',             // shallower, listed second
    ];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    // With the shallow marker chosen, drop count = 1 (one segment of `Pack/` stripped).
    // The shallower marker maps to `dwmapi.dll`.
    // The deeper marker, also under `Pack/`, maps to `backup/old/dwmapi.dll`.
    expect(plan).toContainEqual({
      source: 'Pack/dwmapi.dll',
      destination: '/binaries/dwmapi.dll',
      modType: 'injector',
    });
    expect(plan).toContainEqual({
      source: 'Pack/backup/old/dwmapi.dll',
      destination: '/binaries/backup/old/dwmapi.dll',
      modType: 'injector',
    });
  });
});
```

Run: `pnpm test installer-engine`
Expected: FAIL (the deeper marker is picked first by `findFirst`, so destinations are off).

- [ ] **Step 4: Use `findShallowest` in `src/runtime/installer-engine.ts`**

Update the import on line 1:

```ts
import { compileGlob, findShallowest } from './glob.js';
```

Replace both `findFirst` call sites with `findShallowest` (one in the `rule.single` branch, one inside the `for (const r of rule.route ?? [])` loop). Two changes total.

The two lines to change look like:

```ts
const anchorHit = findFirst(archivePaths, matcher);
```

Change to:

```ts
const anchorHit = findShallowest(archivePaths, matcher);
```

(Both occurrences: once at the single-form branch, once at the route-form branch.)

- [ ] **Step 5: Run tests**

Run: `pnpm test installer-engine`
Expected: PASS (all existing + the new shallowest test).

Run: `pnpm test`
Expected: 116 tests pass (112 + 3 glob + 1 installer-engine).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/glob.ts src/runtime/installer-engine.ts \
        tests/glob.test.ts tests/installer-engine.test.ts
git commit -m "Engine: pick shallowest matching file as anchor (was first-in-archive)"
```

---

## Task 3: Install-root scoping for file-shaped anchors

**Files:**
- Modify: `src/runtime/installer-engine.ts`
- Modify: `tests/installer-engine.test.ts`

For file-shaped anchors, `stripPath` should return `''` when a file isn't under the install root (the same exclusion contract the directory-anchor branch already uses). The install root is the first `dropCount` segments of the anchor match.

- [ ] **Step 1: Failing test in `tests/installer-engine.test.ts`**

Append a new describe block:

```ts
describe('buildInstallPlan — install-root scoping for file anchors', () => {
  it('drops files that are not under the install root', () => {
    const rule: InstallerRule = {
      id: 'injector',
      priority: 15,
      when: { kind: 'hasFile', glob: '**/dwmapi.dll' },
      single: {
        anchor: { kind: 'glob', pattern: '**/dwmapi.dll' },
        take: 'parent',
        placeAt: '/binaries',
      },
      modType: 'injector',
    };
    // Marker is `Pack/inject/dwmapi.dll` — install root is `Pack/inject`.
    // `Pack/extras/sibling.txt` is NOT under `Pack/inject/` and must be dropped.
    // `Pack/Readme.md` is also NOT under `Pack/inject/` and must be dropped.
    const archive = [
      'Pack/inject/dwmapi.dll',
      'Pack/inject/ue4ss/x.lua',
      'Pack/extras/sibling.txt',
      'Pack/Readme.md',
    ];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([
      { source: 'Pack/inject/dwmapi.dll',    destination: '/binaries/dwmapi.dll',    modType: 'injector' },
      { source: 'Pack/inject/ue4ss/x.lua',  destination: '/binaries/ue4ss/x.lua',  modType: 'injector' },
    ]);
  });

  it('keeps all files when the install root is the archive root', () => {
    const rule: InstallerRule = {
      id: 'injector',
      priority: 15,
      when: { kind: 'hasFile', glob: '**/dwmapi.dll' },
      single: {
        anchor: { kind: 'glob', pattern: '**/dwmapi.dll' },
        take: 'parent',
        placeAt: '/binaries',
      },
      modType: 'injector',
    };
    // Marker at archive root → install root is empty → no filtering.
    const archive = [
      'dwmapi.dll',
      'ue4ss/x.lua',
      'Readme.md',
    ];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([
      { source: 'dwmapi.dll',  destination: '/binaries/dwmapi.dll',  modType: 'injector' },
      { source: 'ue4ss/x.lua', destination: '/binaries/ue4ss/x.lua', modType: 'injector' },
      { source: 'Readme.md',   destination: '/binaries/Readme.md',   modType: 'injector' },
    ]);
  });
});
```

Run: `pnpm test installer-engine`
Expected: FAIL (the first test currently includes the outsider files in the plan).

- [ ] **Step 2: Add the install-root filter to the file-anchor branch of `stripPath`**

Find the file-anchor branch in `src/runtime/installer-engine.ts` (the part after the `if (anchorPattern.endsWith('/'))` block):

```ts
  // File-shaped anchor: derive dropCount from the anchor pattern structure.
  const anchorSegs = splitSegments(anchorMatch);
  const offset = takeOffset(take);
  const patternNonStarStarDepth = anchorPattern
    .split('/')
    .filter(s => s !== '**' && s.length > 0).length;
  const starStarExpansionDepth = anchorSegs.length - patternNonStarStarDepth;
  const dropCount = Math.max(0, starStarExpansionDepth + 1 - offset);
  const pathSegs = splitSegments(path);
  return joinSegments(pathSegs.slice(dropCount));
```

Replace with:

```ts
  // File-shaped anchor: derive dropCount from the anchor pattern structure.
  const anchorSegs = splitSegments(anchorMatch);
  const offset = takeOffset(take);
  const patternNonStarStarDepth = anchorPattern
    .split('/')
    .filter(s => s !== '**' && s.length > 0).length;
  const starStarExpansionDepth = anchorSegs.length - patternNonStarStarDepth;
  const dropCount = Math.max(0, starStarExpansionDepth + 1 - offset);

  // Install root: the first `dropCount` segments of the anchor match.
  // Files not under the install root are excluded (same contract as the directory-anchor branch).
  const installRootSegs = anchorSegs.slice(0, dropCount);
  const pathSegs = splitSegments(path);
  if (installRootSegs.length > 0) {
    if (pathSegs.length < installRootSegs.length) return '';
    for (let i = 0; i < installRootSegs.length; i++) {
      if (pathSegs[i] !== installRootSegs[i]) return '';
    }
  }
  return joinSegments(pathSegs.slice(dropCount));
```

- [ ] **Step 3: Run tests**

Run: `pnpm test installer-engine`
Expected: PASS (both new cases, plus all existing tests; the existing fixtures keep their files under the install root, so they're unaffected).

Run: `pnpm test`
Expected: 118 tests pass (116 + 2).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/installer-engine.ts tests/installer-engine.test.ts
git commit -m "Engine: scope file-anchor installers to files under the install root"
```

---

## Task 4: E2E: subnautica2-shaped fixture exercises the UE4SS injector

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/e2e.test.ts`

Add a `ue4ss-injector` mod type and installer to the fixture. Add test cases proving the engine handles the marker pattern correctly.

- [ ] **Step 1: Modify `tests/fixtures/subnautica2-shaped/game.yaml`**

In the `context:` block, add an injector destination that uses `!storeBranch` for the arch:

```yaml
context:
  paksRoot: !storeBranch
    xbox:    ${installPath}/Content/Paks/~mods
    default: ${installPath}/SubnauticaZero/Content/Paks/~mods
  logicModsRoot: ${installPath}/SubnauticaZero/Content/Paks/LogicMods
  ue4ssModsRoot: ${installPath}/SubnauticaZero/Binaries/Win64/Mods
  ue4ssInjectorRoot: !storeBranch
    xbox:    ${installPath}/SubnauticaZero/Binaries/WinGDK
    default: ${installPath}/SubnauticaZero/Binaries/Win64
```

In the `modTypes:` block, add:

```yaml
  - { id: ue4ss-injector,  name: UE4SS Injector,  path: "${ue4ssInjectorRoot}" }
```

In the `installers:` block, add a new installer at the TOP (lowest priority = highest precedence). The injector should run before logic-mod / ue4ss-lua / pak / composite:

```yaml
  - id: ue4ss-injector
    priority: 15
    when:    !hasFile "**/{dwmapi.dll,xinput1_4.dll,ue4ss-settings.ini}"
    anchor:  "**/{dwmapi.dll,xinput1_4.dll,ue4ss-settings.ini}"
    take:    parent
    placeAt: "${ue4ssInjectorRoot}"
    modType: ue4ss-injector
```

In the `tests.cases:` block, add three new cases that prove the injector works:

```yaml
    - name: ue4ss injector — single marker at archive root
      archive:
        - dwmapi.dll
        - ue4ss/settings.ini
      expect:
        matched: ue4ss-injector
        modType: ue4ss-injector

    - name: ue4ss injector — marker in a subfolder; sibling files dropped
      archive:
        - Pack/inject/dwmapi.dll
        - Pack/inject/ue4ss/x.lua
        - Pack/Readme.md
      expect:
        matched: ue4ss-injector
        modType: ue4ss-injector
        plan:
          - ${ue4ssInjectorRoot}/dwmapi.dll
          - ${ue4ssInjectorRoot}/ue4ss/x.lua

    - name: ue4ss injector — case-insensitive marker match
      archive:
        - Pack/Inject/DWMAPI.DLL
      expect:
        matched: ue4ss-injector
        modType: ue4ss-injector
```

> **Why these three cases:** the first exercises the archive-root edge case (install root is empty, all files kept). The second exercises the install-root scoping (the sibling `Readme.md` must be dropped). The third exercises the case-insensitive matching (Task 1).

- [ ] **Step 2: Extend the subnautica2-shaped e2e test in `tests/e2e.test.ts`**

Find the subnautica2-shaped describe block. After the existing bundle assertions add:

```ts
    const testsGenInjector = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGenInjector).toContain("it('ue4ss injector — single marker at archive root'");
    expect(testsGenInjector).toContain("it('ue4ss injector — marker in a subfolder; sibling files dropped'");
    expect(testsGenInjector).toContain("it('ue4ss injector — case-insensitive marker match'");
    expect(bundle).toMatch(/['"]ue4ss-injector['"]/);
```

- [ ] **Step 3: Run tests**

Run: `pnpm test e2e`
Expected: PASS (the subnautica2-shaped test now also asserts the new fixture content and bundle strings).

Run: `pnpm test`
Expected: 118 tests still pass (no new `it` block; the assertions extend an existing one).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/game.yaml tests/e2e.test.ts
git commit -m "E2E: subnautica2-shaped fixture exercises the UE4SS injector installer"
```

---

## Task 5: Close gap #2 in `docs/superpowers/gaps.md`

**Files:**
- Modify: `docs/superpowers/gaps.md`

- [ ] **Step 1: Move item 2 to Closed**

In `docs/superpowers/gaps.md`, delete item 2 ("UE4SS injector installer pattern") from the Open section. Renumber the remaining open items (1 → 1, 3 → 2; lifecycle hooks become 3, 4; discovery items become 5, 6; mod-types item becomes 7).

Add to the Closed section, under a new "Installer features" subsection (if not already present from Plan 7's closure):

```md
### Installer features (cont'd from Plan 7)

- **UE4SS injector installer pattern.** Closed by Plan 8
  (`2026-05-20-gdl-installer-engine-refinements.md`). Three engine
  refinements unlock the pattern: case-insensitive glob matching by
  default (Windows-style); shallowest-matching file selected as the
  anchor (vs. archive-order-first); and file-anchor installers now
  scope routing to files under the install root, dropping outsiders.
  Combined with brace-expansion globs (`**/{a,b,c}`) and `!storeBranch`
  for arch-aware destinations, the legacy `ue4ssInjectorSpec` is now
  ~12 lines of YAML. The subnautica2-shaped fixture exercises it
  end-to-end.
```

If the Closed section's "Installer features" subsection already exists from Plan 7, append the bullet there directly (not a new subsection).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/gaps.md
git commit -m "Close gap #2 (UE4SS injector pattern) — implemented in Plan 8"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` (118 tests pass)
- [ ] `pnpm typecheck` (clean)
- [ ] `pnpm build` (produces dist/cli.js)
- [ ] The subnautica2-shaped fixture's bundle contains `'ue4ss-injector'`
- [ ] `docs/superpowers/gaps.md` has item 2 moved to Closed; remaining open items renumbered correctly

---

## After this plan: update the subnautica2 port

Once Plan 8 lands, bump the subnautica2 port's submodule and add the `ue4ss-injector` installer to its `game.yaml` (mirroring the fixture). That's a small follow-up; same pattern as the Plan 6/7 port updates.

## What this plan does not deliver (and where it goes)

- **Marker-find-then-walk-up routing** (open gap #1 in the new numbering). The lua case currently uses `anchor: "**/Scripts/"` + `take: parent`, which works for archives shaped as `<modroot>/Scripts/*.lua`. Archives that put the marker deeper (e.g., `<modroot>/data/Scripts/*.lua`) still pick the wrong root. Not addressed here.
- **Per-route `unless`** (still open). The current `unless` is at the rule level. Future plan if a real game needs per-route disqualification.
- **Configurable anchor-selection strategy.** "Shallowest" is now the default and hardcoded. If a real game needs "first" or "deepest", add a `select: first|shallowest|deepest` option.
