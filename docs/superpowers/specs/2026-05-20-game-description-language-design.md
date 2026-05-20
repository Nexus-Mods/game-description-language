# Game Description Language (GDL) Design Document

## 1. The problem

Vortex game extensions are TypeScript modules: each declares a game, its installers, its mod types, its tools, its load order, and so on by importing the Vortex API and writing code. Surveying real extensions (`~/oss/Vortex/extensions/games/`, `github.com/Nexus-Mods/game-subnautica2`) shows that roughly 90% of that code is restating the same handful of data shapes — store IDs, paths, glob-shaped installer rules, stop patterns — and the remaining 10% is small, predictable pieces of logic (version detection, custom destination computation) that vary per game.

`GameAdaptorDesign.md` proposes a long-term Vortex change: sandboxed adaptors talking to the host over typed RPC. That work is its own project on its own timeline. This document describes a **near-term, tooling-only** answer to the same observation. We change nothing in Vortex. We get the data-format leverage by introducing a build-time language above today's extension API.

The result: an extension is, in the perfect case, a single `game.yaml`. In practice it is `game.yaml` plus a small `src/hooks.ts`. Everything else — webpack, info.json generation, Vortex API wiring, test harness, packaging, Nexus upload, GitHub Actions — lives in a shared submodule that each extension repo pins by commit.

## 2. System overview

The GDL is a build-time toolchain, not a runtime. No YAML reaches the JS bundle Vortex loads. There are three artefacts and three boundaries.

**The submodule (`game-description-language`)** holds: the codegen CLI (`gdl`), the YAML schema and a generated JSON Schema for editor support, the runtime helper library, the Vortex API shim with vendored `vortex-api` types, the Vitest harness, the webpack config, and the reusable GitHub Actions workflow templates. Nothing here is game-specific.

**An extension repo** (e.g. `game-subnautica2-gdl`) holds: one `game.yaml`, optionally a `src/hooks.ts` for any logic the YAML can't express, a `package.json` whose scripts delegate to the submodule CLI, and `gdl/` as a git submodule at a pinned commit. In the perfect case the repo contains nothing else.

**The built bundle** is `dist/extension.js` plus `dist/info.json` plus declared assets — identical in shape to today's Vortex extensions. Vortex loads it unchanged.

Build flow:

```
game.yaml ──┐
            ├─► gdl build ──► .gdl-out/*.ts ──┐
src/hooks.ts (optional) ──────────────────────┤
                                              ├─► webpack ──► dist/extension.js
runtime-helpers (from submodule) ─────────────┘
```

Three contracts pin the boundaries:

- **YAML schema** — the surface the extension author sees. SemVer'd. Breaking changes bump major.
- **Hook signatures** — typed function shapes the YAML can refer to. Each hook ID in the schema has exactly one signature.
- **Runtime helper API** — the only thing the generated code calls. Stable across schema versions; the helper library absorbs `vortex-api` churn, not the codegen.

Pinning the submodule by commit gives every extension a reproducible build. Bumping the submodule is a deliberate act, and the workflows referenced from the submodule are pinned at the same commit, so codegen and CI cannot drift.

## 3. The YAML language

The YAML has four layers: **declarations** (game, stores, mod types, installers, tools, load order, prelaunch, diagnostics), a **context** of named variables, **evaluation tags** for the spots where a value is computed instead of literal, and **`${var}` interpolation** for templating strings.

### 3.1 Declarations

Top-level keys are plain data, not conditional. `game` (id, name, executable, logo, required files, contributor), `stores` (per-store identifier — one value per store, type defaulted from the store), `modTypes` (id, display name, install path template), `installers` (ordered list, described below), `tools`, `loadOrder` (format + serialization target + per-item rules), `prelaunch` (commands + predicates), `diagnostics` (named checks).

Stores are flat by default — each store has one canonical identifier type and the schema knows which:

```yaml
stores:
  steam: 264710
  epic:  Subnautica2
  xbox:  Unknown.Subnautica2
```

Anything weirder (multiple IDs for one store) can opt into a nested form, but the default is one line per store.

### 3.2 Context

Built-in variables are always present: `store`, `os`, `arch`, `installPath`, `executablePath`, `userDataPath`, `documentsPath`, and `version` when a version-detection hook is declared. The author adds their own under a top-level `context:` block. Each variable is a literal, an interpolated string, a branch tag, or a `!hook` call that returns a value. Resolution runs once at discovery time and the result is a frozen `GameContext` consumed by every later rule.

