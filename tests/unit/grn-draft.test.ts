import { describe, expect, it } from "vitest";
import { clearGrnDraft, GRN_DRAFT_TTL_MS, grnDraftKey, loadGrnDraft, saveGrnDraft, type GrnDraft } from "@/lib/grn-draft";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const PO = "po-1";
const USER = "user-1";
const T0 = 1_760_000_000_000;
const draft: GrnDraft = {
  requestId: "11111111-2222-4333-8444-555555555555",
  invoiceNo: "INV-9",
  invoiceDate: "2026-10-20",
  lines: { l1: { received: 2, damagedOpen: true, damaged: 1, wrongPart: 0, priceText: "420" } },
};

describe("GRN drafts", () => {
  it("round-trips entries and the request_id", () => {
    const s = memoryStorage();
    saveGrnDraft(s, PO, USER, draft, T0);
    expect(loadGrnDraft(s, PO, USER, T0 + 1000)).toEqual(draft);
  });

  it("is kept per PO and per user", () => {
    const s = memoryStorage();
    saveGrnDraft(s, PO, USER, draft, T0);
    expect(loadGrnDraft(s, PO, "user-2", T0)).toBeNull();
    expect(loadGrnDraft(s, "po-2", USER, T0)).toBeNull();
    expect(grnDraftKey(PO, USER)).toBe("grn-draft:po-1:user-1");
  });

  it("expires after 24 hours and is removed", () => {
    const s = memoryStorage();
    saveGrnDraft(s, PO, USER, draft, T0);
    expect(loadGrnDraft(s, PO, USER, T0 + GRN_DRAFT_TTL_MS - 1)).toEqual(draft);
    expect(loadGrnDraft(s, PO, USER, T0 + GRN_DRAFT_TTL_MS)).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it("drops a draft saved in the future (clock change) or malformed", () => {
    const s = memoryStorage();
    saveGrnDraft(s, PO, USER, draft, T0 + 60_000);
    expect(loadGrnDraft(s, PO, USER, T0)).toBeNull();
    s.setItem(grnDraftKey(PO, USER), "{not json");
    expect(loadGrnDraft(s, PO, USER, T0)).toBeNull();
    s.setItem(grnDraftKey(PO, USER), JSON.stringify({ v: 2, savedAt: T0 }));
    expect(loadGrnDraft(s, PO, USER, T0)).toBeNull();
  });

  it("clears on success", () => {
    const s = memoryStorage();
    saveGrnDraft(s, PO, USER, draft, T0);
    clearGrnDraft(s, PO, USER);
    expect(loadGrnDraft(s, PO, USER, T0)).toBeNull();
  });

  it("works without storage, or when storage throws", () => {
    expect(loadGrnDraft(null, PO, USER, T0)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveGrnDraft(broken, PO, USER, draft, T0)).not.toThrow();
    expect(loadGrnDraft(broken, PO, USER, T0)).toBeNull();
    expect(() => clearGrnDraft(broken, PO, USER)).not.toThrow();
  });
});
