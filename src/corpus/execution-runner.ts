import Module from 'node:module';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { readArchiveEntries } from './archive.js';
import { makeVortexApiMock, setReadFileResolver } from './vortex-api-mock.js';

/**
 * Execution-mode corpus runner. Where the static runner (runner.ts) builds
 * install plans from lowered rules, this loads the *built* extension bundle and
 * drives its real `testSupported`/`install` chain plus health checks — so
 * custom install hooks (which read file contents) are exercised against real
 * mod manifests, exactly as the old game-extension-test harness did.
 *
 * The bundle keeps `vortex-api` external; we intercept that require to inject a
 * mock (vortex-api-mock.ts), mirroring how Vortex injects the real API.
 */

type Instruction = { type: string; destination?: string; key?: string; value?: unknown };

interface CapturedInstaller {
  id: string;
  priority: number;
  testSupported: (files: string[], gameId: string) => Promise<{ supported: boolean }>;
  install: (
    files: string[],
    destinationPath: string,
    gameId: string,
    ...rest: unknown[]
  ) => Promise<{ instructions: Instruction[] }>;
}

interface CapturedHealthCheck {
  id: string;
  checkMod: (
    api: unknown,
    modCtx: unknown,
  ) => Promise<{ status: string; severity: string; message: string; details?: string }>;
}

export interface LoadedExtension {
  gameId: string;
  installers: CapturedInstaller[];
  healthChecks: CapturedHealthCheck[];
}

interface ModuleLoad {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
}

// The bundle keeps `vortex-api`/`@nexusmods/vortex-api` external and requires
// them both at load (hook modules' top-level imports) and lazily at install
// time. We install a single persistent interceptor that diverts only those two
// specifiers to the currently active mock; everything else resolves normally.
// Scoping to those specifiers means leaving the hook in place is harmless.
let activeMock: Record<string, unknown> | undefined;
let interceptorInstalled = false;

const ensureInterceptor = (): void => {
  if (interceptorInstalled) return;
  const moduleLoad = Module as unknown as ModuleLoad;
  const originalLoad = moduleLoad._load;
  moduleLoad._load = (request, parent, isMain) =>
    (request === 'vortex-api' || request === '@nexusmods/vortex-api') && activeMock !== undefined
      ? activeMock
      : originalLoad(request, parent, isMain);
  interceptorInstalled = true;
};

/**
 * Load a built extension bundle (dist/index.js), intercepting the external
 * `vortex-api`/`@nexusmods/vortex-api` requires to return the mock, and capture
 * everything the extension registers against the context.
 */
export const loadExtensionBundle = (bundlePath: string): LoadedExtension => {
  activeMock = makeVortexApiMock();
  ensureInterceptor();

  const require = createRequire(import.meta.url);
  delete require.cache[require.resolve(bundlePath)];
  const mod: unknown = require(bundlePath);

  const m = mod as { default?: unknown; init?: unknown };
  const candidates = [m.default, m.init, mod, (m.default as { default?: unknown } | undefined)?.default];
  const main = candidates.find(c => typeof c === 'function') as ((ctx: unknown) => void) | undefined;
  if (!main) throw new Error(`extension bundle ${bundlePath} has no callable default export`);

  const installers: CapturedInstaller[] = [];
  const healthChecks: CapturedHealthCheck[] = [];
  let gameId: string | undefined;

  const base: Record<string, unknown> = {
    registerGame: (game: { id?: string }) => { gameId = game?.id; },
    registerInstaller: (
      id: string,
      priority: number,
      testSupported: CapturedInstaller['testSupported'],
      install: CapturedInstaller['install'],
    ) => { installers.push({ id, priority, testSupported, install }); },
    registerHealthCheck: (hc: CapturedHealthCheck) => { healthChecks.push(hc); },
    once: () => { /* deferred init not exercised */ },
    api: { getState: () => ({}), events: { on: () => {} } },
  };
  // Any other register*/method the extension calls is accepted as a no-op.
  const ctx = new Proxy(base, {
    get(target, prop, receiver) {
      const known = Reflect.get(target, prop, receiver);
      if (known !== undefined) return known;
      if (typeof prop === 'string' && prop.startsWith('register')) return () => {};
      return undefined;
    },
  });

  main(ctx);
  if (gameId === undefined) throw new Error(`extension bundle ${bundlePath} did not call registerGame`);
  installers.sort((a, b) => a.priority - b.priority);
  return { gameId, installers, healthChecks };
};

