import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/database.types";
import { ERROR_CODES, ERROR_MESSAGES, UNKNOWN_MESSAGE } from "@/lib/errors";
import { dictionaries, isMessageKey, lookup, parseLang, translate } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { hi } from "@/lib/i18n/hi";

function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leafPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("dictionaries", () => {
  it("hi has exactly the en keys, all non-empty", () => {
    const enKeys = leafPaths(en).sort();
    expect(leafPaths(hi).sort()).toEqual(enKeys);
    for (const key of enKeys) {
      expect(lookup(en, key)?.trim(), `en ${key}`).toBeTruthy();
      expect(lookup(hi, key)?.trim(), `hi ${key}`).toBeTruthy();
    }
  });

  it("uses the same {placeholders} in both languages", () => {
    for (const key of leafPaths(en)) {
      const vars = (s: string | undefined) => [...(s ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(lookup(hi, key)), key).toEqual(vars(lookup(en, key)));
    }
  });

  it("keeps digits Latin in Hindi", () => {
    for (const key of leafPaths(hi)) expect(lookup(hi, key), key).not.toMatch(/[०-९]/);
  });
});

describe("every enum value has en and hi text", () => {
  for (const [name, values] of Object.entries(Constants.public.Enums)) {
    it(name, () => {
      for (const value of values) {
        for (const dict of Object.values(dictionaries)) {
          expect(lookup(dict, `enums.${name}.${value}`)?.trim(), `${name}.${value}`).toBeTruthy();
        }
      }
      expect(Object.keys(en.enums[name as keyof typeof en.enums]).sort()).toEqual([...values].sort());
    });
  }
});

describe("every error code has en and hi text", () => {
  it.each([...ERROR_CODES])("%s", (code) => {
    expect(ERROR_MESSAGES[code].en.trim()).toBeTruthy();
    expect(ERROR_MESSAGES[code].hi.trim()).toBeTruthy();
    expect(ERROR_MESSAGES[code].hi).not.toBe(ERROR_MESSAGES[code].en);
  });

  it("has no messages for unknown codes", () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
    expect(UNKNOWN_MESSAGE.en).toContain("{ref}");
    expect(UNKNOWN_MESSAGE.hi).toContain("{ref}");
  });
});

describe("translate", () => {
  it("fills placeholders", () => {
    expect(translate("en", "login.signInAs", { name: "Admin" })).toBe("Sign in as Admin");
    expect(translate("hi", "common.asOf", { time: "11:42" })).toContain("11:42");
  });

  it("defaults to en for a missing or unknown cookie", () => {
    expect(parseLang(undefined)).toBe("en");
    expect(parseLang("fr")).toBe("en");
    expect(parseLang("hi")).toBe("hi");
  });

  it("recognises message keys", () => {
    expect(isMessageKey("validation.invalid")).toBe(true);
    expect(isMessageKey("validation")).toBe(false);
    expect(isMessageKey("Required")).toBe(false);
  });
});
