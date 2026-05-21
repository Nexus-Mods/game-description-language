# GDL Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the release infrastructure for GDL-based extensions: `gdl package` (build + zip), `gdl publish-info` (CI-friendly accessor), `gdl init` (scaffold a new extension repo), and a reusable `release.yml` workflow that the extension repo references with zero per-extension parameters. **No actual Nexus uploads happen during this plan** — the workflow is wired but only fires on a `v*` tag push, and no such tag is pushed.

**Architecture:** All release metadata lives in `game.yaml`'s `nexus:` block (`modId`, `fileGroupId`, `displayName`). The `publish-info <field>` CLI verb reads from that block and prints to stdout; the reusable workflow shells out to it for every value, so an extension's `.github/workflows/ci.yml` has two `uses:` lines and no per-extension config. Packaging is a thin wrapper around the existing `gdl build` + a zip step. The init scaffolder writes a fixed set of small template files.

**Tech Stack:** Existing stack (Node 22, TypeScript 5.4, `yaml@2`, `vitest@3`, `webpack@5`, `commander@12`, `adm-zip@0.5`, `pnpm@11`). The release workflow uses the published `Nexus-Mods/upload-action@main` action — we do not write a Nexus upload client.

**Spec reference:** `docs/superpowers/specs/2026-05-20-game-description-language-design.md`, §7 (release pipeline).

---

## File structure (delta from Plan 3)

```
game-description-language/
├── src/
│   ├── parser/
│   │   ├── ast.ts                                # +NexusNode
│   │   └── index.ts                              # +parse nexus block
│   ├── schema/
│   │   └── validator.ts                          # +validate nexus block
│   ├── packaging/                   (new dir)
│   │   └── zip.ts                                # zipDist(cwd) → archivePath
│   ├── commands/
│   │   ├── package.ts               (new)        # gdl package
│   │   ├── publish-info.ts          (new)        # gdl publish-info <field>
│   │   └── init.ts                  (new)        # gdl init <game-id>
│   ├── templates/                   (new dir)    # init scaffold sources
│   │   ├── game.yaml.tmpl                        # minimal game.yaml
│   │   ├── package.json.tmpl                     # delegates scripts to gdl
│   │   ├── ci.yml.tmpl                           # 10-line CI
│   │   ├── gitignore.tmpl                        # node_modules, dist, .gdl-out, tests/cache
│   │   └── README.md.tmpl                        # quickstart
│   └── cli.ts                                    # register package/publish-info/init
├── .github/
│   └── workflows/
│       ├── test.yml                              # already exists
│       └── release.yml              (new)        # reusable, reads via publish-info
└── tests/
    ├── packaging-zip.test.ts        (new)
    ├── publish-info.test.ts         (new)
    ├── init.test.ts                 (new)
    ├── parser.test.ts                            # +nexus block parsing
    ├── validator.test.ts                         # +nexus block validation
    ├── e2e.test.ts                               # +package E2E
    └── fixtures/
        └── e2e/                                  # game.yaml gets a nexus block
```

---

## Task 1: AST + parser + validator for `nexus:` block

**Files:**
- Modify: `src/parser/ast.ts`
- Modify: `src/parser/index.ts`
- Modify: `src/schema/validator.ts`
- Modify: `tests/parser.test.ts`
- Modify: `tests/validator.test.ts`

