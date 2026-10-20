// Metrics (SPEC §10, §15, Prompt 13): the NCR manager opens /metrics and sees real numbers for both
// simulated periods, before and after pre-ordering, side by side with the "Simulated data" marker.
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
    for (const id of [`wait-median-${period}`, `wait-p90-${period}`, `wait-zero-${period}`, `emergency-share-${period}`, `wrong-fit-${period}`]) {
      const cell = page.getByTestId(id);
      await expect(cell, id).toHaveText(NUMBER);
      await expect(cell, id).not.toHaveText("–");
    }
    await expect(page.getByTestId(`wait-too-few-${period}`)).toHaveCount(0);
    const n = Number((await page.getByTestId(`wait-n-${period}`).innerText()).replace("n=", ""));
    expect(n, period).toBeGreaterThanOrEqual(5);
  }
  await expect(page.getByTestId("dead-stock-value")).toHaveText(/₹/);

  // The north-star tile links to its list, whose footer shows the same SQL n.
  const nAfter = await page.getByTestId("wait-n-after").innerText();
  await page.getByTestId("wait-after").getByRole("link", { name: "See bikes" }).click();
  await expect(page).toHaveURL(/\/metrics\/part-wait\?period=after/);
  await expect(page.getByTestId("part-wait-footer")).toContainText(nAfter);
  await expect(page.getByTestId("part-wait-list")).toBeVisible();
});
