// GRN entry drafts (receiving screen): the store keeper's entries and the request_id survive a
// reload or a lost connection for 24 h, per (PO, user), in localStorage. Browser storage may be
// missing or throw (private mode); every access is guarded and the form works without it.

export const GRN_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type GrnDraftLine = {
  received: number | null;
  damagedOpen: boolean;
  damaged: number;
  wrongPart: number;
  priceText: string;
};

export type GrnDraft = {
  requestId: string;
  invoiceNo: string;
  invoiceDate: string;
  lines: Record<string, GrnDraftLine>;
};

type Stored = GrnDraft & { v: 1; savedAt: number };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function grnDraftKey(poId: string, userId: string): string {
  return `grn-draft:${poId}:${userId}`;
}

export function loadGrnDraft(storage: StorageLike | null, poId: string, userId: string, now: number): GrnDraft | null {
  if (!storage) return null;
  const key = grnDraftKey(poId, userId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const fresh = typeof parsed.savedAt === "number" && now - parsed.savedAt < GRN_DRAFT_TTL_MS && now >= parsed.savedAt;
    if (parsed.v !== 1 || !fresh || typeof parsed.requestId !== "string" || typeof parsed.lines !== "object") {
      storage.removeItem(key);
      return null;
    }
    return {
      requestId: parsed.requestId,
      invoiceNo: typeof parsed.invoiceNo === "string" ? parsed.invoiceNo : "",
      invoiceDate: typeof parsed.invoiceDate === "string" ? parsed.invoiceDate : "",
      lines: parsed.lines ?? {},
    };
  } catch {
    return null;
  }
}

export function saveGrnDraft(storage: StorageLike | null, poId: string, userId: string, draft: GrnDraft, now: number) {
  if (!storage) return;
  try {
    const stored: Stored = { v: 1, savedAt: now, ...draft };
    storage.setItem(grnDraftKey(poId, userId), JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the form keeps working without a draft.
  }
}

export function clearGrnDraft(storage: StorageLike | null, poId: string, userId: string) {
  if (!storage) return;
  try {
    storage.removeItem(grnDraftKey(poId, userId));
  } catch {
    // Ignored, as above.
  }
}

/** window.localStorage, or null when the browser refuses access. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
