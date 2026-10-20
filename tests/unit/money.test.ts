import { describe, expect, it } from "vitest";
import { formatINR, rupeesToPaise } from "@/lib/money";

describe("rupeesToPaise", () => {
  it.each([
    ["195.5", 19550],
    ["1,250", 125000],
    ["₹ 99.99", 9999],
    ["₹1,23,456.50", 12345650],
    ["0.01", 1],
    ["  42 ", 4200],
    ["9999999.99", 999999999],
  ])("parses %j as %i paise", (input, paise) => {
    expect(rupeesToPaise(input)).toBe(paise);
  });

  it.each(["1.005", "-5", "", "0", "0.00", "₹", "12.", ".5", "1e3", "abc", "10000000", "5.5.5"])(
    "rejects %j",
    (input) => {
      expect(rupeesToPaise(input)).toBeNull();
    },
  );
});

describe("formatINR", () => {
  it.each([
    [12345650, "₹1,23,456.50"],
    [0, "₹0.00"],
    [5, "₹0.05"],
    [19550, "₹195.50"],
    [999999999, "₹99,99,999.99"],
    [-150, "-₹1.50"],
  ])("formats %i paise as %j", (paise, text) => {
    expect(formatINR(paise)).toBe(text);
  });

  it("rejects non-integer paise", () => {
    expect(() => formatINR(1.5)).toThrow(RangeError);
  });
});
