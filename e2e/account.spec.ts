// Accounts and sync against a LOCAL Supabase (the CI "db" job starts one and
// builds the app with VITE_NEXT_SUPABASE_URL pointing at it). Skipped unless
// E2E_ACCOUNTS=1, so the guest-only runs stay hermetic.
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env["E2E_ACCOUNTS"], "needs a local Supabase (CI db job)");

const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function createAccount(page: Page, username: string, password: string): Promise<string> {
  await page.goto("/next/");
  await page.getByRole("button", { name: "Sign in" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Create account" }).click();
  await sheet.getByRole("textbox", { name: "Username" }).fill(username);
  await sheet.getByLabel("Password").fill(password);
  const phrase = (await sheet.getByTestId("recovery-phrase").textContent())?.trim() ?? "";
  await sheet.getByRole("switch", { name: /saved my recovery phrase/ }).click();
  await sheet.getByRole("button", { name: "Create account" }).click();
  return phrase;
}

test("sign up, onboard, log a set, reload, sign out and back in: the day is on the server", async ({ page }) => {
  const username = unique();
  const password = "correct-horse-9";
  await createAccount(page, username, password);
  await expect(page.getByRole("dialog", { name: "What are you training for?" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByText("Guest")).toHaveCount(0);

  await page.getByRole("button", { name: "Check in" }).click();
  const checkin = page.getByRole("dialog", { name: "How do you feel today?" });
  for (const [group, option] of [["Slept", "fine"], ["Sore", "no"], ["Stress", "low"]] as const) {
    await checkin.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option }).click();
  }
  await checkin.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("status", { name: /Synced|Saving/ })).toBeVisible();
  await expect(page.getByRole("status", { name: "Synced" })).toBeVisible({ timeout: 10_000 });

  await page.goto("/next/#/profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Username" }).fill(username);
  await sheet.getByLabel("Password").fill(password);
  await sheet.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Tier: / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
});

test("guest progress is kept on sign-up when the athlete chooses Keep", async ({ page }) => {
  await page.goto("/next/");
  await page.getByRole("button", { name: "Start fresh" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await page.goto("/next/#/profile");
  await page.getByRole("button", { name: "Sign in" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Create account" }).click();
  await sheet.getByRole("textbox", { name: "Username" }).fill(unique());
  await sheet.getByLabel("Password").fill("correct-horse-9");
  await sheet.getByRole("switch", { name: /saved my recovery phrase/ }).click();
  await sheet.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("alertdialog", { name: "Keep guest progress?" }).getByRole("button", { name: "Keep" }).click();
  // The sign-up started on Profile, so that is where the athlete stays: now
  // as an account, with the guest's program carried over and synced.
  await expect(page.getByText(/^Signed in as /)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Week" }).getByRole("listitem")).toHaveCount(7);
  await expect(page.getByRole("status", { name: "Synced" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Guest")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Quest" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "What are you training for?" })).toHaveCount(0);
});

test("delete account removes everything and lands on the landing page", async ({ page }) => {
  await createAccount(page, unique(), "correct-horse-9");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.goto("/next/#/profile");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
});
