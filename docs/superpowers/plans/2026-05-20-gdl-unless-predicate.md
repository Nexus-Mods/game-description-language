# GDL `unless:` Exclusion Predicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gap #1 from `docs/superpowers/gaps.md` — add an optional `unless:` predicate to installer rules so a broad fallback installer can disqualify itself when archive contents would also match a narrower installer. The legacy Vortex pattern this replaces is `losesTo: [predicateFn, ...]`, expressed in GDL as a single composable predicate (`!any` / `!all` of `!hasFile` / `!matches`, etc.).

**Architecture:** Tiny extension of the existing installer/predicate machinery. `InstallerNode` gets an optional `unless?: PredicateNode`. The parser reads it from the YAML; the validator needs no new rules (predicates are already structurally typed via the existing tag set); the runtime installer engine adds one short-circuit line — `if unless evaluates true, return []`; the codegen emits the field; one E2E fixture covers all installer combinations that now become expressible.

**Tech Stack:** Existing Plans 1-6 stack. No new dependencies.

**Spec reference:** `docs/superpowers/gaps.md` item 1 (losesTo / mutually-exclusive installer dispatch).

---

## File structure (delta from Plan 6)

```
game-description-language/
├── src/
│   ├── parser/
│   │   ├── ast.ts                     # +unless?: PredicateNode on InstallerNode
│   │   └── index.ts                   # +parse unless on installer entries
│   ├── runtime/
│   │   └── installer-engine.ts        # +unless? on InstallerRule; short-circuit in buildInstallPlan
│   └── codegen/
│       └── emit.ts                    # +render unless in renderInstaller
└── tests/
    ├── parser.test.ts                 # +parse-unless test
    ├── installer-engine.test.ts       # +runtime-unless test
    ├── codegen.test.ts                # +emit-unless test
    ├── e2e.test.ts                    # +subnautica2-shaped assertion
    └── fixtures/
        └── subnautica2-shaped/game.yaml   # +unless on broader installers
```

The route form of an installer doesn't need its own `unless` — at the rule level is sufficient. A rule's `unless` gates the whole rule (both single and route forms).

---

## Task 1: AST — `unless?: PredicateNode` on InstallerNode

**Files:**
- Modify: `src/parser/ast.ts`

Pure type addition. No parser/runtime changes yet.

- [ ] **Step 1: Extend `InstallerNode` in `src/parser/ast.ts`**

Find the existing `InstallerNode` interface:

```ts
export interface InstallerNode extends Node {
  kind: 'installer';
  id: string;
  priority: number;
  when: PredicateNode;
  single?: SingleInstallerForm;
  route?: RouteEntry[];
  modType?: string;
}
```

Add an optional `unless`:

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

- [ ] **Step 2: Typecheck and full test**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: 105 tests still pass (no new tests yet).

- [ ] **Step 3: Commit**

```bash
git add src/parser/ast.ts
git commit -m "Add optional unless predicate to InstallerNode"
```

---

## Task 2: Parser — read `unless:` field on installer entries

**Files:**
- Modify: `src/parser/index.ts`
- Modify: `tests/parser.test.ts`

The `unless:` field carries any predicate the existing `parsePredicate` already handles. So this is one new line in the installers-parsing block.

- [ ] **Step 1: Failing test in `tests/parser.test.ts`**

Append inside `describe('parseYaml')`:

```ts
  it('parses installer with unless predicate', () => {
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
    unless: !any
      - !hasFile "**/LogicMods/**"
      - !hasFile "**/Scripts/*.lua"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`, 'inline.yaml');
    const inst = doc.installers![0]!;
    expect(inst.unless).toBeDefined();
    expect(inst.unless!.kind).toBe('any');
    if (inst.unless!.kind !== 'any') return;
    expect(inst.unless!.arms).toHaveLength(2);
    expect(inst.unless!.arms[0]).toMatchObject({ kind: 'hasFile' });
    expect(inst.unless!.arms[1]).toMatchObject({ kind: 'hasFile' });
  });

  it('leaves unless undefined when the YAML omits it', () => {
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
    expect(doc.installers![0]!.unless).toBeUndefined();
  });
