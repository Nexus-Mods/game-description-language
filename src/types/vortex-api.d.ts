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
    queryModPath: () => string;
    setup?: (discovery: { path?: string }) => Promise<void>;
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
    api: {
      getState: () => unknown;
    };
  }

  export interface IFoundGame {
    gamePath: string;
    gameStoreId: string;
  }

  export const GameStoreHelper: {
    findByAppId(appId: string | string[], storeId?: string): Promise<IFoundGame | null>;
  };

  export const log: (level: string, message: string, meta?: unknown) => void;

  export const util: {
    opn: (target: string) => Promise<void>;
  };

  export const selectors: {
    activeGameId: (state: unknown) => string | undefined;
  };
}
