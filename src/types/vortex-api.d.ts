declare module 'vortex-api' {
  export interface IGame {
    id: string;
    name: string;
    shortName?: string;
    executable: () => string;
    logo?: string;
    requiredFiles: string[];
    contributed?: string;
    environment?: Record<string, string>;
    details?: Record<string, unknown>;
    queryPath: () => Promise<string | { path: string; store?: string }>;
    mergeMods: boolean | ((mod: unknown) => string);
    queryModPath: (gamePath: string) => string;
    setup?: (discovery: { path?: string; store?: string }) => Promise<void>;
    getGameVersion?: (gamePath: string, exePath?: string) => Promise<string>;
    supportedTools?: unknown[];
  }

  export interface IModType {
    id: string;
    name: string;
    getPath: (game: IGame) => string;
    priority?: 'high' | 'low';
    test?: (instructions: unknown) => Promise<boolean>;
  }

  export interface IInstruction {
    type: 'copy';
    source: string;
    destination: string;
  }

  export interface ITestSupported {
    supported: boolean;
    requiredFiles?: string[];
  }

  export interface IInstallResult {
    instructions: (IInstruction | { type: 'setmodtype'; value: string })[];
  }

  export type TestSupportedFn = (
    files: string[],
    gameId: string,
  ) => Promise<ITestSupported>;

  export type InstallFn = (
    files: string[],
    destinationPath: string,
    gameId: string,
  ) => Promise<IInstallResult>;

  // Visibility predicate runs every render frame; return false to hide.
  export type ActionVisibilityFn = (instanceIds?: string[]) => boolean;

  // Click handler. Vortex passes instanceIds when the action is bound to a list row;
  // for the mod-icons toolbar the array is empty.
  export type ActionRunFn = (instanceIds?: string[]) => void;

  export interface IExtensionContext {
    registerGame: (game: IGame) => void;
    registerModType: (
      id: string,
      priority: number,
      isSupported: (gameId: string) => boolean,
      getPath: (game: IGame) => string,
      test: (instructions: unknown) => Promise<boolean>,
      options?: { name?: string },
    ) => void;
    registerInstaller: (
      id: string,
      priority: number,
      testSupported: TestSupportedFn,
      install: InstallFn,
    ) => void;
    registerAction: (
      group: string,
      position: number,
      iconOrComponent: string,
      options: Record<string, unknown>,
      titleOrProps: string,
      action: ActionRunFn,
      condition?: ActionVisibilityFn,
    ) => void;
    // Registers an in-game health check (diagnostic) that runs against installed
    // mods. The concrete IModHealthCheck shape lives in the real vortex-api; GDL
    // passes user-defined check objects straight through.
    registerHealthCheck: (check: IModHealthCheck) => void;
    // Vortex only populates `api.events` etc. after extension init is done; do
    // event-listener wiring inside the `once` callback so it runs at that point.
    once: (callback: () => void | PromiseLike<void>) => void;
    api: {
      getState: () => unknown;
      events: {
        on: (event: string, handler: (...args: unknown[]) => void) => void;
      };
      showDialog: (
        type: string,
        title: string,
        content: { text?: string; message?: string; bbcode?: string },
        actions: Array<{ label: string; action?: () => void }>,
      ) => Promise<unknown>;
    };
  }

  // Minimal stand-in for the real vortex-api IModHealthCheck. The full type
  // (category/severity/triggers enums + checkMod) lives in vortex-api and is
  // used by extension src/hooks.ts; GDL only needs an opaque object with an id.
  export interface IModHealthCheck {
    id: string;
    [key: string]: unknown;
  }

  export interface IFoundGame {
    gamePath: string;
    gameStoreId: string;
  }

  export const log: (level: string, message: string, meta?: unknown) => void;

  export const fs: {
    ensureDirWritableAsync: (path: string) => Promise<void>;
    statAsync: (path: string) => Promise<{ isDirectory: () => boolean }>;
  };

  export const util: {
    opn: (target: string) => Promise<void>;
    GameStoreHelper: {
      findByAppId(appId: string | string[], storeId?: string): Promise<IFoundGame | null>;
    };
  };

  export const selectors: {
    activeGameId: (state: unknown) => string | undefined;
    discoveryByGame: (state: unknown, gameId: string) => { path?: string } | undefined;
  };
}