The `nexus:` block carries the three values the release workflow needs.

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
}
```

Add the new type at the bottom:

```ts
export interface NexusNode extends Node {
  kind: 'nexus';
  modId: number;             // Nexus mod page id (the user-visible mod-page id, e.g. 1234)
  fileGroupId: number;       // Numeric file-group id Nexus assigns to your mod page's uploads
  displayName: string;       // Human-friendly name shown on the upload, e.g. "Subnautica 2 Support for Vortex"
}
```

- [ ] **Step 2: Failing parser test**

Append inside `describe('parseYaml')` in `tests/parser.test.ts`:

```ts
  it('parses nexus block with modId, fileGroupId, displayName', () => {
    const doc = parseYaml(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: Hello World Support for Vortex
`, 'inline.yaml');
    expect(doc.nexus).toBeDefined();
    expect(doc.nexus!.modId).toBe(1234);
    expect(doc.nexus!.fileGroupId).toBe(7418978);
    expect(doc.nexus!.displayName).toBe('Hello World Support for Vortex');
  });
```

Run: `pnpm test parser`
Expected: FAIL — `doc.nexus` undefined.

- [ ] **Step 3: Extend `src/parser/index.ts`**

Add `NexusNode` to the type imports from `./ast.js`:

```ts
import type {
  // ... existing imports ...
  NexusNode,
} from './ast.js';
```

After the tests block parsing (or before the return, alongside other optional blocks), add:

```ts
const nexusYaml = root.get('nexus', true);
let nexus: NexusNode | undefined;
if (isMap(nexusYaml)) {
  nexus = {
    kind: 'nexus',
    modId:       Number(nexusYaml.get('modId') ?? 0),
    fileGroupId: Number(nexusYaml.get('fileGroupId') ?? 0),
    displayName: String(nexusYaml.get('displayName') ?? ''),
    span: spanOf(file, source, nexusYaml as YamlNode),
  };
}
```

Add to the return literal (conditional spread):

```ts
...(nexus !== undefined && { nexus }),
```

- [ ] **Step 4: Failing validator test**

Append inside `describe('validate')` in `tests/validator.test.ts`:

```ts
  it('rejects nexus block with missing modId', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 0
  fileGroupId: 7418978
  displayName: Hello
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL130')).toBe(true);
  });

  it('rejects nexus block with missing displayName', () => {
    const doc = tinyDoc(`
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: ""
`);
    const errors = validate(doc);
    expect(errors.some(e => e.code === 'GDL132')).toBe(true);
  });
```

Run: `pnpm test validator`
Expected: FAIL.

- [ ] **Step 5: Extend `src/schema/validator.ts`**

After the existing `if (doc.tests) { ... }` block, before `return errors;`, add:

```ts
if (doc.nexus) {
  if (!Number.isInteger(doc.nexus.modId) || doc.nexus.modId <= 0) {
    errors.push({
      code: 'GDL130',
      message: '`nexus.modId` must be a positive integer (the mod-page id on Nexus)',
      span: doc.nexus.span,
    });
  }
  if (!Number.isInteger(doc.nexus.fileGroupId) || doc.nexus.fileGroupId <= 0) {
    errors.push({
      code: 'GDL131',
      message: '`nexus.fileGroupId` must be a positive integer (the file-group id Nexus assigns to your mod page)',
      span: doc.nexus.span,
    });
  }
  if (!doc.nexus.displayName.trim()) {
    errors.push({
      code: 'GDL132',
      message: '`nexus.displayName` is required (human-friendly name shown on uploads)',
      span: doc.nexus.span,
    });
  }
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm test parser validator`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass (existing + 3 new).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/parser/ast.ts src/parser/index.ts src/schema/validator.ts \
        tests/parser.test.ts tests/validator.test.ts
git commit -m "Parse and validate the nexus block (modId, fileGroupId, displayName)"
```

---

## Task 2: Packaging — `zipDist` helper

**Files:**
- Create: `src/packaging/zip.ts`
- Create: `tests/packaging-zip.test.ts`

A small helper that zips `dist/` into a named archive. Mirrors what `game-subnautica2`'s `scripts/package.mjs` does, but uses `adm-zip` (already a dep) instead of the system `zip` binary so it's cross-platform.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { zipDist, type ZipDistOptions } from '../src/packaging/zip.js';

describe('zipDist', () => {
  it('produces a zip containing dist/* at the archive root', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gdl-zip-'));
    mkdirSync(join(cwd, 'dist'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'extension.js'), 'console.log("x");');
    writeFileSync(join(cwd, 'dist', 'extension.js.map'), '{"version":3}');
    writeFileSync(join(cwd, 'dist', 'info.json'),     '{"id":"x","name":"X","version":"0.1.0"}');

    const opts: ZipDistOptions = { cwd, archiveName: 'x-v0.1.0.zip', outDir: 'out' };
    const path = await zipDist(opts);
    expect(path.endsWith('x-v0.1.0.zip')).toBe(true);
    expect(existsSync(path)).toBe(true);

    const zip = new AdmZip(path);
    const names = zip.getEntries().map(e => e.entryName).sort();
    expect(names).toEqual([
      'extension.js',
      'extension.js.map',
      'info.json',
    ]);
  });

  it('throws when dist/ does not exist', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gdl-zip-empty-'));
    await expect(
      zipDist({ cwd, archiveName: 'x.zip', outDir: 'out' })
    ).rejects.toThrow(/dist/);
  });
});
```

Run: `pnpm test packaging-zip`
Expected: FAIL.

- [ ] **Step 2: Implement `src/packaging/zip.ts`**

```ts
import AdmZip from 'adm-zip';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface ZipDistOptions {
  cwd: string;            // directory containing dist/
  archiveName: string;    // e.g. "subnautica2-vortex-v1.0.0.zip"
  outDir: string;         // typically "out" or "dist"
}

const addDir = (zip: AdmZip, baseDir: string, currentDir: string): void => {
  for (const entry of readdirSync(currentDir)) {
    const full = join(currentDir, entry);
    const stats = statSync(full);
    const rel = relative(baseDir, full).replace(/\\/g, '/');
    if (stats.isDirectory()) {
      addDir(zip, baseDir, full);
    } else {
      zip.addLocalFile(full, dirOf(rel));
    }
  }
};

// adm-zip's addLocalFile takes a directory inside the archive; '' for root.
const dirOf = (rel: string): string => {
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? '' : rel.slice(0, idx);
};

export const zipDist = async (opts: ZipDistOptions): Promise<string> => {
  const distDir = join(opts.cwd, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`dist/ does not exist at ${distDir}; run \`gdl build\` first`);
  }
  await mkdir(join(opts.cwd, opts.outDir), { recursive: true });
  const archivePath = join(opts.cwd, opts.outDir, opts.archiveName);

  const zip = new AdmZip();
  addDir(zip, distDir, distDir);
  zip.writeZip(archivePath);
  return archivePath;
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm test packaging-zip`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/packaging/zip.ts tests/packaging-zip.test.ts
git commit -m "Add zipDist helper for packaging dist/ into a Nexus-shaped zip"
```

---

## Task 3: CLI — `gdl package`

**Files:**
- Create: `src/commands/package.ts`
- Modify: `src/cli.ts`

`gdl package` runs `gdl build` then `zipDist`, naming the archive `<gameId>-vortex-v<version>.zip` per the subnautica2 convention.

- [ ] **Step 1: Create `src/commands/package.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildExtension } from './build.js';
import { zipDist } from '../packaging/zip.js';
import { parseYaml } from '../parser/index.js';

export interface PackageArgs {
  cwd: string;
  yamlPath?: string;
}

export interface PackageResult {
  archivePath: string;
}

const archiveNameFor = (gameId: string, version: string): string =>
  `${gameId}-vortex-v${version}.zip`;

export const packageExtension = async (args: PackageArgs): Promise<PackageResult> => {
  await buildExtension({
    cwd: args.cwd,
    ...(args.yamlPath !== undefined && { yamlPath: args.yamlPath }),
  });

  // Read game.id and package.json#version to construct the archive name.
  const yamlPath = args.yamlPath ?? join(args.cwd, 'game.yaml');
  const yamlSrc  = await readFile(yamlPath, 'utf8');
  const doc      = parseYaml(yamlSrc, yamlPath);

  let version = '0.0.0';
  try {
    const pkg = JSON.parse(await readFile(join(args.cwd, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string') version = pkg.version;
  } catch { /* tolerate missing package.json */ }

  const archivePath = await zipDist({
    cwd: args.cwd,
    archiveName: archiveNameFor(doc.game.id, version),
    outDir: 'out',
  });
  return { archivePath };
};
```

- [ ] **Step 2: Register the command in `src/cli.ts`**

Add the import at the top:

```ts
import { packageExtension } from './commands/package.js';
```

Add the command below the existing ones:

```ts
program
  .command('package')
  .description('Build the extension and zip dist/ into out/<game-id>-vortex-v<version>.zip')
  .option('-y, --yaml <path>', 'path to game.yaml')
  .action(async (opts: { yaml?: string }) => {
    try {
      const result = await packageExtension({
        cwd: process.cwd(),
        ...(opts.yaml !== undefined && { yamlPath: opts.yaml }),
      });
      process.stdout.write(`Packaged: ${result.archivePath}\n`);
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
Expected: `package` listed alongside `build` and `test:corpus`.

Run: `pnpm typecheck`
Expected: exits 0.

Run: `pnpm test`
Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/package.ts src/cli.ts
git commit -m "Add gdl package CLI: build + zip to out/<id>-vortex-v<ver>.zip"
```

---

## Task 4: CLI — `gdl publish-info <field>`

**Files:**
- Create: `src/commands/publish-info.ts`
- Create: `tests/publish-info.test.ts`
- Modify: `src/cli.ts`

The CI workflow shells out to this command for every value it needs to pass to `Nexus-Mods/upload-action`. Field names match the YAML keys plus two derived ones (`zip-name`, `version`).

- [ ] **Step 1: Failing test in `tests/publish-info.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePublishInfo, type PublishInfoField } from '../src/commands/publish-info.js';

const writeFixture = (yaml: string, pkgVersion = '1.2.3'): string => {
  const dir = mkdtempSync(join(tmpdir(), 'gdl-pubinfo-'));
  writeFileSync(join(dir, 'game.yaml'), yaml);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: pkgVersion }));
  return dir;
};

const VALID = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 7418978
  displayName: Hello World Support for Vortex
`;

describe('resolvePublishInfo', () => {
  it('returns file-group-id from the nexus block', async () => {
    const cwd = writeFixture(VALID);
    expect(await resolvePublishInfo(cwd, 'file-group-id')).toBe('7418978');
  });

  it('returns display-name from the nexus block', async () => {
    const cwd = writeFixture(VALID);
    expect(await resolvePublishInfo(cwd, 'display-name')).toBe('Hello World Support for Vortex');
  });

  it('returns version from package.json', async () => {
    const cwd = writeFixture(VALID, '4.5.6');
    expect(await resolvePublishInfo(cwd, 'version')).toBe('4.5.6');
  });

  it('returns zip-name computed from game id and version', async () => {
    const cwd = writeFixture(VALID, '4.5.6');
    expect(await resolvePublishInfo(cwd, 'zip-name')).toBe('helloworld-vortex-v4.5.6.zip');
  });

  it('throws when the nexus block is missing', async () => {
    const cwd = writeFixture(`
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`);
    await expect(resolvePublishInfo(cwd, 'file-group-id'))
      .rejects.toThrow(/nexus/);
  });

  it('throws on unknown field', async () => {
    const cwd = writeFixture(VALID);
    await expect(resolvePublishInfo(cwd, 'cheese' as PublishInfoField))
      .rejects.toThrow(/unknown field/i);
  });
});
```

Run: `pnpm test publish-info`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/commands/publish-info.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';

export type PublishInfoField =
  | 'mod-id'
  | 'file-group-id'
  | 'display-name'
  | 'version'
  | 'zip-name';

export const resolvePublishInfo = async (
  cwd: string,
  field: PublishInfoField,
): Promise<string> => {
  const yamlPath = join(cwd, 'game.yaml');
  const doc = parseYaml(await readFile(yamlPath, 'utf8'), yamlPath);

  if (field === 'version' || field === 'zip-name') {
    let version = '0.0.0';
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
      if (typeof pkg.version === 'string') version = pkg.version;
    } catch { /* tolerate */ }
    if (field === 'version') return version;
    return `${doc.game.id}-vortex-v${version}.zip`;
  }

  if (!doc.nexus) {
    throw new Error(`game.yaml has no nexus block; \`publish-info ${field}\` cannot resolve.`);
  }
  if (field === 'mod-id')        return String(doc.nexus.modId);
  if (field === 'file-group-id') return String(doc.nexus.fileGroupId);
  if (field === 'display-name')  return doc.nexus.displayName;

  throw new Error(`unknown field: ${String(field)}`);
};
```

- [ ] **Step 3: Register the command in `src/cli.ts`**

Add the import at the top:

```ts
import { resolvePublishInfo, type PublishInfoField } from './commands/publish-info.js';
```

Add the command:

```ts
program
  .command('publish-info <field>')
  .description('Print a release-pipeline metadata value from game.yaml. Fields: mod-id, file-group-id, display-name, version, zip-name')
  .action(async (field: string) => {
    try {
      const value = await resolvePublishInfo(process.cwd(), field as PublishInfoField);
      process.stdout.write(value);   // no trailing newline — CI consumes raw
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Run tests**

Run: `pnpm test publish-info`
Expected: PASS (6 cases).

Run: `pnpm build && node dist/cli.js --help`
Expected: `publish-info` listed.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/commands/publish-info.ts src/cli.ts tests/publish-info.test.ts
git commit -m "Add gdl publish-info CLI: print release metadata fields from game.yaml"
```

---

## Task 5: Init templates

**Files:**
- Create: `src/templates/game.yaml.tmpl`
- Create: `src/templates/package.json.tmpl`
- Create: `src/templates/ci.yml.tmpl`
- Create: `src/templates/gitignore.tmpl`
- Create: `src/templates/README.md.tmpl`

The template files are static text with `{{GAME_ID}}` placeholders. Pure data files — no logic.

- [ ] **Step 1: Create `src/templates/game.yaml.tmpl`**

```yaml
gdl: 1

game:
  id: {{GAME_ID}}
  name: {{GAME_NAME}}
  executable: {{GAME_ID}}.exe
  requiredFiles:
    - {{GAME_ID}}.exe

stores:
  steam: 0    # replace with the game's Steam app id

modTypes: []     # add one entry per mod type the game supports

installers: []   # add installer rules

nexus:
  modId: 0          # the mod-page id from your nexusmods.com URL (e.g. /mods/1234 → 1234)
  fileGroupId: 0    # the file-group id Nexus shows on the upload page
  displayName: {{GAME_NAME}} Support for Vortex

tests:
  corpus: off
  cases: []
```

- [ ] **Step 2: Create `src/templates/package.json.tmpl`**

```json
{
  "name": "game-{{GAME_ID}}",
  "version": "0.0.1",
  "private": true,
  "packageManager": "pnpm@11.0.9",
  "engines": { "node": ">=22" },
  "scripts": {
    "build":       "node gdl/dist/cli.js build",
    "test":        "node gdl/dist/cli.js build && vitest run .gdl-out/tests.gen.ts",
    "test:corpus": "node gdl/dist/cli.js test:corpus",
    "package":     "node gdl/dist/cli.js package"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `src/templates/ci.yml.tmpl`**

```yaml
name: CI

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

jobs:
  test:
    uses: ./gdl/.github/workflows/test.yml@main
    secrets: inherit

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: test
    uses: ./gdl/.github/workflows/release.yml@main
    secrets: inherit
```

- [ ] **Step 4: Create `src/templates/gitignore.tmpl`**

```
node_modules/
dist/
.gdl-out/
out/
tests/cache/
*.log
.DS_Store
```

- [ ] **Step 5: Create `src/templates/README.md.tmpl`**

```markdown
# {{GAME_NAME}} support for Vortex (GDL)

GDL-based Vortex extension for {{GAME_NAME}}. The game's behavior is described in
[`game.yaml`](./game.yaml); the GDL toolchain in [`gdl/`](./gdl/) compiles it into a
Vortex extension bundle.

## Develop

```bash
pnpm install
pnpm run build    # compiles game.yaml → dist/extension.js
pnpm test         # runs inline test cases from game.yaml
```

## Release

Bump `package.json#version`, commit, tag `v<version>`, push. CI does the rest.

## Files

| Path                | Purpose                                            |
|---------------------|----------------------------------------------------|
| `game.yaml`         | The whole extension definition                     |
| `src/hooks.ts`      | TypeScript hooks (version detection, etc.) — optional |
| `gdl/`              | The GDL toolchain (git submodule, pinned)          |
| `tests/cache/`      | Cached Nexus archive manifests (gitignored)        |
| `.gdl-out/`         | Generated TS + maps + tests (gitignored)           |
| `dist/`             | Webpack bundle output (gitignored)                 |
```

- [ ] **Step 6: Commit**

```bash
git add src/templates/
git commit -m "Add init scaffolder templates (game.yaml, package.json, ci.yml, gitignore, README)"
```

---

## Task 6: CLI — `gdl init <game-id>`

**Files:**
- Create: `src/commands/init.ts`
- Create: `tests/init.test.ts`
- Modify: `src/cli.ts`

Scaffolds a new extension repo from the templates with `{{GAME_ID}}` / `{{GAME_NAME}}` substitution.

- [ ] **Step 1: Failing test in `tests/init.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initExtension } from '../src/commands/init.js';

describe('initExtension', () => {
  it('scaffolds an extension repo with all template files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-'));
    await initExtension({ cwd: dir, gameId: 'subnautica2', gameName: 'Subnautica 2' });

    for (const f of ['game.yaml', 'package.json', '.gitignore', 'README.md', '.github/workflows/ci.yml']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }

    const gameYaml = readFileSync(join(dir, 'game.yaml'), 'utf8');
    expect(gameYaml).toContain('id: subnautica2');
    expect(gameYaml).toContain('displayName: Subnautica 2 Support for Vortex');

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('game-subnautica2');

    const ci = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('uses: ./gdl/.github/workflows/test.yml@main');
    expect(ci).toContain('uses: ./gdl/.github/workflows/release.yml@main');
  });

  it('refuses to overwrite an existing game.yaml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-init-clash-'));
    await initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' });
    await expect(initExtension({ cwd: dir, gameId: 'foo', gameName: 'Foo' }))
      .rejects.toThrow(/already exists/);
  });
});
```

Run: `pnpm test init`
Expected: FAIL.

- [ ] **Step 2: Implement `src/commands/init.ts`**

```ts
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatesDir = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  // At runtime this resolves to dist/commands; templates live at src/templates.
  // We ship templates by copying them into dist/templates at build time — see
  // package.json's "files" / a tiny pre-publish step. For now use src/templates
  // relative to the package root.
  return join(here, '..', '..', 'src', 'templates');
};

