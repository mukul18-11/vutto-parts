// Store keeper flow (SPEC §7.4, §14): blind-receive the planted partially received PO with one
// damaged unit, see the accepted unit reserved for the bike waiting on it, then put the receiving
// stock away by typing the bin code. Phone viewport (Pixel 7); global-setup restored the seed.
// Asserts persisted state by reloading, never toasts.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PLANTED = JSON.parse(readFileSync("scripts/seed/planted.json", "utf8")) as {
  NCR: {
    po_partially_received: string;
    receiving: { sku: string; qty: number };
    inbound_shortfall: string[];
  };
};
const { po_partially_received: PO_CODE, receiving, inbound_shortfall } = PLANTED.NCR;
const SKU = receiving.sku;
// The planted PO's open unit goes to the in-transit bike short of this part (FIFO).
const WAITING_CARD = inbound_shortfall[0];
const BIN = "NCR-A01-01";

const istToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("store keeper receives the partially received PO with a damaged unit and puts it away", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as NCR Store keeper", exact: true }).click();
  await expect(page).toHaveURL(/\/store/);

  // Receiving list: the planted PO is open.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByTestId("store-receive").click();
  await expect(page).toHaveURL(/\/store\/receive$/);
  await page.getByTestId(`receive-${PO_CODE}`).click();
  await page.waitForLoadState("networkidle");

  // Blind receiving: received starts blank and no ordered/open quantity is shown.
  const line = page.getByTestId(`grn-line-${SKU}`);
  await expect(page.getByTestId(`received-${SKU}`)).toHaveValue("");
  await expectNoHorizontalScroll(page);

  await page.getByTestId("invoice-no").fill(`E2E-${PO_CODE}`);
  await page.getByTestId("invoice-date").fill(istToday());
  await page.getByTestId(`received-${SKU}`).fill("2");
  await expect(page.getByTestId(`damaged-${SKU}`)).toHaveCount(0);
  await page.getByTestId(`any-damaged-${SKU}`).check();
  await page.getByTestId(`damaged-${SKU}`).fill("1");
  await expect(line.getByTestId(`accepted-${SKU}`)).toContainText("1");
  await expectNoHorizontalScroll(page);

  await page.getByTestId("post-grn").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText(`${SKU}: 1`);
  await expect(sheet).toContainText("handed back");
  await sheet.getByRole("button", { name: "Post GRN" }).click();

  // Success: the accepted unit is reserved for the in-transit bike that was short of it.
  await expect(page.getByTestId("grn-success")).toBeVisible();
  const allocation = page.getByTestId(`allocation-${WAITING_CARD}`);
  await expect(allocation).toContainText(`reserved for`);
  await expect(allocation).toContainText(WAITING_CARD);
  await expect(allocation).toContainText("bike not arrived yet");

  // Persisted: the PO is fully received and no longer open for receiving.
  await page.goto("/store/receive");
  await expect(page.getByTestId(`receive-${PO_CODE}`)).toHaveCount(0);

  // Putaway: the receiving bin now holds the two planted units plus the one just accepted.
  await page.goto("/store/putaway");
  await page.waitForLoadState("networkidle");
  const qty = receiving.qty + 1;
  await expect(page.getByTestId(`receiving-qty-${SKU}`)).toContainText(String(qty));
  await page.getByTestId(`receiving-${SKU}`).click();
  const form = page.getByTestId("putaway-form");
  await form.getByPlaceholder(/Type bin code/).fill(BIN.toLowerCase());
  await expect(form).toContainText(`Bin ${BIN}`);
  await form.getByTestId("putaway-submit").click();
  await expect(page.getByTestId("putaway-done")).toContainText(`to ${BIN}`);
  await expectNoHorizontalScroll(page);

  // Persisted: nothing of it left in receiving; the stock card shows it in the bin.
  await page.reload();
  await expect(page.getByTestId(`receiving-${SKU}`)).toHaveCount(0);
  await page.goto("/stock");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Search parts").fill(SKU);
  await page.getByTestId(`part-hit-${SKU}`).click();
  await expect(page.getByTestId(`stock-bin-${BIN}`).getByTestId("bin-qty")).toContainText(String(qty));
});
