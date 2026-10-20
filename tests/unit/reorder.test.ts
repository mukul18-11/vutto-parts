import { describe, expect, it } from "vitest";
import { poRequirement, type RequirementInput } from "@/lib/reorder";

const base: RequirementInput = {
  usableOnHand: 0,
  onOrder: 0,
  outstandingDemand: 0,
  netIssued28d: 0,
  leadTimeDays: 3,
  safetyStock: 0,
  maxQty: 20,
  isAuto: true,
  enoughHistory: true,
};

describe("poRequirement (SPEC §7.1)", () => {
  it("orders an auto part below its ROP up to max(max_qty, ROP + 1)", () => {
    // 56 issued over 28 days = 2/day, lead 3 → 6, safety 2 → ROP 8; projected 5 → order 20 − 5.
    const r = poRequirement({ ...base, usableOnHand: 5, netIssued28d: 56, safetyStock: 2 });
    expect(r).toEqual({ projected: 5, avgDailyIssue28d: 2, rop: 8, orderQty: 15 });
  });

  it("does not order an auto part above its ROP", () => {
    const r = poRequirement({ ...base, usableOnHand: 9, netIssued28d: 56, safetyStock: 2 });
    expect(r.orderQty).toBe(0);
  });

  it("orders up to ROP + 1 when that is above max_qty", () => {
    const r = poRequirement({ ...base, netIssued28d: 280, safetyStock: 2, maxQty: 5 });
    // ROP = 10 × 3 + 2 = 32; target 33.
    expect(r).toMatchObject({ rop: 32, orderQty: 33 });
  });

  it("covers a negative projection (usable 4 all reserved, 3 more needed, ROP 6, max 20 → 23)", () => {
    const r = poRequirement({
      ...base,
      usableOnHand: 4,
      outstandingDemand: 7,
      safetyStock: 6,
      enoughHistory: false,
    });
    expect(r).toEqual({ projected: -3, avgDailyIssue28d: 0, rop: 6, orderQty: 23 });
  });

  it("orders only the shortfall for an on-demand part", () => {
    const r = poRequirement({ ...base, isAuto: false, usableOnHand: 1, onOrder: 1, outstandingDemand: 4 });
    expect(r).toEqual({ projected: -2, avgDailyIssue28d: 0, rop: null, orderQty: 2 });
    expect(poRequirement({ ...base, isAuto: false, usableOnHand: 3, outstandingDemand: 1 }).orderQty).toBe(0);
  });

  it("averages slow movers without integer division (15 over 28 days, lead 3, safety 2 → ROP 4)", () => {
    const r = poRequirement({ ...base, netIssued28d: 15, leadTimeDays: 3, safetyStock: 2, usableOnHand: 10 });
    expect(r.avgDailyIssue28d).toBeCloseTo(15 / 28, 10);
    expect(r.rop).toBe(4);
  });

  it("uses ROP = safety stock with fewer than 7 days of history", () => {
    const r = poRequirement({ ...base, netIssued28d: 56, safetyStock: 2, enoughHistory: false });
    expect(r.rop).toBe(2);
  });

  it("does not round an exact usage up", () => {
    // 28 issued, lead 3 → exactly 3.
    expect(poRequirement({ ...base, netIssued28d: 28, usableOnHand: 50 }).rop).toBe(3);
  });
});