export interface InitArgs {
  cwd: string;
  gameId: string;
  gameName: string;
}

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch { return false; }
};

const substitute = (content: string, args: InitArgs): string =>
  content
    .replace(/\{\{GAME_ID\}\}/g,   args.gameId)
    .replace(/\{\{GAME_NAME\}\}/g, args.gameName);

const TEMPLATES: { src: string; dst: string }[] = [
  { src: 'game.yaml.tmpl',     dst: 'game.yaml' },
  { src: 'package.json.tmpl',  dst: 'package.json' },
  { src: 'gitignore.tmpl',     dst: '.gitignore' },
  { src: 'README.md.tmpl',     dst: 'README.md' },
  { src: 'ci.yml.tmpl',        dst: '.github/workflows/ci.yml' },
];

export const initExtension = async (args: InitArgs): Promise<void> => {
  const targetGameYaml = join(args.cwd, 'game.yaml');
  if (await exists(targetGameYaml)) {
    throw new Error(`game.yaml already exists at ${targetGameYaml}; refusing to overwrite`);
  }
  for (const { src, dst } of TEMPLATES) {
    const template = await readFile(join(templatesDir(), src), 'utf8');
    const out = substitute(template, args);
    const outPath = join(args.cwd, dst);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, out, 'utf8');
  }
};
```

- [ ] **Step 3: Register the command in `src/cli.ts`**

Add the import:

```ts
import { initExtension } from './commands/init.js';
```

Add the command:

```ts
program
  .command('init <gameId>')
  .description('Scaffold a new GDL extension repo for a game')
  .option('-n, --name <name>', 'human-friendly game name', '')
  .action(async (gameId: string, opts: { name?: string }) => {
    try {
      const gameName = opts.name && opts.name.trim() ? opts.name : gameId;
      await initExtension({ cwd: process.cwd(), gameId, gameName });
      process.stdout.write(`Scaffolded ${gameId} in ${process.cwd()}\n`);
      process.stdout.write(`Next: add the GDL submodule with: git submodule add https://github.com/Nexus-Mods/game-description-language gdl\n`);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Update build to copy templates to dist/**

The `templatesDir()` resolver assumes `src/templates/` is reachable from the dist binary. When the package is built, `tsc` only emits TS files, not templates. Add a small build step.

Edit `package.json`'s `build` script:

```json
"build": "tsc -p tsconfig.json && cp -r src/templates dist/templates"
```

(Cross-platform note: this uses `cp` which is unix-only. If Windows support matters, swap for a small Node script. For now this is the standard pattern.)

Also update `templatesDir()` to handle both layouts (dev: src/templates; built: dist/templates):

```ts
const templatesDir = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Built layout: dist/commands/init.js → dist/templates
  // Dev layout (vitest): src/commands/init.ts → src/templates
  const built = join(here, '..', 'templates');
  const dev   = join(here, '..', '..', 'src', 'templates');
  // Prefer dist when available (running from compiled CLI); fall back to src for tests.
  return existsSyncFn(built) ? built : dev;
};
```

Add the import:

```ts
import { existsSync as existsSyncFn } from 'node:fs';
```

- [ ] **Step 5: Run tests**

Run: `pnpm test init`
Expected: PASS (both cases).

Run: `pnpm build`
Expected: clean. `dist/templates/` exists with all 5 templates.

Run: `node dist/cli.js init --help`
Expected: usage text for init.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts src/cli.ts package.json tests/init.test.ts
git commit -m "Add gdl init CLI: scaffold a new extension repo from templates"
```

---

## Task 7: Reusable release workflow

**Files:**
- Create: `.github/workflows/release.yml`

The workflow reads metadata via `publish-info`, packages, and calls the published `Nexus-Mods/upload-action`. Extension repos `uses:` this with no inputs.

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: gdl-release

on:
  workflow_call:
    secrets:
      NEXUS_API_KEY:
        required: true

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    concurrency:
      group: release-${{ github.ref }}
      cancel-in-progress: false
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

      - name: Verify tag matches package.json version
        run: |
          PKG_VERSION="$(node -p "require('./package.json').version")"
          TAG_VERSION="${GITHUB_REF#refs/tags/v}"
          if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
            echo "::error::Tag v$TAG_VERSION does not match package.json version $PKG_VERSION"
            exit 1
          fi

      - name: Read publish metadata from game.yaml
        id: meta
        run: |
          {
            echo "file_group_id=$(node gdl/dist/cli.js publish-info file-group-id)"
            echo "display_name=$(node gdl/dist/cli.js publish-info display-name)"
            echo "zip_name=$(node gdl/dist/cli.js publish-info zip-name)"
            echo "version=$(node gdl/dist/cli.js publish-info version)"
          } >> "$GITHUB_OUTPUT"

      - name: Package
        run: node gdl/dist/cli.js package

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: out/${{ steps.meta.outputs.zip_name }}
          generate_release_notes: true

      - name: Publish to Nexus Mods
        uses: Nexus-Mods/upload-action@main
        with:
          api_key:        ${{ secrets.NEXUS_API_KEY }}
          file_group_id:  ${{ steps.meta.outputs.file_group_id }}
          display_name:   ${{ steps.meta.outputs.display_name }}
          filename:       out/${{ steps.meta.outputs.zip_name }}
          version:        ${{ steps.meta.outputs.version }}
```

> **Note on safety:** this workflow only fires on `workflow_call` from a calling workflow. The extension repo's `ci.yml` invokes it only when the ref starts with `refs/tags/v`. No tag = no release. As long as nobody pushes a `v*` tag, nothing publishes. The Nexus-Mods/upload-action is a separately-maintained published action; we don't need to test it ourselves.

- [ ] **Step 2: Sanity-check the YAML**

Visually verify indentation. If you have `yamllint` available, run it.

Run: `pnpm test`
Expected: still passing — no code references this file directly.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Add reusable release workflow (Nexus-Mods/upload-action + GH Release)"
```

---

## Task 8: E2E — `gdl package` against a real fixture

**Files:**
- Modify: `tests/fixtures/e2e/game.yaml` — add nexus block
- Modify: `tests/e2e.test.ts`

Verify the full `gdl package` path produces a valid zip in `out/`.

- [ ] **Step 1: Append a `nexus:` block to `tests/fixtures/e2e/game.yaml`**

Add at the bottom (after the existing `tests:` block):

```yaml
nexus:
  modId: 1234
  fileGroupId: 5678
  displayName: Hello World Support for Vortex
```

- [ ] **Step 2: Add an E2E test in `tests/e2e.test.ts`**

```ts
describe('end-to-end (package)', () => {
  it('gdl package produces out/<id>-vortex-v<version>.zip', async () => {
    const work = mkdtempSync(join(tmpdir(), 'gdl-package-'));
    cpSync(join(import.meta.dirname, 'fixtures', 'e2e'), work, { recursive: true });

    const { packageExtension } = await import('../src/commands/package.js');
    const result = await packageExtension({ cwd: work });
    expect(result.archivePath.endsWith('helloworld-vortex-v0.1.0.zip')).toBe(true);
    expect(existsSync(result.archivePath)).toBe(true);

    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(result.archivePath);
    const names = zip.getEntries().map(e => e.entryName).sort();
    // dist/ contains extension.js + extension.js.map + info.json (per current emit).
    expect(names).toContain('extension.js');
    expect(names).toContain('info.json');
  }, 60000);
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm test e2e`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/e2e/game.yaml tests/e2e.test.ts
git commit -m "E2E: gdl package produces a Nexus-shaped zip from a real fixture"
```

---

## Task 9: Sparse-extension smoke test

**Files:**
- Create: `tests/sparse-extension.test.ts`

A test that proves the design promise: a freshly-`init`'d extension repo, with the GDL submodule symlinked in, contains just 5 files at the root + 1 in `.github/workflows/` and still builds. This pins the "sparse extension" guarantee.

- [ ] **Step 1: Failing test in `tests/sparse-extension.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('sparse extension', () => {
  it('a freshly-init repo has only the expected files and builds end-to-end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdl-sparse-'));
    const { initExtension } = await import('../src/commands/init.js');
    await initExtension({ cwd: dir, gameId: 'helloworld', gameName: 'Hello World' });

    // Sparse check: only the templated files exist at the repo root.
    const rootEntries = readdirSync(dir).sort();
    expect(rootEntries).toEqual([
      '.github',
      '.gitignore',
      'README.md',
      'game.yaml',
      'package.json',
    ]);
    expect(readdirSync(join(dir, '.github', 'workflows'))).toEqual(['ci.yml']);

    // Replace the stubby game.yaml with one that actually has installers, so the
    // build doesn't fail-fast on validation. The user would do this manually.
    writeFileSync(join(dir, 'game.yaml'), `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
nexus:
  modId: 1234
  fileGroupId: 5678
  displayName: Hello World Support for Vortex
`);

    // Symlink the submodule into place.
    const gdlRoot = resolve(import.meta.dirname, '..');
    symlinkSync(gdlRoot, join(dir, 'gdl'), 'dir');

    // Build the extension via the same path the scaffolded package.json does.
    const { buildExtension } = await import('../src/commands/build.js');
    await buildExtension({ cwd: dir });

    expect(existsSync(join(dir, 'dist', 'extension.js'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'info.json'))).toBe(true);
  }, 60000);
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test sparse-extension`
Expected: PASS.

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/sparse-extension.test.ts
git commit -m "Test: a freshly-init'd extension is sparse and still builds end-to-end"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `pnpm test` — all suites pass
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm build` — produces dist/cli.js with `build`, `test:corpus`, `package`, `publish-info`, `init`
- [ ] `dist/templates/` exists after build (init won't work without it)
- [ ] `node dist/cli.js publish-info file-group-id` works in a fixture dir
- [ ] `.github/workflows/release.yml` references `Nexus-Mods/upload-action@main` and reads metadata via `publish-info`
- [ ] An extension repo's `ci.yml` (templated) is two `uses:` blocks — no per-extension config

---

## What this plan does not deliver (and where it goes)

- **Actual Nexus uploads** — by design. The workflow is wired but only fires on a `v*` tag push. No tag is pushed by this plan or by any test.
- **Real `game-subnautica2` port + diff against the legacy bundle** → Plan 5.
- **`gdl publish` as a standalone CLI verb** — replaced by `publish-info` + the published `Nexus-Mods/upload-action`. If a local-publish flow is needed in the future (manual release without GH Actions), add a thin `gdl publish` that shells out to a small Nexus upload script. Plan 4 deliberately does not include this.
- **Windows-friendly `build` script** — currently uses `cp -r src/templates dist/templates`. Replace with a Node script if a Windows GDL-developer workflow becomes necessary.
- **Full structural signature matching for hooks** (carryover debt from Plan 2).
- **Live mod-id enumeration for the corpus runner** (carryover debt from Plan 3).
