# Game Description Language

A build-time toolchain for writing Vortex game extensions as YAML.

GDL compiles `game.yaml` into a webpack-bundled TypeScript extension that Vortex loads. The YAML covers game registration, mod types, installer routing, discovery, toolbar actions, lifecycle hooks, inline tests, and Nexus release metadata. TypeScript hooks plug in where YAML can't reach.

## Quick example

`game.yaml`:

```yaml
gdl: 1

game:
  id: mygame
  name: My Game
  executable: MyGame.exe
  requiredFiles: [MyGame.exe]

stores:
  steam: 1234567

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

discovery: {}
```

Build and package:

```
gdl build
gdl package
```

Result: `dist/extension.js`, `dist/extension.js.map`, `dist/info.json`, plus `out/mygame-vortex-v0.1.0.zip` ready to upload.

## Getting started

Add GDL as a git submodule in your extension repo:

```
git submodule add https://github.com/Nexus-Mods/game-description-language gdl
cd gdl && pnpm install && pnpm build
```

Scaffold a fresh extension:

```
node gdl/dist/cli.js init --game-id mygame --game-name "My Game"
```

This writes `game.yaml`, `package.json`, `vitest.config.ts`, and a CI workflow. You edit `game.yaml`; everything else is mostly fixed.

## Features

### Game registration

The `game:` block names the game and its required files. The `stores:` block lists store ids (steam, epic, xbox, gog) that Vortex's discovery should look up. At runtime the shim calls `GameStoreHelper.findByAppId([id1, id2, ...])` with every declared id in one call, letting Vortex pick the matching install.

The optional `game.nexusDomain` field carries the game's Nexus URL slug (e.g., `subnautica2`, `skyrimspecialedition`). It distinct from `game.id` (the internal Vortex id) and `game.name` (the display name). The shim attaches it to `IGame.details.nexusPageId` so Vortex can resolve Nexus mod-page URLs and metadata lookups.

```yaml
game:
  id: subnautica2
  name: Subnautica 2
  executable: Subnautica2.exe
  requiredFiles: [Subnautica2.exe]
  nexusDomain: subnautica2
```

### Game discovery

`stores:` is the primary way GDL locates an install: the shim calls
`GameStoreHelper.findByAppId([...])` with every declared store id. When a game
can't be found that way, the `discovery:` block adds two fallbacks — a Steam
lookup by display name and explicit registry probes.

```yaml
stores:
  steam: "20900"            # primary lookup + steamAppId metadata
  gog: "1207659240"         # GOG installs are also probed in the registry (see below)

discovery:
  # Steam lookup by display name, for games findByAppId can't resolve.
  steamName: "The Witcher: Enhanced Edition Director's Cut"
  # Registry probes, tried in declared order. `hive` is HKLM or HKCU; `value`
  # names the registry value that holds the install path.
  registry:
    - { hive: HKLM, key: 'Software\CD Project Red\Witcher', value: 'InstallFolder' }
```

**Order of operations.** At discovery time the runtime tries each method in turn
and stops at the first that resolves a path:

1. **Store app-ids** — `GameStoreHelper.findByAppId([...])` over every declared `stores:` id.
2. **Derived GOG registry key** — if a `gog` store id is declared, the runtime reads
   `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<gogId>\PATH` (and the non-WOW
   `HKLM\SOFTWARE\GOG.com\Games\<gogId>\PATH` as a fallback). This is automatic: the
   `<gogId>` is the value already declared under `stores.gog`, so no extra config
   is needed to cover GOG installs that aren't registered with GOG Galaxy.
3. **Explicit `registry` probes** — each `discovery.registry` entry, in declared order.
4. **`steamName`** — `util.steam.findByName(...)`.

Registry reads only do anything on Windows (the underlying `winapi-bindings`
module is Windows-only); on other platforms they are skipped and discovery falls
through to the next method. The discovered store is tagged so `store:` branches
resolve correctly: a derived-GOG hit is tagged `gog`, a `steamName` hit `steam`,
and an explicit `registry` hit carries no store tag (its `store:` branches fall
through to the default arm).

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

### Mod types

```yaml
modTypes:
  - { id: pak, name: Paks, path: "${paksRoot}" }
  - { id: ue4ss-lua, name: UE4SS Scripts, path: "${ue4ssRoot}" }
```

Each `modType.path` is a template. The runtime re-interpolates it on every Vortex call to `getPath`, so re-discovery after a game-path change is reflected on the next path query.

### Installer routing

Two installer forms: single-anchor (most common) and route (per-file fan-out).

Single-anchor:

```yaml
- id: pak
  priority: 30
  when: { hasFile: "**/*.pak" }
  anchor: "**/*.pak"
  take: parent
  placeAt: ${paksRoot}
  modType: pak
```

The `anchor:` glob finds a marker file in the archive. `take:` picks the install root relative to the marker (`self`, `parent`, `parent.parent`, `{depth: N}`, or `archive-root` to preserve archive structure). `placeAt:` is where the install root lands.

Globs are case-insensitive (matching Windows filesystem semantics). When multiple paths match the anchor, the shallowest wins. Files outside the install root are dropped.

