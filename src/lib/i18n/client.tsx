"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Lang, type TFunction } from "./index";

const LangContext = createContext<Lang>("en");

/** The root layout passes the cookie language; client components translate with useT(). */
export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT(): TFunction {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
