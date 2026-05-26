export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Returns an extension-safe identifier: if the game ID starts with a digit,
 * prefix it with `game-` so that generated filenames and extension IDs are
 * always valid npm package / Vortex extension names.
 */
export const extensionId = (gameId: string): string =>
  /^\d/.test(gameId) ? `game-${gameId}` : gameId;
