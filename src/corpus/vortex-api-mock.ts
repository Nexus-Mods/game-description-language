/**
 * A minimal stand-in for the `vortex-api` / `@nexusmods/vortex-api` module that
 * Vortex injects at runtime. The corpus loads a built extension bundle (which
 * keeps the API external) and intercepts those requires to return this mock, so
 * custom install hooks and health checks can run outside Vortex.
 *
 * The surface mirrors the parts extensions actually touch (mostly `fs`, `util`,
 * and the `types` health-check enums). It is intentionally small; extend it when
 * a real extension exercises a member that isn't here.
 */

// Module-level mutable resolver. The corpus runs fixtures sequentially, so a
// shared resolver is safe to swap between fixtures (each fixture installs its
// own synthetic content before driving the installer).
let readFileResolver: (absPath: string) => Promise<Buffer | string> = async () => Buffer.alloc(0);

export const setReadFileResolver = (
  resolver: (absPath: string) => Promise<Buffer | string>,
): void => {
  readFileResolver = resolver;
};

class DataInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataInvalid';
  }
}

class ProcessCanceled extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessCanceled';
  }
}

// Hand-mirror of the string enums in Vortex's IHealthCheck.ts. Values change
// rarely; a real corpus run against an extension catches any drift.
const HealthCheckCategory = {
  System: 'system',
  Game: 'game',
  Mods: 'mods',
  Requirements: 'requirements',
  Tools: 'tools',
  Performance: 'performance',
  Legacy: 'legacy',
} as const;

const HealthCheckSeverity = {
  Info: 'info',
  Warning: 'warning',
  Error: 'error',
  Critical: 'critical',
} as const;

const HealthCheckTrigger = {
  Manual: 'manual',
  Startup: 'startup',
  GameChanged: 'game-changed',
  ProfileChanged: 'profile-changed',
  ModsChanged: 'mods-changed',
  ResultsChanged: 'health-check-results-changed',
  SettingsChanged: 'settings-changed',
  PluginsChanged: 'plugins-changed',
  LootUpdated: 'loot-updated',
  Scheduled: 'scheduled',
} as const;

/**
 * Build the mock module object returned for `require('vortex-api')` and
 * `require('@nexusmods/vortex-api')` while a corpus fixture runs.
 */
export const makeVortexApiMock = (): Record<string, unknown> => ({
  fs: {
    readFileAsync: (absPath: string, _opts?: unknown): Promise<Buffer | string> =>
      readFileResolver(absPath),
    ensureDirWritableAsync: async (): Promise<void> => {},
  },
  util: {
    DataInvalid,
    ProcessCanceled,
    opn: async (): Promise<void> => {},
    getGame: (): undefined => undefined,
    GameStoreHelper: { findByAppId: async (): Promise<null> => null },
  },
  types: { HealthCheckCategory, HealthCheckSeverity, HealthCheckTrigger },
  selectors: { activeGameId: (): string => '', discoveryByGame: (): unknown => ({}) },
  log: (): void => {},
});
