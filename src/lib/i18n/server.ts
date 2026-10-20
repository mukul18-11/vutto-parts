import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, parseLang, type Lang, type TFunction } from "./index";

/** The UI language from the 'lang' cookie (default en, SPEC §14). */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  return parseLang(store.get(LANG_COOKIE)?.value);
}

export async function getT(): Promise<TFunction> {
  return makeT(await getLang());
}
