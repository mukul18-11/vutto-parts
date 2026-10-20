import { describe, expect, it } from "vitest";
import { paiseToInput, rupeesToPaise } from "@/lib/money";
import { acceptedQty, priceVariance, whatsappUrl } from "@/lib/purchasing";

describe("priceVariance (SPEC §7.4: 5% or more)", () => {
  it("flags exactly 5% either way", () => {
    expect(priceVariance(10000, 10500)).toBe(true);
    expect(priceVariance(10000, 9500)).toBe(true);
  });

  it("does not flag just under 5%", () => {
    expect(priceVariance(10000, 10499)).toBe(false);
    expect(priceVariance(10000, 9501)).toBe(false);
    expect(priceVariance(42000, 42000)).toBe(false);
  });

  it("uses integer maths on odd prices", () => {
    // 5% of 19999 is 999.95: a difference of 999 is below, 1000 is at or above.
    expect(priceVariance(19999, 20998)).toBe(false);
    expect(priceVariance(19999, 20999)).toBe(true);
  });

  it("is false without both prices", () => {
    expect(priceVariance(null, 100)).toBe(false);
    expect(priceVariance(100, null)).toBe(false);
  });
});

describe("acceptedQty", () => {
  it("is received minus damaged and wrong part", () => {
    expect(acceptedQty(2, 1, 0)).toBe(1);
    expect(acceptedQty(5, 1, 2)).toBe(2);
    expect(acceptedQty(1, 1, 1)).toBe(-1);
  });

  it("is null while received is blank", () => {
    expect(acceptedQty(null, 0, 0)).toBeNull();
  });
});

describe("whatsappUrl", () => {
  const text = "PO-NCR-000123\nTLA-SPL-G2 × 3 pcs @ ₹420 & more";

  it("encodes the whole message", () => {
    const url = whatsappUrl(null, text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(text);
    expect(url).not.toContain("\n");
    expect(url).not.toContain("&more");
  });

  it("uses the supplier phone in international form", () => {
    expect(whatsappUrl("+91 90000 00001", "x")).toBe("https://wa.me/919000000001?text=x");
    expect(whatsappUrl("9000000001", "x")).toBe("https://wa.me/919000000001?text=x");
    expect(whatsappUrl("09000000001", "x")).toBe("https://wa.me/919000000001?text=x");
  });

  it("drops an unusable phone", () => {
    expect(whatsappUrl("12345", "x")).toBe("https://wa.me/?text=x");
    expect(whatsappUrl("", "x")).toBe("https://wa.me/?text=x");
  });
});

describe("paiseToInput", () => {
  it.each([
    [42000, "420"],
    [19550, "195.50"],
    [1, "0.01"],
    [999999999, "9999999.99"],
  ])("%i → %s and back", (paise, text) => {
    expect(paiseToInput(paise)).toBe(text);
    expect(rupeesToPaise(text)).toBe(paise);
  });

  it("is blank without a price", () => {
    expect(paiseToInput(null)).toBe("");
    expect(paiseToInput(0)).toBe("");
  });
});
