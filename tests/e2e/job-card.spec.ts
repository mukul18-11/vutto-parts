// Manager flow (SPEC §5.2, §9.1, §14): create a bike with three findings, one of which has no
// candidate part (brake fluid on a drum-brake Splendor), see confirm refused with the unresolved
// finding, resolve it by hand, confirm, and see the lines reserved or needed. Runs on a phone
// viewport (Pixel 7) after global-setup restored the demo seed.
import { expect, test, type Page } from "@playwright/test";

async function signInAsNcrManager(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as NCR Manager", exact: true }).click();
  await expect(page).toHaveURL(/\/blocked/);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("manager creates a bike, resolves an unresolved finding and confirms the job card", async ({ page }) => {
  await signInAsNcrManager(page);
  await page.goto("/bikes/new");
  // Controlled inputs: wait for hydration so the first change reaches React state.
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Reg no").fill("HR26ZZ9901");
  await page.getByLabel("Model").selectOption({ label: "Hero Splendor Plus" });
  await page.getByLabel("Year").fill("2021");
  await expect(page.getByLabel("Variant")).toBeEnabled();
  await page.getByLabel("Variant").selectOption({ label: "BS6 Self Alloy i3S (2020–2023)" });
  await page.getByTestId("finding-engine_oil_due").check();
  await page.getByTestId("finding-air_filter_dirty").check();
  await page.getByTestId("finding-brake_fluid_low").check();
  await page.getByTestId("create-bike").click();

  // The draft job card: oil and air filter were suggested, brake fluid is unresolved.
  await expect(page).toHaveURL(/\/job-cards\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("HR26ZZ9901");
  await expect(page.getByTestId("line-OIL-20W40-1L")).toBeVisible();
  await expect(page.getByTestId("line-AF-HERO-BS6")).toBeVisible();
  const brakeFluid = page.getByTestId("finding-row-brake_fluid_low");
  await expect(brakeFluid.getByText("Unresolved")).toBeVisible();

  // Confirm is refused while the finding is unresolved, naming it.
  await page.getByTestId("confirm-card").click();
  await expect(page.getByTestId("unresolved-list")).toContainText("Brake fluid low or dark");

  // No part type applies on a drum brake, so the picker searches all parts.
  await brakeFluid.getByLabel("Search parts").fill("brake fluid");
  await brakeFluid.getByTestId("part-hit-BFL-DOT3-100ML").click();
  await brakeFluid.getByTestId("use-part-brake_fluid_low").click();
  await expect(brakeFluid.getByText("→ BFL-DOT3-100ML")).toBeVisible();
  await expect(page.getByTestId("line-BFL-DOT3-100ML")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByTestId("confirm-card").click();
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("Confirmed")).toBeVisible();
  for (const sku of ["OIL-20W40-1L", "AF-HERO-BS6", "BFL-DOT3-100ML"]) {
    await expect(page.getByTestId(`line-${sku}`)).toHaveAttribute("data-status", /^(reserved|partially_reserved|needed)$/);
  }
  await expect(page.getByTestId("history")).toContainText("confirmed the job card");
});

test("manager screens fit a 360 px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signInAsNcrManager(page);
  for (const path of ["/blocked", "/blocked?tab=inbound", "/bikes", "/bikes/new", "/catalogue", "/catalogue?tab=parts", "/bins/labels"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  // A job card from the board.
  await page.goto("/blocked");
  await page.getByRole("link", { name: "Open job card" }).first().click();
  await expect(page).toHaveURL(/\/job-cards\//);
  await expectNoHorizontalScroll(page);
});
