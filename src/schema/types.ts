export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
export type SupportedSchemaVersion = typeof SUPPORTED_SCHEMA_VERSIONS[number];

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
