# Game Description Language

A build-time toolchain for writing Vortex game extensions as YAML.

GDL compiles `game.yaml` into a webpack-bundled TypeScript extension that Vortex loads. The YAML covers game registration, mod types, installer routing, discovery, toolbar actions, lifecycle hooks, diagnostics, inline tests, and Nexus release metadata. TypeScript hooks plug in where YAML can't reach.

GDL is the shared toolchain; the games themselves live in the [**`gdl-games`**](https://github.com/Nexus-Mods/gdl-games) monorepo, where each game is a `games/<id>/game.yaml` plus a `gameart.webp`, and one copy of this toolchain (the `gdl/` submodule) builds them all. **If you want to add or maintain a game, start there** — this README documents the toolchain itself.

## Quick example

`game.yaml`:

```yaml
gdl: 1
version: 0.1.0

game:
  id: mygame
  name: My Game
  executable: MyGame.exe
  requiredFiles: [MyGame.exe]
  logo: gameart.webp
  nexusDomain: mygame

stores:
  steam: "1234567"

context:
  paksRoot: ${installPath}/MyGame/Content/Paks/~mods

modTypes:
  - { id: pak, name: Paks, path: "${paksRoot}" }

installers:
  - id: pak
    priority: 30
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: ${paksRoot}
    modType: pak
```

Build and package:

```
gdl build
gdl package
```

Result: `dist/extension.js`, `dist/extension.js.map`, `dist/info.json`, plus `out/mygame-vortex-v0.1.0.zip` ready to upload.

## CLI

The `gdl` CLI (`dist/cli.js`) is run from inside a game folder:

```
gdl init <id> -n "Human Friendly Name"   # scaffold a starting game.yaml (emits only game.yaml)
gdl build                                # game.yaml → dist/extension.js (+ .gdl-out/, info.json)
gdl package                              # build, then zip dist/ → out/<id>-vortex-v<version>.zip
gdl test:corpus [--fetch] [--mods 1,2] [--limit N]   # run installers/validators vs Nexus manifests
gdl publish-info <field>                 # print a release field: mod-id, file-group-id, display-name, version, zip-name
```

`init` writes only `game.yaml`. In the `gdl-games` monorepo there is no per-game `package.json`, `vitest.config.ts`, or workflow — one root config and one CI serve every game.

## Features

### Game registration

The `game:` block names the game and its required files. The `stores:` block lists store ids (`steam`, `epic`, `gog`, `xbox`, `ea`, `microsoftStore`, `manual`) that Vortex's discovery should look up. At runtime the shim calls `GameStoreHelper.findByAppId([id1, id2, ...])` with every declared id in one call, letting Vortex pick the matching install. Declared store ids are also projected into `game.details` as `{storeId}AppId` keys.

The optional `game.nexusDomain` field carries the game's Nexus URL slug (e.g. `subnautica2`, `skyrimspecialedition`). It is distinct from `game.id` (the internal Vortex id) and `game.name` (the display name). The shim attaches it to `IGame.details.nexusPageId` so Vortex can resolve Nexus mod-page URLs and metadata lookups. Other optional `game:` fields: `logo` (the `gameart.webp` beside `game.yaml`), `author` (emitted into `info.json` for official-vs-community status), and `queryModPath` (a template for Vortex's default mod folder / "Open Game Mods folder" action).

```yaml
game:
  id: subnautica2
  name: Subnautica 2
  executable: Subnautica2.exe
  requiredFiles: [Subnautica2.exe]
  logo: gameart.webp
  nexusDomain: subnautica2
```

### Context bindings

The `context:` block defines path templates and values that other blocks reference via `${name}`. Branch on the discovered store, OS, or version:

```yaml
context:
  paksRoot:
    storeBranch:
      xbox: ${installPath}/Content/Paks/~mods
      default: ${installPath}/MyGame/Content/Paks/~mods
  modRoot:
    osBranch:
      windows: C:\Mods
      macos: ~/Library/Mods
      linux: ~/.mods
```

Built-in facts available to templates: `installPath`, `executablePath`, `store`, `os`, `arch`, `version`, and the Windows `appDataLocal` / `appDataLocalLow` / `appDataRoaming` paths.

### Mod types

```yaml
modTypes:
  - { id: pak, name: Paks, path: "${paksRoot}" }
  - { id: ue4ss-lua, name: UE4SS Scripts, path: "${ue4ssRoot}" }
```

Each `modType.path` is a template. The runtime re-interpolates it on every Vortex call to `getPath`, so re-discovery after a game-path change is reflected on the next path query.

### Installer routing

An installer matches archives with `when:` (must match) / `unless:` (must not match) predicates and takes exactly one of four forms:

**Single-anchor** (most common):

