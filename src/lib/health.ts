// public.health() returns {ok, schema_version} (SPEC §16); the version is the latest migration.

export function readSchemaVersion(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("schema_version" in data)) return null;
  const version = (data as { schema_version: unknown }).schema_version;
  return typeof version === "string" ? version : null;
}

export const DB_UNAVAILABLE_MESSAGE = "Demo database waking up or unavailable – retry in a minute";

export type HealthBody =
  | { ok: true; schema_version: string; commit: string }
  | { ok: false; code: "DATABASE_UNAVAILABLE"; message: string; commit: string };

/**
 * /api/health's response for the outcome of public.health(): 200 with the schema version, or
 * 503 with a clear body when the database is unreachable, paused or returns an error.
 */
export function healthResponse(
  result: { data: unknown; error: unknown } | "unreachable",
  commit: string,
): { status: 200 | 503; body: HealthBody } {
  const version = result === "unreachable" || result.error ? null : readSchemaVersion(result.data);
  if (version === null) {
    return { status: 503, body: { ok: false, code: "DATABASE_UNAVAILABLE", message: DB_UNAVAILABLE_MESSAGE, commit } };
  }
  return { status: 200, body: { ok: true, schema_version: version, commit } };
}

/**
 * What an error boundary shows, from a probe of /api/health made after the error: the database
 * (or the network) is down → "waking up or unavailable"; otherwise a real error with its ref.
 */
export function classifyFailure(probe: { online: boolean; status: number | null }): "unavailable" | "error" {
  if (!probe.online || probe.status === null || probe.status >= 500) return "unavailable";
  return "error";
}
