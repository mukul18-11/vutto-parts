import { describe, expect, it } from "vitest";
import {
  emergencyIssued,
  emergencyQtyCap,
  isHighPremium,
  issueMax,
  needsSecondTap,
  parseStoreSearch,
  premiumPercent,
  returnEffects,
  returnNeedsBin,
  returnNoteOk,
} from "@/lib/store";

describe("parseStoreSearch", () => {
  it("matches a reg-no suffix, and a digits-only term also the card number suffix", () => {
    expect(parseStoreSearch("1234")).toEqual({ kind: "reg", suffix: "1234", alsoCode: true });
    expect(parseStoreSearch(" sab-1234 ")).toEqual({ kind: "reg", suffix: "SAB1234", alsoCode: false });
    expect(parseStoreSearch("dl3sab1234")).toEqual({ kind: "reg", suffix: "DL3SAB1234", alsoCode: false });
  });

  it("normalizes a job card code with or without workshop and leading zeros", () => {
    expect(parseStoreSearch("JC-NCR-002368")).toEqual({ kind: "card", pattern: "JCNCR%2368" });
    expect(parseStoreSearch("jc ncr 2368")).toEqual({ kind: "card", pattern: "JCNCR%2368" });
    expect(parseStoreSearch("JC 12")).toEqual({ kind: "card", pattern: "JC%12" });
  });

  it("keeps only A–Z0–9 (safe in a PostgREST filter) and ignores empty input", () => {
    expect(parseStoreSearch("")).toBeNull();
    expect(parseStoreSearch("  -,()*  ")).toBeNull();
    expect(parseStoreSearch("12,reg_no.eq.x")).toEqual({ kind: "reg", suffix: "12REGNOEQX", alsoCode: false });
  });
});

describe("issueMax", () => {
  it("caps at the reservation and the bin quantity", () => {
    expect(issueMax(3, 10)).toBe(3);
    expect(issueMax(3, 2)).toBe(2);
    expect(issueMax(3, 0)).toBe(0);
    expect(issueMax(3, null)).toBe(3);
    expect(issueMax(0, 5)).toBe(0);
  });
});

describe("needsSecondTap", () => {
  it("is true for amber and red only", () => {
    expect(needsSecondTap("green")).toBe(false);
    expect(needsSecondTap("amber")).toBe(true);
    expect(needsSecondTap("red")).toBe(true);
    expect(needsSecondTap(null)).toBe(false);
  });
});

describe("emergency premium", () => {
  it("is red only above 25% over the reference", () => {
    expect(isHighPremium(12_500, 10_000)).toBe(false);
    expect(isHighPremium(12_501, 10_000)).toBe(true);
    expect(isHighPremium(9_000, 10_000)).toBe(false);
    expect(isHighPremium(99_999, null)).toBe(false);
    expect(isHighPremium(99_999, 0)).toBe(false);
  });

  it("is a whole percent, null without a reference", () => {
    expect(premiumPercent(12_500, 10_000)).toBe(25);
    expect(premiumPercent(9_000, 10_000)).toBe(-10);
    expect(premiumPercent(10_001, 30_000)).toBe(-67);
    expect(premiumPercent(100, null)).toBeNull();
  });
});

describe("emergency qty", () => {
  it("caps at the remaining need until overridden, then at 50", () => {
    expect(emergencyQtyCap(2, false)).toBe(2);
    expect(emergencyQtyCap(0, false)).toBe(1);
    expect(emergencyQtyCap(2, true)).toBe(50);
    expect(emergencyQtyCap(80, false)).toBe(50);
  });

  it("issues at most the remaining need, nothing when the card cannot take parts", () => {
    expect(emergencyIssued(3, 2, true)).toBe(2);
    expect(emergencyIssued(1, 2, true)).toBe(1);
    expect(emergencyIssued(3, 0, true)).toBe(0);
    expect(emergencyIssued(3, 2, false)).toBe(0);
  });
});

describe("returns", () => {
  it("needs a bin except for damaged, and a 5-character note for wrong fit", () => {
    expect(returnNeedsBin("damaged")).toBe(false);
    expect(returnNeedsBin("not_needed")).toBe(true);
    expect(returnNoteOk("wrong_fitment", "nope")).toBe(false);
    expect(returnNoteOk("wrong_fitment", " rubs disc ")).toBe(true);
    expect(returnNoteOk("not_needed", "")).toBe(true);
    expect(returnNoteOk("damaged", "x".repeat(501))).toBe(false);
  });

  it("states the effect of each reason", () => {
    const base = { qty: 1, uom: "set", bin: "NCR-QRN", sku: "BS-1", again: 0, others: 0 };
    expect(returnEffects("damaged", { ...base, again: 1 }).map((e) => e.key)).toEqual([
      "returns.effect.quarantined",
      "returns.effect.reopenedReserved",
    ]);
    expect(returnEffects("damaged", base).map((e) => e.key)).toEqual(["returns.effect.quarantined", "returns.effect.reopenedWaiting"]);
    expect(returnEffects("issued_by_mistake", { ...base, bin: "NCR-A01-01", again: 1 })[1]).toEqual({
      key: "returns.effect.reopenedReserved",
      vars: { n: 1, uom: "set" },
    });
    expect(returnEffects("not_needed", { ...base, others: 1 }).map((e) => e.key)).toEqual([
      "returns.effect.toBin",
      "returns.effect.needLowered",
      "returns.effect.otherBikes",
    ]);
    expect(returnEffects("wrong_fitment", base).map((e) => e.key)).toEqual(["returns.effect.toBin", "returns.effect.wrongFit"]);
  });
});