### 3.3 Evaluation tags

A small fixed set, registered with the YAML parser:

- `!hook <id>` — reference to a typed function in `src/hooks.ts`. The schema declares the expected signature per hook ID.
- `!storeBranch`, `!osBranch`, `!versionBranch` — keyed-by-fact dispatch with a required `default` arm. Arms can themselves be tags or interpolated strings, so branches compose.
- `!when <predicate>` — generic gate, with predicate combinators `!any [..]`, `!all [..]`, `!not <p>`. Equality (`==`, `!=`), membership (`in`), and version comparators (`>=`, `<`) are available. The language is deliberately small; anything richer goes through `!hook`.
- `!hasFile <glob>`, `!hasFiles [...]`, `!matches <regex>` — pattern predicates for installer match blocks and diagnostics.
- `!path <segments…>` — composes paths from segments with OS-aware separators.

The tag set is open: schema minors can add tags without restructuring the codegen, which is how the expression surface grows in response to real needs (Section 10).

### 3.4 String interpolation

Inside any string scalar, `${name}` substitutes from the resolved context. The codegen emits a typed lookup, so a typo in a variable name is a build error pointing at the YAML span.

### 3.5 Pattern syntax

Globs are the primary form (`**`, `*`, `?`, `[…]`, `{a,b}`), matched against POSIX-form paths inside an archive's manifest or against the deployed file tree. Regex is available via `!matches`. The same matcher implementation backs every match site — `!hasFile` predicates, installer anchors, route match clauses, diagnostic queries.

### 3.6 Installers

