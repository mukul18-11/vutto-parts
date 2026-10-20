import { en, type Dictionary } from "./en";
import { hi } from "./hi";

export type { Dictionary, EnumLabels, EnumName } from "./en";

export const LANGS = ["en", "hi"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_COOKIE = "lang";

export const dictionaries: Record<Lang, Dictionary> = { en, hi };

export function parseLang(value: string | undefined | null): Lang {
  return value === "hi" ? "hi" : "en";
}

// Dotted paths to every string leaf, e.g. "login.submit" or "enums.po_status.sent".
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];
export type MessageKey = Leaves<Dictionary>;
export type TranslateVars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: TranslateVars) => string;

export function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function translate(lang: Lang, key: MessageKey, vars?: TranslateVars): string {
  const text = lookup(dictionaries[lang], key) ?? lookup(en, key) ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function isMessageKey(value: string): value is MessageKey {
  return lookup(en, value) !== undefined;
}

export function makeT(lang: Lang): TFunction {
  return (key, vars) => translate(lang, key, vars);
}
