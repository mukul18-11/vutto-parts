// Store keeper screens on a 360 px phone, in English and Hindi (SPEC §14): no horizontal scroll,
// inputs at least 16 px (no zoom on focus), touch targets at least 48 px, and a label on every
// form control. Read-only: it opens screens and never posts, so it shares no state with the other
// specs (it uses planted codes no other spec touches).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PLANTED = JSON.parse(readFileSync("scripts/seed/planted.json", "utf8")) as {
  NCR: { po_overdue: string; ready_to_issue: string[] };
};
const { po_overdue: PO_CODE, ready_to_issue } = PLANTED.NCR;
const READY_CARD = ready_to_issue[1];

const PAGES = [
  "/store",
  "/store/receive",
  "/store/putaway",
  "/store/issue",
  "/store/return",
  "/store/emergency",
  "/stock",
  "/catalogue",
  "/catalogue?tab=parts",
  "/bins/labels",
];

/** Everything on the screen that breaks the SPEC §14 phone rules, as readable strings. */
async function phoneProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}"`;
    const shown = (el: Element) => {
      if (el.closest("[aria-hidden=true]")) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none";
    };
    const problems: string[] = [];
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 0) problems.push(`horizontal scroll of ${overflow}px`);

    for (const el of document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea")) {
      if (!shown(el)) continue;
      const box = el.type === "checkbox" || el.type === "radio";
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (!box && size < 16) problems.push(`input font ${size}px: ${describe(el)}`);
      const labelled = (el.labels?.length ?? 0) > 0 || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
      if (!labelled) problems.push(`input without a label: ${describe(el)}`);
    }
    for (const el of document.querySelectorAll("button, [role=button], a[data-slot=button]")) {
      if (!shown(el)) continue;
      const height = el.getBoundingClientRect().height;
      if (height < 47.5) problems.push(`touch target ${Math.round(height)}px tall: ${describe(el)}`);
    }
    return problems;
  });
}

async function check(page: Page, what: string) {
  await expect(page.locator("main")).toBeVisible();
  expect(await phoneProblems(page), what).toEqual([]);
}

for (const lang of ["en", "hi"] as const) {
  test(`store keeper screens fit a 360 px phone in ${lang}`, async ({ page, context }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in as NCR Store keeper", exact: true }).click();
    await expect(page).toHaveURL(/\/store$/);
    await context.addCookies([{ name: "lang", value: lang, domain: "127.0.0.1", path: "/" }]);

    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await check(page, `${path} (${lang})`);
    }

    // The receive form of a sent PO (opened, never posted).
    await page.goto("/store/receive");
    await page.getByTestId(`receive-${PO_CODE}`).click();
    await expect(page).toHaveURL(/\/store\/receive\/[0-9a-f-]{36}/);
    await check(page, `receive form (${lang})`);

    // A card ready to issue, found through the counter search (opened, never issued).
    await page.goto("/store/issue");
    await page.getByTestId("card-search").fill(READY_CARD);
    await page.getByTestId("card-search").press("Enter");
    await page.getByTestId(`card-${READY_CARD}`).click();
    await expect(page).toHaveURL(/\/store\/issue\/[0-9a-f-]{36}/);
    await check(page, `issue card (${lang})`);
  });
}
