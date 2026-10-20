// public.health() returns {ok, schema_version} (SPEC §16); the version is the latest migration.

export function readSchemaVersion(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("schema_version" in data)) return null;
  const version = (data as { schema_version: unknown }).schema_version;
  return typeof version === "string" ? version : null;
}
