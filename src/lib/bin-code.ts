// Bin codes (SPEC §3.1): ^(NCR|JPR)-([A-Z][0-9]{2}-[0-9]{2}|RCV|QRN)$. The QR label holds exactly
// the code. Shared by the bin picker's scanner and typeahead (SPEC §14).

export const BIN_CODE_RE = /^(NCR|JPR)-([A-Z][0-9]{2}-[0-9]{2}|RCV|QRN)$/;

export type WorkshopCode = "NCR" | "JPR";
export type BinKind = "normal" | "receiving" | "quarantine";

export type ParsedBinCode = { code: string; workshopCode: WorkshopCode; kind: BinKind };

/** Normalises what a person types or a label holds: trimmed, uppercase, no inner spaces. */
export function normalizeBinInput(text: string): string {
  return text.trim().toUpperCase().replace(/\s+/g, "");
}

export function parseBinCode(text: string): ParsedBinCode | null {
  const code = normalizeBinInput(text);
  const match = BIN_CODE_RE.exec(code);
  if (!match) return null;
  const suffix = match[2];
  const kind: BinKind = suffix === "RCV" ? "receiving" : suffix === "QRN" ? "quarantine" : "normal";
  return { code, workshopCode: match[1] as WorkshopCode, kind };
}

export type ScanResult =
  | { ok: true; code: string }
  | { ok: false; reason: "not_bin" }
  | { ok: false; reason: "other_workshop"; workshopCode: WorkshopCode };

/** A scanned QR is accepted only when it is a bin code of the user's workshop (SPEC §14). */
export function classifyScan(text: string, workshopCode: string): ScanResult {
  const parsed = parseBinCode(text);
  if (!parsed) return { ok: false, reason: "not_bin" };
  if (parsed.workshopCode !== workshopCode) return { ok: false, reason: "other_workshop", workshopCode: parsed.workshopCode };
  return { ok: true, code: parsed.code };
}

export type CameraErrorKey = "denied" | "none" | "busy" | "other";

/** Maps a getUserMedia failure to the inline guidance shown under the scanner. */
export function cameraErrorKey(error: unknown): CameraErrorKey {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "none";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "other";
}
