import { describe, expect, it } from "vitest";
import { BIN_CODE_RE, cameraErrorKey, classifyScan, normalizeBinInput, parseBinCode } from "@/lib/bin-code";

describe("parseBinCode", () => {
  it.each([
    ["NCR-A01-03", { code: "NCR-A01-03", workshopCode: "NCR", kind: "normal" }],
    ["JPR-RCV", { code: "JPR-RCV", workshopCode: "JPR", kind: "receiving" }],
    ["NCR-QRN", { code: "NCR-QRN", workshopCode: "NCR", kind: "quarantine" }],
    ["  ncr-b12-40 ", { code: "NCR-B12-40", workshopCode: "NCR", kind: "normal" }],
  ])("parses %j", (input, expected) => {
    expect(parseBinCode(input)).toEqual(expected);
  });

  it.each(["", "NCR", "NCR-A1-03", "DEL-A01-03", "NCR-A01-03-X", "NCR_A01_03", "https://x/NCR-A01-03", "NCR-RCVX"])(
    "rejects %j",
    (input) => {
      expect(parseBinCode(input)).toBeNull();
    },
  );

  it("matches the SPEC §3.1 pattern exactly", () => {
    expect(BIN_CODE_RE.source).toBe("^(NCR|JPR)-([A-Z][0-9]{2}-[0-9]{2}|RCV|QRN)$");
  });

  it("normalises typed input", () => {
    expect(normalizeBinInput(" ncr - a01 - 03 ")).toBe("NCR-A01-03");
  });
});

describe("classifyScan", () => {
  it("accepts the user's workshop", () => {
    expect(classifyScan("NCR-A01-03", "NCR")).toEqual({ ok: true, code: "NCR-A01-03" });
    expect(classifyScan("jpr-rcv\n", "JPR")).toEqual({ ok: true, code: "JPR-RCV" });
  });

  it("names the other workshop's label", () => {
    expect(classifyScan("JPR-A01-01", "NCR")).toEqual({ ok: false, reason: "other_workshop", workshopCode: "JPR" });
  });

  it("refuses anything that is not a bin label", () => {
    expect(classifyScan("hello", "NCR")).toEqual({ ok: false, reason: "not_bin" });
    expect(classifyScan("PO-NCR-000123", "NCR")).toEqual({ ok: false, reason: "not_bin" });
  });
});

describe("cameraErrorKey", () => {
  const err = (name: string) => Object.assign(new Error(name), { name });
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "none"],
    ["OverconstrainedError", "none"],
    ["NotReadableError", "busy"],
    ["TypeError", "other"],
  ])("%s → %s", (name, key) => {
    expect(cameraErrorKey(err(name))).toBe(key);
  });

  it("handles non-errors", () => {
    expect(cameraErrorKey(undefined)).toBe("other");
    expect(cameraErrorKey("boom")).toBe("other");
  });
});
