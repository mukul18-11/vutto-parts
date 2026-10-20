// Search box terms for the bikes list (SPEC §14 search by reg-no suffix or job card code) and the
// catalogue. Terms end up inside PostgREST filters, so they are reduced to safe characters here.

export type BikeSearch = { kind: "card"; code: string } | { kind: "reg"; suffix: string } | null;

/** "JC-NCR-12" → card code contains "JC-NCR-12"; anything else → reg_no_norm ends with A–Z0–9. */
export function parseBikeSearch(input: string | undefined | null): BikeSearch {
  const raw = (input ?? "").trim().toUpperCase();
  if (/^JC[-\s]?/.test(raw)) {
    const code = raw.replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
    return code.length >= 3 ? { kind: "card", code } : null;
  }
  const suffix = raw.replace(/[^A-Z0-9]/g, "");
  return suffix ? { kind: "reg", suffix } : null;
}

/** A catalogue search term with PostgREST and LIKE metacharacters removed (max 40 chars). */
export function safeTerm(input: string | undefined | null): string {
  return (input ?? "")
    .replace(/[^\p{L}\p{M}\p{N}\s\-./]/gu, "")
    .trim()
    .slice(0, 40);
}

/** Comma-separated aliases → trimmed, de-duplicated (case-insensitive), non-empty list. */
export function parseAliases(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(",")) {
    const alias = part.trim().replace(/\s+/g, " ");
    const key = alias.toLowerCase();
    if (alias && !seen.has(key)) {
      seen.add(key);
      out.push(alias);
    }
  }
  return out;
}