```

Run: `pnpm test parser`
Expected: FAIL — `inst.unless` undefined in the first case.

- [ ] **Step 2: Extend `src/parser/index.ts`**

Find the existing installer-parsing block (inside the `if (isSeq(installersYaml))` body). Locate where `when` is parsed:

```ts
const when = parsePredicate(entry.get('when', true) as YamlNode, file, source);
```

Right after that line, add:

```ts
const unlessYaml = entry.get('unless', true);
const unless = unlessYaml ? parsePredicate(unlessYaml as YamlNode, file, source) : undefined;
```

In the `installers.push({ ... })` object literal below, add the conditional spread for `unless` (placed alongside the other conditional spreads):

```ts
installers.push({
  kind: 'installer',
  id,
  priority,
  when,
  ...(unless   !== undefined && { unless }),
  ...(single   !== undefined && { single }),
  ...(route    !== undefined && { route }),
  ...(modType  !== undefined && { modType }),
  span: spanOf(file, source, entry),
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test parser`
Expected: PASS — both new cases.

Run: `pnpm test`
Expected: 107 tests pass (105 + 2 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/parser/index.ts tests/parser.test.ts
git commit -m "Parse optional unless predicate on installer rules"
```

---

## Task 3: Runtime engine — short-circuit on `unless`

**Files:**
- Modify: `src/runtime/installer-engine.ts`
- Modify: `tests/installer-engine.test.ts`

Add `unless?: PredicateExpr` to `InstallerRule` and evaluate it right after `when` in `buildInstallPlan`. If `unless` is true, return an empty plan (same effect as `when` failing).

- [ ] **Step 1: Failing tests in `tests/installer-engine.test.ts`**

Append (next to the existing test blocks):

```ts
describe('buildInstallPlan — unless predicate', () => {
  it('returns empty plan when unless evaluates true', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 30,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      unless: { kind: 'hasFile', glob: '**/LogicMods/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '/mods',
      },
      modType: 'pak',
    };
    const archive = ['Mod/LogicMods/Cool.pak'];   // matches BOTH when and unless
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([]);
  });

  it('returns plan normally when unless evaluates false', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 30,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      unless: { kind: 'hasFile', glob: '**/LogicMods/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '/mods',
      },
      modType: 'pak',
    };
    const archive = ['Mod/Cool.pak'];   // matches when, NOT unless
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([
      { source: 'Mod/Cool.pak', destination: '/mods/Cool.pak', modType: 'pak' },
    ]);
  });

  it('unless is composable with !any', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 30,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      unless: {
        kind: 'any',
        arms: [
          { kind: 'hasFile', glob: '**/LogicMods/**' },
          { kind: 'hasFile', glob: '**/Scripts/*.lua' },
        ],
      },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '/mods',
      },
      modType: 'pak',
    };
    // Lua marker present → unless's any returns true → empty plan.
    const archive = ['Mod/Cool.pak', 'Mod/Scripts/main.lua'];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([]);
  });
});
```

Run: `pnpm test installer-engine`
Expected: FAIL (the new describe block) — `rule.unless` not in the type, runtime doesn't know about it.

- [ ] **Step 2: Extend `InstallerRule` and `buildInstallPlan` in `src/runtime/installer-engine.ts`**

Find the `InstallerRule` interface:

```ts
export interface InstallerRule {
  id: string;
  priority: number;
  when: PredicateExpr;
  single?: SingleForm;
  route?: RouteEntry[];
  modType?: string;
}
```

Add `unless?: PredicateExpr`:

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

In `buildInstallPlan`, find the `when` short-circuit at the top:

```ts
export const buildInstallPlan = (
  rule: InstallerRule,
  archivePaths: readonly string[],
  ctx: EvalContext,
): InstallInstruction[] => {
  if (!evalPredicateExpr(rule.when, ctx)) return [];
  // ...
```

Add the `unless` short-circuit right after:

```ts
export const buildInstallPlan = (
  rule: InstallerRule,
  archivePaths: readonly string[],
  ctx: EvalContext,
): InstallInstruction[] => {
  if (!evalPredicateExpr(rule.when, ctx)) return [];
  if (rule.unless !== undefined && evalPredicateExpr(rule.unless, ctx)) return [];
  // ... rest unchanged
```

- [ ] **Step 3: Run tests**

Run: `pnpm test installer-engine`
Expected: PASS (all existing + 3 new).

Run: `pnpm test`
Expected: 110 tests pass (107 + 3).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/installer-engine.ts tests/installer-engine.test.ts
git commit -m "Runtime: skip installer when unless predicate evaluates true"
```

---

## Task 4: Codegen — render `unless` in `renderInstaller`

**Files:**
- Modify: `src/codegen/emit.ts`
- Modify: `tests/codegen.test.ts`

`renderInstaller` builds the TS object literal for each installer. Add an `unless: ...` field when present.

- [ ] **Step 1: Failing test in `tests/codegen.test.ts`**

Add a new `describe` block (alongside the existing ones):

```ts
describe('emit installer with unless', () => {
  const WITH_UNLESS = `
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
    unless: !hasFile "**/LogicMods/**"
    anchor: "**/*.pak"
    take: parent
    placeAt: /a
    modType: pak
`;

  it('emits unless field on installer when present', () => {
    const doc = parseYaml(WITH_UNLESS, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).toMatch(/unless:\s*\{ kind: 'hasFile', glob: '\*\*\/LogicMods\/\*\*' \}/);
  });

  it('does not emit unless when the YAML omits it', () => {
    const noUnless = `
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
`;
    const doc = parseYaml(noUnless, 'tiny.yaml');
    const files = emit(doc);
    const rules = files.find(f => f.path === 'installers.gen.ts')!;
    expect(rules.contents).not.toMatch(/\bunless\s*:/);
  });
});
```

Run: `pnpm test codegen`
Expected: FAIL on the first new test (the `unless` field isn't being emitted yet).

- [ ] **Step 2: Extend `renderInstaller` in `src/codegen/emit.ts`**

Find the `renderInstaller` function. It currently builds a `parts: string[]` and joins with commas:

```ts
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
    // ... route handling ...
  }
  return `{ ${parts.join(', ')} }`;
};
```

Add an `unless` line after `when`:

```ts
const renderInstaller = (inst: InstallerNode): string => {
  const parts: string[] = [
    `id: ${sq(inst.id)}`,
    `priority: ${inst.priority}`,
    `when: ${renderPredicate(inst.when)}`,
  ];
  if (inst.unless !== undefined) {
    parts.push(`unless: ${renderPredicate(inst.unless)}`);
  }
  if (inst.single) {
    // ... unchanged ...
  } else if (inst.route) {
    // ... unchanged ...
  }
  return `{ ${parts.join(', ')} }`;
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test codegen`
Expected: PASS (both new cases).

Run: `pnpm test`
Expected: 112 tests pass (110 + 2).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/codegen/emit.ts tests/codegen.test.ts
git commit -m "Codegen: emit unless predicate on installer rules when present"
```

---

## Task 5: E2E — subnautica2-shaped fixture exercises `unless`

**Files:**
- Modify: `tests/fixtures/subnautica2-shaped/game.yaml`
- Modify: `tests/e2e.test.ts`

Currently the subnautica2-shaped fixture has 4 installers (pak, logic-mod, ue4ss-lua, composite-mod). Add `unless` to the `pak` installer so it doesn't claim archives that have LogicMods or UE4SS markers — mirroring how the real subnautica2 extension uses `losesTo`.

- [ ] **Step 1: Modify `tests/fixtures/subnautica2-shaped/game.yaml`**

Find the `pak` installer:

```yaml
  - id: pak
    priority: 30
    when:    !hasFile "**/*.pak"
    anchor:  "**/*.pak"
    take:    parent
    placeAt: "${paksRoot}"
    modType: pak
```

Add an `unless:` clause right after `when:`:

```yaml
  - id: pak
    priority: 30
    when:    !hasFile "**/*.pak"
    unless: !any
      - !hasFile "**/LogicMods/**"
      - !hasFile "**/Scripts/*.lua"
    anchor:  "**/*.pak"
    take:    parent
    placeAt: "${paksRoot}"
    modType: pak
```

Append two new test cases under `tests.cases:` that pin the `unless` behavior. **Important:** the fixture's installers are evaluated in priority order (low → high): `ue4ss-lua` (10), `logic-mod` (20), `pak` (30), `composite-mod` (99). The first one that produces a non-empty plan wins. So:

```yaml
    - name: pak archive with LogicMods present routes to logic-mod (not pak)
      archive:
        - Outer/LogicMods/Inner/X.pak
      expect:
        matched: logic-mod
        modType: logic-mod

    - name: pak archive with Scripts present routes to ue4ss-lua (not pak)
      archive:
        - Outer/Cool.pak
        - Outer/Scripts/main.lua
      expect:
        matched: ue4ss-lua
```

In the first case: the archive matches `pak`'s `when` (it has a `.pak`), but `pak`'s `unless: !any [...]` matches (it has `**/LogicMods/**`), so `pak` disqualifies itself. `logic-mod` (priority 20) is evaluated first anyway and wins.

In the second case: archive has both `.pak` and `.lua`. `ue4ss-lua` (priority 10) matches first via its `when: !any [Scripts/*.lua, enabled.txt]` and wins before `pak` is even consulted. `unless` is correct insurance for the case where ue4ss-lua wouldn't have fired for some other reason — without it, `pak` could still claim the archive.

- [ ] **Step 2: Extend the subnautica2-shaped e2e test in `tests/e2e.test.ts`**

Find the `subnautica2-shaped` describe block. After the existing bundle assertions, add:

```ts
    const testsGenWithUnless = readFileSync(join(work, '.gdl-out', 'tests.gen.ts'), 'utf8');
    expect(testsGenWithUnless).toContain("it('pak archive with LogicMods present routes to logic-mod (not pak)'");
    expect(testsGenWithUnless).toContain("it('pak archive with Scripts present routes to ue4ss-lua (not pak)'");
```

And one more assertion about the bundle containing `unless` somewhere (the runtime form):

```ts
    expect(bundle).toMatch(/unless\s*:/);
```

- [ ] **Step 3: Run tests + verify generated tests pass**

Run: `pnpm test e2e`
Expected: PASS — all e2e cases plus the new bundle assertion.

Note: the `subnautica2-shaped` e2e test only builds the bundle and asserts string content. It does NOT separately run the generated tests file. The "generated tests run" e2e test (added in Plan 3 polish) uses the simpler `tests/fixtures/e2e/` fixture, not `subnautica2-shaped/`. So the new test cases we just added to subnautica2-shaped/ are exercised in the bundle (their strings appear in tests.gen.ts), but their actual runtime behavior is exercised by the unit tests in Task 3.

Run: `pnpm test`
Expected: 112 tests still pass.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/subnautica2-shaped/game.yaml tests/e2e.test.ts
git commit -m "E2E: subnautica2-shaped exercises unless on the pak installer"
```

---

## Task 6: Close gap #1 in `docs/superpowers/gaps.md`

**Files:**
- Modify: `docs/superpowers/gaps.md`

- [ ] **Step 1: Move item 1 from Open → Closed**

In `docs/superpowers/gaps.md`, delete item 1 ("losesTo / mutually-exclusive installer dispatch") from the "Open" section. Renumber the remaining items in the "Installer features" section (current 2 → 1, 3 → 2, 4 → 3, etc.) and update any cross-references in items 4 and later.

Add the closed entry under "## Closed":

```md
### Installer features

1. **`losesTo` / mutually-exclusive installer dispatch.** Closed by Plan 7
   (`2026-05-20-gdl-unless-predicate.md`). Installer rules now accept an
   optional `unless: <predicate>` field. When the predicate evaluates true at
   `testSupported` time, the rule self-disqualifies even if `when` would have
   matched. The predicate is the same composable language as `when` —
   typically `!any` of `!hasFile` patterns pointing at signals for a narrower
   installer. The subnautica2-shaped fixture now demonstrates `pak`
   disqualifying itself when LogicMods or Scripts are present.
```

Note: this also means the previously-Open item 4 ("`root` installer") is now expressible too — append a note to item 4 (now renumbered to 3 in Open) that it can be expressed using `unless`. Or, if the user later adds `root` to the subnautica2 port and confirms it works, item 3 (renumbered) can be closed too.

For this plan: just close item 1, leave the renumbered item 3 (originally 4) open with a note like:

```md
3. **`root` installer.** "Take everything as-is from the archive root, but only
   if no other installer wins." Now expressible using `unless` (Plan 7) once
   added to a real port — see Plan 7's note about exposing it in the
   subnautica2 port as a follow-up.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/gaps.md
git commit -m "Close gap #1 (losesTo) — implemented as 'unless' in Plan 7"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` — all 112 tests pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm build` — produces dist/cli.js
- [ ] The subnautica2-shaped fixture's bundle contains the `unless:` keyword (runtime form)
- [ ] `docs/superpowers/gaps.md` has item 1 moved to Closed; remaining open items renumbered correctly

---

## After this plan: update the subnautica2 port

Once Plan 7 lands, bump the subnautica2 port's submodule and:

1. Add `unless` to its `pak` installer mirroring the legacy `losesTo: [containsLogicMods, containsUE4SSScripts]`.
2. Add the three "broad fallback" installers that were previously omitted (`pakAlt`, `contentFolder`, `root`), each with the same `unless` clause.
3. Verify build + tests still pass.
4. Update the port's `GAPS.md` to remove item 1 (now closed) and renumber.

This is a small follow-up, not part of this plan.

## What this plan does not deliver (and where it goes)

- **`losesTo: [installerId, ...]` sugar.** If real games end up restating the same exclusion-predicate across many installers, adding shorthand that references other installer ids could be a future small plan. Not needed for subnautica2 today (the three broad installers all share one exclusion set, which lifts cleanly into a context binding).
- **`unless` on individual `route:` entries.** Currently `unless` is at the rule level. If a future game needs per-route disqualification, extend `RouteEntry` similarly. Not needed today.