```yaml
- id: pak
  priority: 30
  when: { hasFile: "**/*.pak" }
  anchor: "**/*.pak"
  take: parent
  placeAt: ${paksRoot}
  modType: pak
```

The `anchor:` glob finds a marker file in the archive. `take:` picks the install root relative to the marker (`self`, `parent`, `parent.parent`, `{ depth: N }`, or `archive-root` to preserve archive structure). `placeAt:` is where the install root lands. Globs are case-insensitive (matching Windows filesystem semantics); when multiple paths match the anchor, the shallowest wins; files outside the install root are dropped.

**Route** — fan out parts of one archive to different mod types:

```yaml
- id: composite-mod
  priority: 99
  when:
    all:
      - { hasFile: "**/*.pak" }
      - { hasFile: "**/Scripts/*.lua" }
  route:
    - { match: "**/Scripts/*.lua", anchor: "**/Scripts/", take: parent, placeAt: "${ue4ssRoot}", modType: ue4ss-lua }
    - { match: "**/*.pak",         anchor: "**/*.pak",     take: parent, placeAt: "${paksRoot}",  modType: pak }
```

**Copy** — install the whole archive, optionally stripping one shared wrapper dir (mirrors Vortex's `stripCommonRoot`):

```yaml
- id: whole-archive
  priority: 50
  when: { hasFile: "**/*.dll" }
  copy: { stripCommonRoot: true }
  modType: root
```

**Custom install hook** — hand off to a TypeScript function when the routing can't be expressed declaratively (e.g. parsing a manifest to derive destinations):

```yaml
- id: content-xml
  priority: 10
  when: { hasFile: "**/content.xml" }
  install: { hook: installContentXml }
```

The hook is exported from `src/hooks.ts` and emits its own instructions, so `modType` is optional for this form.

### Predicates

Predicates appear in `when:` and `unless:`:

```yaml
when: { hasFile: "**/*.pak" }                 # single glob
when: { hasFiles: ["**/*.pak", "**/*.ucas"] } # multiple globs
when: { matches: "regex against full paths" } # regex

when:
  all:
    - { hasFile: "**/*.pak" }
    - { hasFile: "**/info.json" }
unless:
  any:
    - { hasFile: "**/LogicMods/**" }
    - { hasFile: "**/Scripts/*.lua" }
```

`all`, `any`, and `not` combine sub-predicates.

### Per-store installer scope

Restrict an installer to specific stores:

```yaml
- id: xbox-injector
  priority: 15
  scope: { stores: [xbox] }
  when: { hasFile: "**/xinput1_4.dll" }
  # ...
```

### Discovery

The optional `discovery:` block detects the game version, either declaratively from a file or via a hook:

```yaml
discovery:
  version: { file: version.txt, regex: "v([0-9.]+)" }   # capture group 1 is the version
# or
discovery:
  version: { hook: detectGameVersion }
```

`detectGameVersion` is exported from your `src/hooks.ts`:

```ts
export async function detectGameVersion(ctx: { gamePath: string }): Promise<string | null> {
  // Read a registry file, parse a version manifest, etc.
}
```

### Lifecycle hooks

Setup (runs once when the game is first managed) ensures directories exist via `util.fs.ensureDirWritableAsync`:

```yaml
setup:
  ensureDirs:
    - ${paksRoot}
    - ${ue4ssRoot}
```

Deploy event — wire a hook to Vortex's `did-deploy`:

```yaml
events:
  did-deploy: { hook: regenerateModsTxt }
```

```ts
export async function regenerateModsTxt(ctx: {
  profileId: string;
  deployment: unknown;
  api: unknown;
}): Promise<void> {
  // Scan the deployed mods folder, write mods.txt
}
```

### Toolbar actions

```yaml
toolbarActions:
  - { id: open-settings, title: Open Settings,   priority: 200, target: { openFile: "${ue4ssRoot}/../UE4SS-settings.ini" } }
  - { id: open-nexus,    title: Open Nexus Page, priority: 201, target: { openUrl: "https://www.nexusmods.com/mygame" } }
```

Each action shows on Vortex's mod-icons toolbar when the game is active.

### Diagnostics

The `diagnostics:` block registers in-game health checks. Each entry names an `IModHealthCheck` exported from `src/hooks.ts`, registered at runtime via `context.registerHealthCheck`:

```yaml
diagnostics:
  - hook: modHasFilesCheck
  - hook: modShapeRecognisedCheck
```

## Testing

### Inline cases

Inline cases in `game.yaml` exercise the installer rules:

```yaml
tests:
  corpus: nexus
  cases:
    - name: typical pak mod
      archive: [MyMod/CoolPak.pak, MyMod/Readme.md]
      expect:
        matched: pak
        modType: pak
    - name: lua mod with Scripts/ directory
      archive: [MyLuaMod/Scripts/main.lua]
      expect:
        matched: ue4ss-lua
        plan:
          - ${ue4ssRoot}/MyLuaMod/Scripts/main.lua
```

The codegen emits these into `.gdl-out/tests.gen.ts` so vitest can run them. It also emits per-store lifecycle tests (`lifecycle.gen.ts`) that exercise `setup.ensureDirs`, `queryModPath`, and event wiring against the built bundle.

### Validators

The `validators:` block adds predicate-driven placement assertions, run as part of the test suite:

```yaml
validators:
  - id: paks-land-in-paks
    name: Pak files install under Content/Paks
    when: { hasFile: "**/*.pak" }
    assert:
      matched: pak
      modType: pak
      placement:
        - { files: "**/*.pak", mustMatch: "**/Content/Paks/**" }
        - { files: "**/*.exe", mustNotMatch: "${installPath}/*" }
```

### Corpus

For broader coverage, `gdl test:corpus --fetch` pulls real mod manifests from Nexus (needs `NEXUS_API_KEY`) into `tests/cache/` and replays them through the installers and validators. It is a local check, not wired into CI.

## Releasing

The `nexus:` block carries release metadata. Add it only once the extension's Nexus page exists — GDL rejects `0`/placeholder ids at build time:

```yaml
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: My Game Support for Vortex
```

Releases in `gdl-games` are gated on a **version bump**, not hand-typed tags:

1. Bump the top-level `version:` in `games/<id>/game.yaml`.
2. Make sure `nexus:` and `stores:` carry real ids (no `PLACEHOLDER`/`0`).
3. Merge to `main`.

CI then walks every game; for each one whose `version` has no matching `<id>-v<version>` git tag yet, it packages the extension, creates a GitHub release (the tag doubles as the "already-published" ledger), and uploads to Nexus Mods via `Nexus-Mods/upload-action`. Unchanged versions are skipped, and a placeholder guard refuses to publish any game still carrying stub ids.

`gdl publish-info <field>` exposes individual fields for CI scripts:

```
$ gdl publish-info mod-id
1234
$ gdl publish-info zip-name
mygame-vortex-v0.1.0.zip
```

## Architecture

The pipeline:

1. **Parser** (`src/parser/`) reads `game.yaml` into a typed AST.
2. **Validator** (`src/schema/`) checks the AST for malformed ids, missing fields, duplicate installer ids, placeholder nexus ids, and hook references that don't resolve to exported TypeScript functions.
3. **Codegen** (`src/codegen/`) emits `.gdl-out/extension.ts`, `installers.gen.ts`, `tests.gen.ts`, `lifecycle.gen.ts`, and `info.json`. Source maps thread back to the original YAML lines.
4. **Bundler** (`src/bundler/`) runs webpack over the generated TS with `vortex-api` marked external. Output: `dist/extension.js` plus `extension.js.map`.

The runtime in `src/runtime/` is a small shim. It translates the generated calls into Vortex's actual API (`registerGame`, `registerModType`, `registerInstaller`, `registerAction`, `api.events.on`, `registerHealthCheck`).

The CLI subcommands (`build`, `init`, `package`, `publish-info`, `test:corpus`) live under `src/commands/`.

## Project layout (in gdl-games)

A game in the [`gdl-games`](https://github.com/Nexus-Mods/gdl-games) monorepo is just:

```
games/<id>/
├── game.yaml        # all the declarative stuff (incl. top-level version:)
├── gameart.webp     # the logo
└── src/hooks.ts     # optional — version detection / deploy hooks / diagnostics
```

There is no per-game `package.json`, `vitest.config.ts`, or workflow. The shared `gdl/` submodule, root config, and one `ci.yml` serve every game; an Nx inference plugin turns each `game.yaml` into a project with cached `build` / `test` / `package` / `test-corpus` targets.

## Working on GDL itself

```
git clone https://github.com/Nexus-Mods/game-description-language.git
cd game-description-language && pnpm install
pnpm build        # tsc + copy templates into dist/
pnpm test         # vitest
pnpm test:watch   # iterate
pnpm typecheck    # tsc --noEmit
```

GDL has no separate version or tag release; the `gdl/` submodule commit pin in `gdl-games` is the release boundary. After landing a change, bump the pointer in `gdl-games` (update the submodule, run `pnpm init-gdl`, commit the new gitlink). Nx cache keys include the gdl commit, so every game rebuilds and re-tests on the bump.

The vitest suite covers the parser, validator, runtime, codegen, corpus tooling, and end-to-end builds.

## Status

Used in production for the Vortex extensions in [`gdl-games`](https://github.com/Nexus-Mods/gdl-games) (Subnautica 2 and others). Covers the surface that hand-written Vortex game extensions typically need.

## License

GPL-3.0, matching Vortex.
