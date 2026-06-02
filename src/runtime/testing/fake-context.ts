// A reusable fake `IExtensionContext` that records everything an extension
// registers and lets a test drive the full Vortex lifecycle:
//   default(context) → context.once() → game.setup(discovery)
//   → installer testSupported/install → modtype getPath → action run → events.emit
//
// The goal is to exercise the exact code paths Vortex runs at extension load
// time, so that bugs that only surface at lifecycle time (unbound template
// variables in setup, missing event-wiring, undefined api members) fail in CI
// instead of in user reports.
//
// Re-exported via `@gdl/runtime`. Used by GDL's own internal smoke tests AND
// by every downstream game extension's test suite.

import { vi, type Mock } from 'vitest';

// Structural types — intentionally not imported from vortex-api so the harness
// works in both GDL's own test suite (where vortex-api is a type stub) and in
// downstream extensions (where vortex-api is the real package). We only depend
// on the shape Vortex actually passes to our callbacks.

export interface FakeIGame {
  id: string;
  name: string;
  executable: () => string;
  queryPath?: () => Promise<unknown>;
  queryModPath?: (gamePath: string) => string;
  setup?: (discovery: { path?: string; store?: string }) => Promise<void>;
  getGameVersion?: (gamePath: string, exePath?: string) => Promise<string>;
  // ... other IGame fields we don't read here are ignored
}

export type FakeTestSupported = (
  files: string[],
  gameId: string,
  ...rest: unknown[]
) => Promise<{ supported: boolean; requiredFiles?: string[] }>;

export type FakeInstall = (
  files: string[],
  destinationPath: string,
  gameId: string,
  ...rest: unknown[]
) => Promise<{ instructions: unknown[] }>;

export interface RegisteredInstaller {
  id: string;
  priority: number;
  testSupported: FakeTestSupported;
  install: FakeInstall;
}

export interface RegisteredModType {
  id: string;
  priority: number;
  isSupported: (gameId: string) => boolean;
  getPath: (game: unknown) => string;
  test: (instructions: unknown) => Promise<boolean>;
  options: { name?: string } & Record<string, unknown>;
}

export interface RegisteredAction {
  group: string;
  position: number;
  iconOrComponent: unknown;
  options: unknown;
  titleOrProps: unknown;
  action?: (instanceIds?: string[]) => void;
  condition?: (instanceIds?: string[]) => boolean | string;
}

export interface FakeContextHandle {
  /** Pass to the extension's default export — type-cast to IExtensionContext. */
  context: unknown;
  /** Captures from each register* call the extension makes. */
  registered: {
    game: FakeIGame | undefined;
    installers: RegisteredInstaller[];
    modTypes: RegisteredModType[];
    actions: RegisteredAction[];
  };
  /** Vortex events the extension subscribed to (via context.once → api.events.on). */
  events: Map<string, ((...args: unknown[]) => void)[]>;
  /** Callbacks queued by context.once(); run them with `runOnce()`. */
  onceCallbacks: Array<() => void | PromiseLike<void>>;
  /** Run all queued `once` callbacks, like Vortex does once init is finished. */
  runOnce: () => Promise<void>;
  /** Fire a Vortex event to all subscribers. */
  emit: (event: string, ...args: unknown[]) => void;
  /** Convenience: run testSupported → install for the lowest-priority match. */
  runInstaller: (
    files: string[],
    gameId: string,
  ) => Promise<{ matchedId?: string; result?: { instructions: unknown[] } }>;
}

export interface FakeContextOpts {
  /** Mocked redux state visible via `api.getState()`. Default: `{}`. */
  state?: unknown;
  /** Logger callback (mock by default). */
  log?: Mock;
}

