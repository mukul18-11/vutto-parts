// Login smoke (Prompt 9): each demo button lands on the role's home page with the shell around it.
import { expect, test, type Page } from "@playwright/test";
import { NO_PROFILE_USER } from "../db/sessions";

const BUTTONS = [
  { key: "admin", label: "Sign in as Admin", home: "/blocked", role: "Admin", lang: "en" },
  { key: "ncr_manager", label: "Sign in as NCR Manager", home: "/blocked", role: "Manager", lang: "en" },
  { key: "ncr_store", label: "Sign in as NCR Store keeper", home: "/store", role: "Store keeper", lang: "en" },
  { key: "jpr_manager", label: "Sign in as Jaipur Manager", home: "/blocked", role: "Manager", lang: "en" },
  // The Jaipur store keeper starts in Hindi.
  { key: "jpr_store", label: "Sign in as Jaipur Store keeper", home: "/store", role: "स्टोर कीपर", lang: "hi" },
] as const;

async function signInWith(page: Page, label: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: label, exact: true }).click();
}

for (const b of BUTTONS) {
  test(`${b.key} button lands on ${b.home}`, async ({ page }) => {
    await signInWith(page, b.label);
    await expect(page).toHaveURL(new RegExp(`${b.home}$`));
    await expect(page.getByTestId("header-role")).toHaveText(b.role);
    await expect(page.locator("html")).toHaveAttribute("lang", b.lang);
    await expect(page.locator("footer")).toContainText(b.lang === "hi" ? "IST" : "times in IST");
    if (b.key === "admin") await expect(page.getByTestId("footer-version")).toContainText("schema 2");
    if (b.home === "/store") {
      // Store keeper screens: no horizontal scroll at 360 px, in English and Hindi (SPEC §14).
      await page.setViewportSize({ width: 360, height: 780 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
  });
}

test("the language toggle switches to Hindi and back", async ({ page }) => {
  await signInWith(page, "Sign in as NCR Store keeper");
  await expect(page).toHaveURL(/\/store$/);
  await page.getByRole("button", { name: "Switch to Hindi" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByTestId("header-role")).toHaveText("स्टोर कीपर");
  await page.getByRole("button", { name: "अंग्रेज़ी में बदलें" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("header-role")).toHaveText("Store keeper");
});

test("a store keeper opening a manager route sees Not available for your role", async ({ page }) => {
  await signInWith(page, "Sign in as NCR Store keeper");
  await expect(page).toHaveURL(/\/store$/);
  await page.goto("/blocked");
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
});

test("admin switches workshop through ?ws=", async ({ page }) => {
  await signInWith(page, "Sign in as Admin");
  await expect(page).toHaveURL(/\/blocked$/);
  await page.getByRole("combobox").selectOption("JPR");
  await expect(page).toHaveURL(/\/blocked\?ws=JPR$/);
  await expect(page.getByRole("main").getByText("(JPR)")).toBeVisible();
});

test("a wrong password shows a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ncr.store@demo.example.com");
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Next's route announcer also has role="alert", so match the message text.
  await expect(page.getByText("Wrong email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a user without a profile gets /no-access and can sign out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(NO_PROFILE_USER.email);
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.getByRole("heading", { name: "No workshop access" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("signing out returns to /login and protects pages again", async ({ page }) => {
  await signInWith(page, "Sign in as NCR Manager");
  await expect(page).toHaveURL(/\/blocked$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/store");
  await expect(page).toHaveURL(/\/login\?next=%2Fstore$/);
});