export interface ExecutionEntry {
  archive: string;
  matchedInstaller?: string;
  matchedModType?: string;
  planSize: number;
  healthIssues: string[];
  error?: string;
}

export interface ExecutionReport {
  total: number;
  matched: number;
  unmatched: number;
  failed: number;
  entries: ExecutionEntry[];
}

const VIRTUAL_DEST = '/virtual-dest';

// Cache file names are `<gameId>_<modId>_<fileId>_<safeUri>.json`.
const idsFromArchive = (archive: string): { manifestId: string; modId: string; fileId: string } => {
  const parts = basename(archive).split('_');
  const modId = parts[1] ?? '0';
  const fileId = parts[2] ?? '0';
  return { manifestId: `${modId}-${fileId}`, modId, fileId };
};

const fillTemplate = (
  tpl: string,
  ids: { manifestId: string; modId: string; fileId: string },
): string =>
  tpl.replace(/\$\{(manifestId|modId|fileId)\}/g, (_m, k: 'manifestId' | 'modId' | 'fileId') => ids[k]);

/**
 * Turn an installer's instructions into the IModCheckContext a health check
 * consumes: copy destinations become the file list, attribute/setmodtype
 * instructions become the attributes map. `readFile` serves synthetic content.
 */
const materialize = (
  modId: string,
  instructions: Instruction[],
  syntheticContent: Record<string, string>,
  ids: { manifestId: string; modId: string; fileId: string },
): unknown => {
  const files: string[] = [];
  const attributes: Record<string, unknown> = {};
  for (const inst of instructions) {
    if (inst.type === 'copy' && inst.destination !== undefined) files.push(inst.destination);
    else if (inst.type === 'attribute' && inst.key !== undefined) attributes[inst.key] = inst.value;
    else if (inst.type === 'setmodtype') attributes.modType = inst.value;
  }
  return {
    modId,
    files,
    attributes,
    readFile: async (rel: string): Promise<Buffer> => {
      const tpl = syntheticContent[basename(rel)];
      return tpl === undefined ? Buffer.alloc(0) : Buffer.from(fillTemplate(tpl, ids), 'utf8');
    },
  };
};

/**
 * Drive every archive through the loaded extension's real installer chain and
 * health checks.
 */
export const runExecutionCorpus = async (
  ext: LoadedExtension,
  archives: readonly string[],
  syntheticContent: Record<string, string>,
): Promise<ExecutionReport> => {
  const entries: ExecutionEntry[] = [];
  let matched = 0;
  let unmatched = 0;
  let failed = 0;

  for (const archive of archives) {
    try {
      const files = readArchiveEntries(archive);
      const ids = idsFromArchive(archive);

      // Serve synthetic content for files an installer reads (by basename).
      setReadFileResolver(async (absPath: string) => {
        const tpl = syntheticContent[basename(absPath)];
        return tpl === undefined ? Buffer.alloc(0) : Buffer.from(fillTemplate(tpl, ids), 'utf8');
      });

      let chosen: CapturedInstaller | undefined;
      for (const inst of ext.installers) {
        if ((await inst.testSupported(files, ext.gameId)).supported) { chosen = inst; break; }
      }
      if (!chosen) {
        entries.push({ archive, planSize: 0, healthIssues: [] });
        unmatched++;
        continue;
      }

      const result = await chosen.install(files, VIRTUAL_DEST, ext.gameId, () => {}, undefined, true, undefined, {});
      const instructions = result.instructions ?? [];
      const planSize = instructions.filter(i => i.type === 'copy').length;
      const modType = instructions.find(i => i.type === 'setmodtype')?.value;
      const modCtx = materialize(ids.manifestId, instructions, syntheticContent, ids);

      const healthIssues: string[] = [];
      for (const hc of ext.healthChecks) {
        const r = await hc.checkMod({}, modCtx);
        if (r.status === 'failed' || r.status === 'error') {
          healthIssues.push(`${hc.id} (${r.severity}): ${r.message}`);
        }
      }

      entries.push({
        archive,
        matchedInstaller: chosen.id,
        ...(typeof modType === 'string' && { matchedModType: modType }),
        planSize,
        healthIssues,
      });
      if (healthIssues.length > 0) failed++;
      else matched++;
    } catch (e) {
      entries.push({
        archive,
        planSize: 0,
        healthIssues: [],
        error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }

  return { total: archives.length, matched, unmatched, failed, entries };
};