### Predicates

Predicates appear in `when:` (must match) and `unless:` (must not match). The language:

```yaml
# Simple
when: { hasFile: "**/*.pak" }

# Combinators
unless:
  any:
    - { hasFile: "**/LogicMods/**" }
    - { hasFile: "**/Scripts/*.lua" }

when:
  all:
    - { hasFile: "**/*.pak" }
    - { hasFile: "**/info.json" }

unless:
  not:
    { hasFile: "**/required.dll" }
```

Other forms: `{ hasFiles: [...] }` for multiple patterns, `{ matches: "regex" }` for regex against full archive paths.

### Per-store installer scope

Restrict an installer to specific stores:

```yaml
- id: xbox-injector
  priority: 15
  scope:
    stores: [xbox]
  when: { hasFile: "**/xinput1_4.dll" }
  # ...
```

### Version detection

The `discovery:` block also reports the installed game version. Use a file+regex
pair for the common case, or a TypeScript hook for anything more involved:

```yaml
discovery:
  version: { hook: detectGameVersion }
```

```yaml
discovery:
  version:
    file: ${installPath}/build.txt
    regex: 'Version=([\d.]+)'
```

`detectGameVersion` is a function exported by your `src/hooks.ts`:

```ts
export async function detectGameVersion(ctx: { gamePath: string }): Promise<string | null> {
  // Read a registry file, parse a version manifest, etc.
}
```

### Lifecycle hooks

Setup (runs once when the game is first managed):

```yaml
setup:
  ensureDirs:
    - ${paksRoot}
    - ${ue4ssRoot}
```

Each path is interpolated against context and ensured-writable via `util.fs.ensureDirWritableAsync`.

Deploy event:

```yaml
events:
  did-deploy: { hook: regenerateModsTxt }
```

Implement the hook in `src/hooks.ts`:

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
  - id: open-settings
    title: Open Settings
    priority: 200
    target: { openFile: "${ue4ssRoot}/../UE4SS-settings.ini" }

  - id: open-nexus
    title: Open Nexus Page
    priority: 201
    target: { openUrl: "https://www.nexusmods.com/mygame" }
```

Each action shows on Vortex's mod-icons toolbar when the game is active.

## Testing

Inline cases in `game.yaml` exercise the installer rules:

```yaml
tests:
  corpus: nexus
  cases:
    - name: typical pak mod
      archive:
        - MyMod/CoolPak.pak
        - MyMod/Readme.md
      expect:
        matched: pak
        modType: pak

    - name: lua mod with Scripts/ directory
      archive:
        - MyLuaMod/Scripts/main.lua
      expect:
        matched: ue4ss-lua
        plan:
          - ${ue4ssRoot}/MyLuaMod/Scripts/main.lua
```

The codegen emits these into `.gdl-out/tests.gen.ts` so vitest can run them. Each case constructs an archive, picks the winning installer by priority, and asserts the result.

For broader coverage, `gdl test:corpus --fetch` pulls real mod manifests from Nexus and replays them through the installers.

## Releasing

The `nexus:` block carries release metadata:

```yaml
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: My Game Support for Vortex
```

`gdl package` builds the bundle and zips it into `out/mygame-vortex-v<version>.zip`. The CI workflow that `gdl init` writes uses the reusable `release.yml` from this repo to upload the zip to Nexus via `Nexus-Mods/upload-action` when you push a `v*` tag.

`gdl publish-info <field>` exposes individual fields for CI scripts:

```
$ gdl publish-info mod-id
1234
$ gdl publish-info zip-name
mygame-vortex-v0.1.0.zip
```

## Architecture

The pipeline:

1. **Parser** reads `game.yaml` into a typed AST.
2. **Validator** checks the AST for malformed ids, missing fields, duplicate installer ids, and hook references that don't resolve to exported TypeScript functions.
3. **Codegen** emits `.gdl-out/extension.ts`, `installers.gen.ts`, `tests.gen.ts`, and `info.json`. Source maps thread back to the original YAML lines.
4. **Bundler** runs webpack over the generated TS with `vortex-api` marked external. Output: `dist/extension.js` plus `extension.js.map`.

The runtime in `gdl/src/runtime/` is a small shim. It translates the generated calls into Vortex's actual API (`registerGame`, `registerModType`, `registerInstaller`, `registerAction`, `api.events.on`).

## Project layout

In your extension repo:

```
my-extension/
├── game.yaml             # all the declarative stuff
├── src/hooks.ts          # optional TypeScript hooks
├── package.json          # delegates scripts to gdl
├── vitest.config.ts      # runs .gdl-out/tests.gen.ts
├── gdl/                  # this repo as a submodule
└── .github/workflows/
    └── ci.yml            # uses gdl's reusable workflows
```

## Development

Run the test suite:

```
pnpm install
pnpm build
pnpm test
```

154 tests covering the parser, validator, runtime, codegen, and end-to-end builds.

## Status

Used in production for the [game-subnautica2](https://github.com/Nexus-Mods/game-subnautica2) port (see the `gdl-port` branch). Covers the surface that hand-written Vortex game extensions typically need.

## License

GPL-3.0, matching Vortex.
