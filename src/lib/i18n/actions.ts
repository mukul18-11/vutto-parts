"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { LANG_COOKIE, LANGS } from "./index";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Sets the 'lang' cookie. The caller refreshes the router, so form state is kept. */
export async function setLang(lang: unknown): Promise<void> {
  const parsed = z.enum(LANGS).safeParse(lang);
  if (!parsed.success) return;
  const store = await cookies();
  store.set(LANG_COOKIE, parsed.data, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}
