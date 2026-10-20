// Manager flow (SPEC §5.2, §9.1, §14): create a bike with three findings, one of which has no
// candidate part (brake fluid on a drum-brake Splendor), see confirm refused with the unresolved
// finding, resolve it by hand, confirm, and see the lines reserved or needed. Runs on a phone
// viewport (Pixel 7) after global-setup restored the demo seed.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The seed's planted scenarios (scripts/seed/planted.json); global-setup re-applies the seed.
const PLANTED = JSON.parse(readFileSync("scripts/seed/planted.json", "utf8")) as {
  NCR: { unknown_variant: { card_code: string; reg_no: string } };
};

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

test("manager fixes a wrong finding on a draft card", async ({ page }) => {
  await signInAsNcrManager(page);
  await page.goto("/bikes/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Reg no").fill("HR26ZZ9902");
  await page.getByLabel("Model").selectOption({ label: "Hero Splendor Plus" });
  await page.getByLabel("Year").fill("2021");
  await expect(page.getByLabel("Variant")).toBeEnabled();
  await page.getByLabel("Variant").selectOption({ label: "BS6 Self Alloy i3S (2020–2023)" });
  await page.getByTestId("finding-engine_oil_due").check();
  await page.getByTestId("create-bike").click();
  await expect(page).toHaveURL(/\/job-cards\//);
  await expect(page.getByTestId("line-OIL-20W40-1L")).toBeVisible();

  // The inspector meant the air filter, not the oil.
  await page.getByTestId("edit-findings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("finding-engine_oil_due")).toBeChecked();
  await dialog.getByTestId("finding-engine_oil_due").uncheck();
  await dialog.getByTestId("finding-air_filter_dirty").check();
  await dialog.getByRole("button", { name: "Save findings" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId("finding-row-air_filter_dirty")).toBeVisible();
  await expect(page.getByTestId("finding-row-engine_oil_due")).toHaveCount(0);
  await expect(page.getByTestId("line-AF-HERO-BS6")).toBeVisible();
  await expect(page.getByTestId("line-OIL-20W40-1L")).toHaveCount(0);
  await expect(page.getByTestId("history")).toContainText("edited the findings");
});

test("manager sets the variant of an unknown-variant bike and gets fitting suggestions", async ({ page }) => {
  const { reg_no, card_code } = PLANTED.NCR.unknown_variant;
  await signInAsNcrManager(page);
  await page.goto(`/bikes?q=${reg_no}`);
  await page.getByRole("link", { name: new RegExp(card_code) }).click();
  await expect(page).toHaveURL(/\/job-cards\//);

  // Unknown variant: the front brake (drum shoe or disc pad) cannot be suggested yet.
  const brake = page.getByTestId("finding-row-front_brake_worn");
  await expect(brake.getByText("Unresolved")).toBeVisible();

  await page.getByTestId("set-variant").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Variant").selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Set variant" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId("set-variant")).toHaveCount(0);
  await expect(brake.getByText("Unresolved")).toHaveCount(0);
  await expect(brake.getByText(/^→ /)).toBeVisible();
  await expect(page.getByTestId("history")).toContainText("set the bike variant");
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
