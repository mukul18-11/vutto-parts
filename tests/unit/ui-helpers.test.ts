import { describe, expect, it } from "vitest";
import { canPlainClose, closeEffects, type CloseLine } from "@/lib/close-effects";
import { decodeCursor, encodeCursor, keysetFilter } from "@/lib/keyset";
import { withWs } from "@/lib/links";
import { parseAliases, parseBikeSearch, safeTerm } from "@/lib/search-term";

const ID = "0f8f1a3e-1111-4c4c-9a9a-123456789abc";

describe("keyset cursors", () => {
  it("round-trip a timestamp and id", () => {
    const cursor = { ts: "2026-10-20T04:12:33.123456+00:00", id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("reject anything else", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-20|x").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-10-20T04:12:33Z|${ID}|x`).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-10-20T04:12:33Z),id.gt.(x|${ID}`).toString("base64url"))).toBeNull();
  });

  it("build the after and before filters", () => {
    const cursor = { ts: "2026-10-20T04:12:33Z", id: ID };
    expect(keysetFilter("purchased_at", cursor, "after")).toBe(
      `purchased_at.lt."2026-10-20T04:12:33Z",and(purchased_at.eq."2026-10-20T04:12:33Z",id.lt.${ID})`,
    );
    expect(keysetFilter("purchased_at", cursor, "before")).toContain("id.gt.");
  });
});

describe("bike search", () => {
  it("treats JC codes as card codes", () => {
    expect(parseBikeSearch("jc-ncr-000123")).toEqual({ kind: "card", code: "JC-NCR-000123" });
    expect(parseBikeSearch("JC NCR 12")).toEqual({ kind: "card", code: "JC-NCR-12" });
    expect(parseBikeSearch("jc")).toBeNull();
  });

  it("normalises a reg suffix to letters and digits", () => {
    expect(parseBikeSearch(" ab 12-34 ")).toEqual({ kind: "reg", suffix: "AB1234" });
    expect(parseBikeSearch("1234")).toEqual({ kind: "reg", suffix: "1234" });
    expect(parseBikeSearch("%,()")).toBeNull();
    expect(parseBikeSearch(undefined)).toBeNull();
  });

  it("strips filter metacharacters from catalogue terms", () => {
    expect(safeTerm("brake, (shoe)%*")).toBe("brake shoe");
    expect(safeTerm("ब्रेक शू")).toBe("ब्रेक शू");
    expect(safeTerm("x".repeat(50))).toHaveLength(40);
  });
});

describe("parseAliases", () => {
  it("trims, drops empties and de-duplicates case-insensitively", () => {
    expect(parseAliases(" mobil, Mobil ,race  wire,, break shoe ")).toEqual(["mobil", "race wire", "break shoe"]);
    expect(parseAliases("")).toEqual([]);
  });
});

describe("closeEffects", () => {
  const line = (over: Partial<CloseLine>): CloseLine => ({
    id: "l1",
    sku: "OIL",
    qty_required: 2,
    qty_reserved: 0,
    qty_issued: 2,
    qty_returned: 0,
    ...over,
  });

  it("is empty when every line is fully issued and nothing is reserved", () => {
    expect(closeEffects([line({})])).toEqual([]);
    expect(canPlainClose([line({})], null)).toBe(true);
    expect(canPlainClose([line({})], "wrong_fitment: X")).toBe(false);
  });

  it("lists released reservations, reduced quantities and cancelled lines", () => {
    const effects = closeEffects([
      line({ id: "a", sku: "A", qty_required: 3, qty_reserved: 1, qty_issued: 2, qty_returned: 1 }),
      line({ id: "b", sku: "B", qty_required: 2, qty_reserved: 2, qty_issued: 0 }),
      line({ id: "c", sku: "C" }),
    ]);
    expect(effects).toEqual([
      { line_id: "a", sku: "A", release: 1, from_required: 3, to_required: 1, cancels: false },
      { line_id: "b", sku: "B", release: 2, from_required: 2, to_required: 0, cancels: true },
    ]);
  });
});

describe("withWs", () => {
  it("keeps the admin workshop only", () => {
    expect(withWs("/bikes", "admin", "JPR")).toBe("/bikes?ws=JPR");
    expect(withWs("/bikes?status=ready", "admin", "JPR")).toBe("/bikes?status=ready&ws=JPR");
    expect(withWs("/bikes", "manager", "NCR")).toBe("/bikes");
  });
});
