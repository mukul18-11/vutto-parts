// Metrics (SPEC §10, §15, Prompt 13): the NCR manager opens /metrics and sees real numbers for both
// simulated periods, before and after pre-ordering, side by side with the "Simulated data" marker.
// Wrong fits do not depend on pre-ordering, so that card shows one figure for the last 45 days.
// global-setup re-applied the seed, so both periods hold ~90 days of simulated history.
import { expect, test, type Page } from "@playwright/test";

async function signInAsNcrManager(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as NCR Manager", exact: true }).click();
  await expect(page).toHaveURL(/\/blocked/);
}

const NUMBER = /\d/;

test("manager sees non-empty part-wait and supporting numbers for both periods", async ({ page }) => {
  await signInAsNcrManager(page);
  await page.goto("/metrics");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Metrics");
  await expect(page.getByTestId("simulated-badge")).toHaveText("Simulated data");
  await expect(page.getByTestId("pre-ordering-marker")).toContainText("Pre-ordering started");

  for (const period of ["before", "after"] as const) {
    for (const id of [`wait-median-${period}`, `wait-p90-${period}`, `wait-zero-${period}`, `emergency-share-${period}`]) {
      const cell = page.getByTestId(id);
      await expect(cell, id).toHaveText(NUMBER);
      await expect(cell, id).not.toHaveText("–");
    }
    await expect(page.getByTestId(`wait-too-few-${period}`)).toHaveCount(0);
    const n = Number((await page.getByTestId(`wait-n-${period}`).innerText()).replace("n=", ""));
    expect(n, period).toBeGreaterThanOrEqual(5);
  }
  await expect(page.getByTestId("dead-stock-value")).toHaveText(/₹/);

  // Wrong fit: one number for the last 45 days with its list, never Before vs After.
  const wrongFit = page.getByTestId("card-wrong-fit");
  await expect(page.getByTestId("wrong-fit-value")).toHaveText(/\d.*%/);
  await expect(wrongFit).toContainText("Last 45 days");
  await expect(wrongFit.getByRole("heading", { name: "Before" })).toHaveCount(0);
  await expect(wrongFit.getByRole("link", { name: "See returns" })).toHaveAttribute("href", /\/metrics\/wrong-fit\?period=after/);

  // The north-star tile links to its list, whose footer shows the same SQL n.
  const nAfter = await page.getByTestId("wait-n-after").innerText();
  await page.getByTestId("wait-after").getByRole("link", { name: "See bikes" }).click();
  await expect(page).toHaveURL(/\/metrics\/part-wait\?period=after/);
  await expect(page.getByTestId("part-wait-footer")).toContainText(nAfter);
  await expect(page.getByTestId("part-wait-list")).toBeVisible();
});

test("the emergency buys table fits a laptop screen with every column visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsNcrManager(page);
  await page.goto("/emergency");
  const table = page.getByTestId("emergency-buys");
  await expect(table).toBeVisible();
  const overflow = await page
    .getByTestId("emergency-buys-scroll")
    .evaluate((el) => {
      const box = el.querySelector("[data-slot=table-container]") ?? el;
      return box.scrollWidth - box.clientWidth;
    });
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("table-scroll-hint")).toBeHidden();
  await expect(table.getByRole("columnheader", { name: "Reason" })).toBeInViewport();

  // On a phone the table scrolls sideways, and says so.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId("table-scroll-hint")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