export const createFakeContext = (opts: FakeContextOpts = {}): FakeContextHandle => {
  const registered: FakeContextHandle['registered'] = {
    game: undefined,
    installers: [],
    modTypes: [],
    actions: [],
  };
  const events = new Map<string, ((...args: unknown[]) => void)[]>();
  const onceCallbacks: Array<() => void | PromiseLike<void>> = [];

  const api = {
    events: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = events.get(event) ?? [];
        list.push(handler);
        events.set(event, list);
        return api.events;
      }),
      once: vi.fn(),
      emit: vi.fn((event: string, ...args: unknown[]) => {
        for (const h of events.get(event) ?? []) h(...args);
        return true;
      }),
      removeListener: vi.fn(),
    },
    getState: vi.fn(() => opts.state ?? {}),
    store: { getState: vi.fn(() => opts.state ?? {}), dispatch: vi.fn() },
    sendNotification: vi.fn(),
    showErrorNotification: vi.fn(),
    showDialog: vi.fn(),
    log: opts.log ?? vi.fn(),
    translate: vi.fn((s: string) => s),
    locale: vi.fn(() => 'en'),
    getPath: vi.fn(() => ''),
    onStateChange: vi.fn(),
    selectFile: vi.fn(),
    selectDir: vi.fn(),
    showOpenDialog: vi.fn(),
  };

  // IExtensionContext surface — `as unknown` lets us hand this to the real type
  // without listing every register* method Vortex declares.
  const context = {
    registerGame: (g: FakeIGame) => {
      registered.game = g;
    },
    registerInstaller: (
      id: string,
      priority: number,
      testSupported: FakeTestSupported,
      install: FakeInstall,
    ) => {
      registered.installers.push({ id, priority, testSupported, install });
    },
    registerModType: (
      id: string,
      priority: number,
      isSupported: (gameId: string) => boolean,
      getPath: (game: unknown) => string,
      test: (instructions: unknown) => Promise<boolean>,
      options: { name?: string } & Record<string, unknown>,
    ) => {
      registered.modTypes.push({ id, priority, isSupported, getPath, test, options });
    },
    registerAction: (
      group: string,
      position: number,
      iconOrComponent: unknown,
      options: unknown,
      titleOrProps: unknown,
      action?: (instanceIds?: string[]) => void,
      condition?: (instanceIds?: string[]) => boolean | string,
    ) => {
      registered.actions.push({
        group,
        position,
        iconOrComponent,
        options,
        titleOrProps,
        ...(action !== undefined && { action }),
        ...(condition !== undefined && { condition }),
      });
    },
    once: (cb: () => void | PromiseLike<void>) => {
      onceCallbacks.push(cb);
    },
    onceMain: (cb: () => void) => {
      // We don't simulate the main process here — main-process callbacks run
      // as part of `runOnce()` for test convenience.
      onceCallbacks.push(cb);
    },
    api,
    // Unused-but-required parts of IExtensionContext: stub as no-ops so the
    // `as unknown as IExtensionContext` cast survives in downstream callers.
    registerSettings: vi.fn(),
    registerDeploymentMethod: vi.fn(),
    registerReducer: vi.fn(),
    registerMigration: vi.fn(),
    registerToDo: vi.fn(),
    registerDashlet: vi.fn(),
    registerStartHook: vi.fn(),
    registerArchiveType: vi.fn(),
    registerLoadOrder: vi.fn(),
    registerLoadOrderPage: vi.fn(),
    registerMerge: vi.fn(),
    registerGameInfoProvider: vi.fn(),
    registerGameStub: vi.fn(),
    registerGameStore: vi.fn(),
    registerTableAttribute: vi.fn(),
    registerMainPage: vi.fn(),
    registerOverlay: vi.fn(),
    registerProtocol: vi.fn(),
    registerInterpreter: vi.fn(),
    registerControlWrapper: vi.fn(),
    requireExtension: vi.fn(),
    requireVersion: vi.fn(),
    optional: new Proxy({}, { get: () => vi.fn() }),
  };

  return {
    context,
    registered,
    events,
    onceCallbacks,
    runOnce: async () => {
      for (const cb of onceCallbacks) await cb();
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const h of events.get(event) ?? []) h(...args);
    },
    runInstaller: async (files, gameId) => {
      const candidates = [...registered.installers].sort((a, b) => a.priority - b.priority);
      for (const inst of candidates) {
        const supported = await inst.testSupported(files, gameId, '');
        if (supported.supported) {
          const result = await inst.install(files, '/tmp/dest', gameId);
          return { matchedId: inst.id, result };
        }
      }
      return {};
    },
  };
};

/**
 * Build a Vortex `IDiscoveryResult`-shaped object for tests. Only the fields
 * Vortex actually passes to `setup(discovery)` matter for our coverage.
 */
export const fakeDiscovery = (
  path: string,
  store: string,
): { path: string; store: string } => ({ path, store });
