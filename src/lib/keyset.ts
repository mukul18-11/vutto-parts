// Keyset pagination cursors for lists ordered by (timestamp desc, id desc) or (text asc). A cursor
// is the sort key of the last (or first) row shown, base64url-encoded into ?after= / ?before=.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export type TimeCursor = { ts: string; id: string };

export function encodeCursor(cursor: TimeCursor): string {
  return Buffer.from(`${cursor.ts}|${cursor.id}`, "utf8").toString("base64url");
}

/** null for anything that is not a cursor we made (a tampered URL just shows the first page). */
export function decodeCursor(value: string | undefined | null): TimeCursor | null {
  if (!value || value.length > 200) return null;
  const [ts, id, extra] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (extra !== undefined || !ts || !id || !TS.test(ts) || !UUID.test(id)) return null;
  return { ts, id };
}

/**
 * PostgREST or-filter for rows after the cursor in (col desc, id desc) order, or before it
 * (direction "before", for the previous page, fetched ascending and then reversed).
 */
export function keysetFilter(col: string, cursor: TimeCursor, direction: "after" | "before"): string {
  const op = direction === "after" ? "lt" : "gt";
  return `${col}.${op}."${cursor.ts}",and(${col}.eq."${cursor.ts}",id.${op}.${cursor.id})`;
}
