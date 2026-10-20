// Store counter flow (SPEC §17, §8.1, §8.2, §14) on a Pixel 7 against the restored seed:
// 1. Demo chain C: the store keeper receives the chain's PO, the manager sees the bike leave the
//    blocked board, the store keeper puts the part away and issues it.
// 2. A planted ready-to-issue card: issue a reserved line from a typed bin code with a quick
//    double tap (exactly one issue move in the stock ledger), then return it as damaged (the need
//    reopens). Asserts persisted state by reloading, never toasts. Uses planted codes no other
//    spec touches (chain C, ready_to_issue[0]).
import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";

type Chain = { label: string; card_code: string; reg_no: string; po_code: string; sku: string; qty: number };
const PLANTED = JSON.parse(readFileSync("scripts/seed/planted.json", "utf8")) as {
  NCR: { chains: Chain[]; ready_to_issue: string[] };
};
const CHAIN = PLANTED.NCR.chains.find((c) => c.label === "C")!;
const READY_CARD = PLANTED.NCR.ready_to_issue[0];
const PUTAWAY_BIN = "NCR-A01-01";

const istToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function signIn(page: Page, who: "NCR Store keeper" | "NCR Manager") {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${who}`, exact: true }).click();
  await expect(page).toHaveURL(who === "NCR Manager" ? /\/blocked/ : /\/store/);
}

/** A second signed-in user in its own context, with the same device and locale as the project. */
async function managerPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL, timezoneId: "Asia/Kolkata", locale: "en-IN" });
  const page = await context.newPage();
  await signIn(page, "NCR Manager");
  return page;
}

/** Opens the issue screen of a card through the store keeper's search (reg-no suffix or code). */
async function openIssueCard(page: Page, term: string, code: string) {
  await page.goto("/store");
  await page.getByTestId("store-issue").click();
  await page.getByTestId("card-search").fill(term);
  await page.getByTestId("card-search").press("Enter");
  await page.getByTestId(`card-${code}`).click();
  await expect(page).toHaveURL(/\/store\/issue\/[0-9a-f-]{36}$/);
}

test("chain C: receive the PO, the bike leaves the blocked board, put away and issue", async ({ page, browser, baseURL }) => {
  const manager = await managerPage(browser, baseURL);
  await expect(manager.getByTestId(`board-row-${CHAIN.card_code}`)).toBeVisible();

  await signIn(page, "NCR Store keeper");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId("store-issue-count")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Receive the chain's PO in full.
  await page.getByTestId("store-receive").click();
  await page.getByTestId(`receive-${CHAIN.po_code}`).click();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("invoice-no").fill(`E2E-${CHAIN.po_code}`);
  await page.getByTestId("invoice-date").fill(istToday());
  await page.getByTestId(`received-${CHAIN.sku}`).fill(String(CHAIN.qty));
  await page.getByTestId("post-grn").click();
  await page.getByRole("dialog").getByRole("button", { name: "Post GRN" }).click();
  await expect(page.getByTestId(`allocation-${CHAIN.card_code}`)).toBeVisible();

  // The manager's blocked board no longer shows the bike.
  await manager.reload();
  await expect(manager.getByTestId("board")).toBeVisible();
  await expect(manager.getByTestId(`board-row-${CHAIN.card_code}`)).toHaveCount(0);
  await manager.context().close();

  // Put the received part away by typing the bin code.
  await page.goto("/store/putaway");
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`receiving-${CHAIN.sku}`).click();
  const putaway = page.getByTestId("putaway-form");
  await putaway.getByPlaceholder(/Type bin code/).fill(PUTAWAY_BIN.toLowerCase());
  await putaway.getByTestId("putaway-submit").click();
  await expect(page.getByTestId("putaway-done")).toContainText(`to ${PUTAWAY_BIN}`);

  // Issue it: the card is found by its reg-no suffix; the part now sits in the typed bin.
  await openIssueCard(page, CHAIN.reg_no.slice(-4), CHAIN.card_code);
  await expect(page.getByTestId("issue-reg")).toHaveText(CHAIN.reg_no);
  const line = page.getByTestId(`issue-line-${CHAIN.sku}`);
  await expect(line.getByTestId(`held-${PUTAWAY_BIN}`)).toBeVisible();
  await line.getByTestId(`issue-open-${CHAIN.sku}`).click();
  await line.getByTestId("issue-form").getByPlaceholder(/Type bin code/).fill(PUTAWAY_BIN);
  await line.getByTestId("issue-submit").click();
  await expect(page).toHaveURL(/\/done\?move=\d+/);
  await expect(page.getByTestId("issue-done")).toContainText(`from ${PUTAWAY_BIN}`);
  await expectNoHorizontalScroll(page);

  // Persisted: the line is issued and the card has left the issue queue.
  await page.getByTestId("issue-next").click();
  await expect(page.getByTestId(`issue-line-${CHAIN.sku}`)).toHaveAttribute("data-status", "issued");
  await page.goto("/store/issue");
  await expect(page.getByTestId(`card-${CHAIN.card_code}`)).toHaveCount(0);
});

test("ready card: double-tapped issue makes one move; a damaged return reopens the need", async ({ page }) => {
  await signIn(page, "NCR Store keeper");
  await page.setViewportSize({ width: 360, height: 800 });
  await openIssueCard(page, READY_CARD, READY_CARD);
  await expectNoHorizontalScroll(page);

  // A reserved line with a green fit badge (issues on one tap) and its first suggested bin.
  const line = page.locator('[data-testid^="issue-line-"][data-status="reserved"]').filter({ has: page.locator('[data-fit="green"]') }).first();
  const sku = (await line.getAttribute("data-testid"))!.replace("issue-line-", "");
  await line.getByTestId(`issue-open-${sku}`).click();
  const chip = line.locator('[data-testid^="suggested-bin-"]').first();
  const bin = (await chip.getAttribute("data-testid"))!.replace("suggested-bin-", "");

  // Type the bin code (not the chip) and double-tap Issue quickly.
  await line.getByTestId("issue-form").getByPlaceholder(/Type bin code/).fill(bin.toLowerCase());
  await expect(line.getByTestId("issue-form")).toContainText(`Bin ${bin}`);
  await line.getByTestId("issue-submit").dblclick();
  await expect(page.getByTestId("issue-done")).toContainText(`from ${bin}`);

  // Exactly one issue move for this card in the part's stock ledger.
  await page.goto("/stock");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Search parts").fill(sku);
  await page.getByTestId(`part-hit-${sku}`).click();
  await expect(page.getByTestId("stock-ledger")).toBeVisible();
  await expect(page.locator(`[data-testid="ledger-move"][data-move-type="issue"][data-card="${READY_CARD}"]`)).toHaveCount(1);

  // Return it as damaged: it goes to quarantine and the need reopens.
  await openIssueCard(page, READY_CARD, READY_CARD);
  const cardUrl = page.url();
  await page.goto(`${cardUrl.replace("/store/issue/", "/store/return/")}`);
  await page.getByTestId(`return-line-${sku}`).click();
  await page.getByTestId("reason-damaged").click();
  await expect(page.getByTestId("return-bin")).toHaveCount(0);
  await page.getByTestId("return-submit").click();
  await expect(page.getByTestId("return-done")).toContainText("quarantine NCR-QRN");
  await expect(page.getByTestId("return-done")).toContainText("Need reopened");
  await expectNoHorizontalScroll(page);

  // Persisted: nothing of it is with the bike any more and the line is open again.
  await page.goto(cardUrl);
  const reopened = page.getByTestId(`issue-line-${sku}`);
  await expect(reopened.getByTestId("line-issued")).toContainText("Issued 0");
  await expect(reopened).not.toHaveAttribute("data-status", "issued");
});