An installer rule has the shape: `when` (predicate) → `anchor` (where the archive's base is) → `take` (which slice becomes the mod content: `self`, `parent`, `parent.parent`, or a numeric depth) → `placeAt` (destination template) → `modType` (the type tag the host records). Composite archives use a `route:` list of per-file rules instead of single `anchor`/`take`/`placeAt`.

Worked example modelled on game-subnautica2:

```yaml
gdl: 1

game:
  id: subnautica2
  name: Subnautica 2
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
  - { id: pak,        name: Pak Mod,       path: ${paksRoot} }
  - { id: logic-mod,  name: LogicMod,      path: ${logicModsRoot} }
  - { id: ue4ss-lua,  name: UE4SS Lua Mod, path: ${ue4ssModsRoot} }

installers:
  - id: ue4ss-lua
    priority: 10
    when:    !hasFile "**/Scripts/*.lua"
    anchor:  "**/Scripts/"
    take:    parent
    placeAt: ${ue4ssModsRoot}/${archiveName}
    modType: ue4ss-lua

  - id: logic-mod
    priority: 20
    when:    !hasFile "**/LogicMods/**/*.pak"
    anchor:  "**/LogicMods/"
    take:    self
    placeAt: ${logicModsRoot}
    modType: logic-mod

  - id: pak
    priority: 30
    when:    !hasFile "**/*.pak"
    anchor:  "**/*.pak"
    take:    parent
    placeAt: ${paksRoot}
    modType: pak

  - id: composite-mod
    priority: 99
    when: !all [ !hasFile "**/*.pak", !hasFile "**/Scripts/*.lua" ]
    route:
      - match:    "**/Scripts/*.lua"
        anchor:   "**/Scripts/"
        take:     parent
        placeAt:  ${ue4ssModsRoot}/${archiveName}
        modType:  ue4ss-lua
      - match:    "**/*.pak"
        anchor:   "**/*.pak"
        take:     parent
        placeAt:  ${paksRoot}
        modType:  pak

discovery:
  version: !hook detectGameVersion

tests:
  corpus: nexus
  cases:
    - name: lua mod from typical folder layout
      archive:
        - MyMod/Scripts/main.lua
        - MyMod/Scripts/util.lua
        - MyMod/readme.md
      expect:
        matched: ue4ss-lua
        plan:
          - ${ue4ssModsRoot}/MyMod/Scripts/main.lua
          - ${ue4ssModsRoot}/MyMod/Scripts/util.lua

nexus:
  modId: 1234   # set after the Nexus mod page exists; used by `gdl publish`
```

## 4. The codegen pipeline

`gdl build` runs a fixed sequence of phases. Every error from any phase is annotated with the YAML span it traces back to.

**Phase 1: Parse.** A YAML parser configured with the GDL tag set produces an AST that retains source positions. Untyped or unknown tags fail here.

**Phase 2: Schema validation.** The AST is validated against the GDL JSON Schema, which is generated from the same TypeScript definitions the codegen uses, so schema and codegen cannot drift. Errors are reported with YAML position and a "did you mean" suggestion for near-misses.

**Phase 3: Context resolution and predicate type-checking.** The `context:` block is topologically sorted; every `${var}` site is checked against defined names; every branch tag has its required arms and `default:` checked, with all arms producing the same value type. Predicates referencing `version` without a declared version-detection hook fail here.

**Phase 4: Hook resolution.** Every `!hook <id>` reference is resolved against `src/hooks.ts` using the TypeScript compiler API. The schema declares the expected signature per hook ID (for example `detectGameVersion: (ctx: GameContext) => Promise<string | null>`). Missing exports, extra hooks, or signature mismatches are build errors that point at both the YAML reference and the TS declaration.

**Phase 5: Emission.** Files are written to `.gdl-out/` (git-ignored):

- `extension.ts` — the entry point Vortex loads. Calls into the runtime helper to register the game, mod types, installers, tools, diagnostics, and load order.
- `context.ts` — the `GameContext` interface plus the resolver that fills it at discovery time.
- `installers.ts` — each rule compiled to a named function pair: `testSupported(files, ctx)` and `install(files, ctx)`. Both call into the runtime helpers.
- `diagnostics.ts` — one function per declared check.
- `tests.gen.ts` — Vitest cases derived from any inline `tests.cases:` entries.
- `info.json` — Vortex's extension manifest, derived from `game:` plus the extension's `package.json#version`.

Every emitted file carries a "do not edit" banner naming its source. Output is byte-for-byte deterministic for a given input.

**Phase 6: Source maps.** A `.ts.map` is emitted next to each generated `.ts` file, mapping generated lines back to YAML positions. Webpack chains these through the bundle's source map, so runtime stack traces from inside Vortex point at the YAML rule, not the generated code.

**Phase 7: Webpack.** A shared webpack config in the submodule bundles `extension.ts` + `src/hooks.ts` (if present) + runtime helpers + Vortex API shim, externalising `vortex-api` itself. Output is `dist/extension.js`, `dist/info.json`, and declared assets.

`gdl dev` watches both YAML and TS sources and re-runs the appropriate phases incrementally on change.

**Error model.** Two classes only. *Build errors* (phases 1–4) always include a YAML span, never produce output, exit non-zero. *Test failures* (phase 5+) include the YAML span via source map, the failing assertion, and a unified diff between expected and actual. Version mismatches between the declared `gdl: N` and the submodule's supported schema version are a distinct build error with a clear migration note.

## 5. Runtime helper library

The helper library is the only dependency the generated code has besides `vortex-api`. It is small on purpose: every feature that lives here is shared across all extensions and tested once.

**Pattern matcher.** Glob and regex matching against archive file lists or deployed trees. Globs compile once to a matcher object so a rule that runs against thousands of files does not re-parse its pattern per file.

**Context resolver.** Takes Vortex's discovery facts plus the YAML's `context:` spec and returns a frozen `GameContext`. Branch tags resolve here in dependency order.

**Interpolator.** `${var}` substitution against the resolved context, plus the `!path` segment joiner with OS-aware separators.

**Installer engine.** Pure-function core: anchor pattern + `take:` strategy + `placeAt:` template + archive file list → install plan as a list of `{source, destination, type}` triples. The `route:` form is the same engine called once per route. No I/O, no Vortex calls — which makes it the natural target for the inline `tests:` fixtures.

**Predicate primitives.** Semver compare, equality, membership. Boolean combinators (`!any`/`!all`/`!not`) are *not* helpers — the codegen emits them inline as `||` / `&&` / `!` so the stack frame stays at the rule the author wrote.

**Vortex API shim.** The most strategically important piece. Presents a stable typed surface (`registerGame`, `registerInstaller`, `registerModType`, `registerTool`, `registerLoadOrder`, `addPrelaunchHook`, `addDiagnostic`, mediated file reads, deployed-tree queries, prelaunch-write commands) and translates each call to the corresponding `vortex-api` call. When `vortex-api` changes shape, the change is absorbed in the shim and never reaches generated code.

**Test glue.** Turns a YAML `tests.cases:` entry into a Vitest `it(...)` that runs the installer engine against the fixture and asserts the plan, printing a unified diff on failure with YAML-source spans.

Versioning: the library's exported surface is SemVer'd alongside the YAML schema. The codegen and helpers ship together inside the submodule, so an extension that pins the submodule by commit gets a matched pair.

What the library is not: not a runtime YAML interpreter; not a Vortex API replacement; not a side-effecting registrar (the entry point drives all registration explicitly).

## 6. Testing

Three test paths, all running through the same installer engine the production extension calls.

**Inline cases.** `tests.cases:` in `game.yaml` declares synthetic archives — a list of paths plus optional file contents — and the expected outcome (matched installer, install plan, mod type). The codegen emits one Vitest case per entry. These run on every `pnpm test`, finish in milliseconds, and document the rule they sit next to. When a rule changes the cases that pin it move with it.

Authors can also write hand-rolled `*.test.ts` files alongside `src/hooks.ts` for cases the inline form cannot express. These import the helper library and the generated installer functions directly.

**Corpus runs.** When `tests.corpus: nexus` is set in `game.yaml`, the harness fetches every mod for the game's Nexus mod page, caches them under `tests/cache/` (gitignored), and runs each archive through the installer engine. Each archive is asserted only to install without error; the inline `tests.cases:` are where specific plan shapes are pinned. The cache is keyed by mod version, so a re-run hits the network only for new uploads. CI persists `tests/cache/` via `actions/cache`, so the per-PR network hit is bounded.

This is the same mechanism the Vortex repo's `packages/game-extension-test` harness offers, packaged so an extension repo does not have to wire it.

**Determinism.** Every test layer runs the installer engine in pure-function mode against an in-memory file list. No real filesystem; no Vortex side effects; no clock dependencies. A failing test is a real bug, not a flake.

**Shared infrastructure.** Harness wiring, corpus loader, Nexus client, CI workflow templates, and report formatter all live in the submodule. An extension repo's CI is a one-liner that uses the shared workflows.

## 7. Release pipeline

The release flow mirrors today's `game-subnautica2` flow — webpack a bundle, package as `.vortex-extension`, upload to Nexus — but every step is owned by the submodule CLI.

**Versioning.** The extension version lives in `package.json`. The codegen reads it and writes it into `info.json`. One source of truth; no version in `game.yaml`.

**Trigger.** A semver-tagged push (`v1.2.3`) on the main branch triggers the release workflow. PRs and untagged pushes trigger only the test workflow.

**Three CLI verbs:**

- `gdl build` — codegen plus webpack. Produces `dist/extension.js`, `dist/info.json`, and declared assets.
- `gdl package` — runs `gdl build`, then zips `dist/` into `dist/<id>-<version>.vortex-extension`.
- `gdl publish` — runs `gdl package`, then uploads to Nexus. Reads `NEXUS_API_KEY` and the extension's `game.yaml#nexus.modId`. Refuses to overwrite an existing version unless `--force` is passed. Posts release notes from `CHANGELOG.md` (top section) or the annotated tag's message.

`gdl publish --dry-run` runs everything except the final POST.

**Reusable workflows in `gdl/.github/workflows/`:**

- `test.yml` — checkout, install, `gdl build`, `pnpm test`. Caches `tests/cache/`.
- `release.yml` — depends on `test.yml`, then `gdl publish`, then creates a GitHub Release with the `.vortex-extension` attached as a release asset.

An extension's CI is one file:

```yaml
# extension repo: .github/workflows/ci.yml
on:
  pull_request: {}
  push:
    branches: [main]
    tags:     ['v*']

jobs:
  test:
    uses: ./gdl/.github/workflows/test.yml@<pinned-sha>
    secrets:
      NEXUS_API_KEY: ${{ secrets.NEXUS_API_KEY }}
  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: test
    uses: ./gdl/.github/workflows/release.yml@<pinned-sha>
    secrets:
      NEXUS_API_KEY: ${{ secrets.NEXUS_API_KEY }}
```

The `@<pinned-sha>` pin is the same commit the submodule is pinned at, so workflows and codegen never drift apart.

**Manual release.** `gdl publish` also runs locally with `NEXUS_API_KEY` in the environment. Same command, same checks.

**Scaffolding.** `gdl init <game-id>` creates the extension repo skeleton: a `game.yaml` template, a `package.json` whose scripts delegate to `gdl`, an empty `src/hooks.ts`, the CI file above, a `.gitignore` covering `dist/`, `.gdl-out/`, `tests/cache/`, and a `README.md` stub. The submodule is added as `gdl/` and pinned.

## 8. Schema evolution

The YAML declares its schema version at the top:

```yaml
gdl: 1
game:
  id: subnautica2
  ...
```

One major schema version per submodule release. Breaking changes (renamed keys, removed tags, changed semantics) bump major and require a coordinated submodule update plus a `gdl: N` bump in the extension. Additive changes (new optional keys, new tags) are minor and do not require extension changes. The codegen reads the declared schema version and refuses to run if it cannot handle it.

The hook signature catalog is part of the schema and SemVer'd with it. Adding a hook ID is minor; changing a hook's signature is major.

## 9. Migration and coexistence

Existing TypeScript extensions keep working. GDL-built extensions and hand-written extensions coexist in Vortex; neither knows about the other. There is no migration deadline.

The first port is `game-subnautica2`: re-authored as `game-subnautica2-gdl` and validated against the existing extension by feeding the same archives into both and diffing the install plans. That diff is the proof of correctness. Subsequent ports follow the same pattern.

A user with both a legacy `game-subnautica2` extension and a GDL-built one will get a game-ID collision; Vortex registers the first to load and ignores the second. Authors avoid this by retiring the legacy version on Nexus when the GDL version ships.

Once schema coverage is broad enough, an opt-in `gdl import <built-extension>` tool may scaffold a starter YAML by introspecting a bundled extension. Not in v1.

## 10. Non-goals and scope discipline

Stated explicitly so they do not creep in during implementation.

- **No changes to Vortex.** The Vortex extension API is what it is. The shim adapts to it; Vortex does not adapt to us.
- **Not the Worker-sandbox adaptor design from `GameAdaptorDesign.md`.** That is a future Vortex change. This project is tooling on top of today's API.
- **Not a runtime YAML interpreter.** No YAML reaches the bundle.
- **Not for general-purpose extensions.** Theming, utility panels, integrations stay on the regular extension surface. The GDL handles game support only.
- **Minimal expression surface in v1.** The predicate language starts small (equality, version comparators, membership, boolean combinators). More complex constructs — string ops, arithmetic, computed paths, lookup tables — are added in later schema minors when a concrete use case forces the question. The growth path is more typed YAML tags with declared signatures, not embedded code in strings. `!hook` remains the escape hatch for anything the schema does not yet express. The codegen's tag set is open by design: adding a tag does not require restructuring the build.
- **No automatic migration of existing extensions** in v1.
- **No Nexus mod-page management.** The author creates the mod page once and records its ID in `game.yaml#nexus.modId`. `gdl publish` uploads versions; it does not create pages.
- **No web UI** for browsing or editing extensions. JSON Schema plus IDE integration is enough.
- **No multi-game GDL repos.** Each extension is its own repo.

## 11. First deliverable

Re-author `game-subnautica2` as `game-subnautica2-gdl` using the GDL.

The acceptance criterion is concrete: take the corpus of mods that the existing extension handles correctly today, feed each through both the legacy extension and the GDL-built extension, and assert byte-for-byte equality of the install plans. Any divergence is either a schema gap (file an issue, extend a tag, port again) or a bug in the legacy extension (acceptable; the GDL version supersedes).

Re-authoring subnautica2 — UE5/UE4SS with three mod types and multiple stores — exercises store branching, archive-content matching, anchor + take installers, the composite `route:` form, and a hook for version detection. It is a non-trivial real game; if the GDL covers it cleanly, the design is validated for the class.

## 12. Glossary

- **GDL** — Game Description Language. The YAML schema plus the tooling that turns it into a Vortex extension.
- **Submodule** — the `game-description-language` repo, consumed by every extension repo at `gdl/` via `git submodule`.
- **Extension repo** — a single-game repo containing `game.yaml` and optional `src/hooks.ts`, pinned to a submodule commit.
- **Codegen** — `gdl build`; the build-time process that turns YAML into TypeScript.
- **Helper library** — the small runtime that generated code calls into for matching, interpolation, plan construction, and Vortex registration.
- **Hook** — a typed TypeScript function in `src/hooks.ts` referenced from YAML via `!hook <id>`.
- **Context** — the resolved, frozen object of named values that string interpolation, predicates, and branch tags read from at install or discovery time.
- **Tag** — a YAML type marker (`!hook`, `!storeBranch`, `!hasFile`, …) the GDL parser knows how to lower into code.
- **Corpus** — the set of archives a test run exercises an extension against, optionally pulled from Nexus.
- **Shim** — the small typed surface between generated code and `vortex-api`; absorbs upstream churn.
