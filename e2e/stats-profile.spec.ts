// Stats, the quest log and Profile in guest mode: the demo character's
// numbers are visible, Profile autosaves, a program change never re-judges
// the past, and a backup round-trips.
import { expect, test, type Page } from "@playwright/test";

async function openDemo(page: Page) {
  await page.goto("/next/");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
}

test("Stats shows the demo's level, rank requirements, stats, records and titles", async ({ page }) => {
  await openDemo(page);
  await page.goto("/next/#/stats");
  await expect(page.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();
  await expect(page.getByText(/^Lv 1\d · /)).toBeVisible();
  await expect(page.getByText(/Level 12 \((you: )?1\d(, met)?\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^STR \d+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^END \d+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^VIT \d+/ })).toBeVisible();
  await expect(page.getByText("Back Squat").first()).toBeVisible();
  await expect(page.getByText(/^Titles \d+\/18$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin Rank Trial" })).toBeVisible();
});

test("the quest log opens a day and the browser Back closes it", async ({ page }) => {
  await openDemo(page);
  await page.goto("/next/#/stats/log");
  await expect(page.getByRole("heading", { level: 1, name: "Quest log" })).toBeVisible();
  const rows = page.getByRole("button", { name: /\+\d+ XP|—/ });
  await expect(rows.first()).toBeVisible();
  await rows.nth(1).click();
  await expect(page).toHaveURL(/#\/stats\/log\/\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Profile autosaves, and a program change applies from tomorrow without touching today", async ({ page }) => {
  await openDemo(page);
  const xpBefore = await page.getByText(/^\+\d+ XP today$/).textContent();
  await page.goto("/next/#/profile");
  await expect(page.getByRole("heading", { level: 2, name: "Program" })).toBeVisible();
  await page.getByRole("radio", { name: "lb · mi" }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: "lb · mi" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Switch preset" }).click();
  await page.getByRole("button", { name: /Powerlifting/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Switch preset" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.goto("/next/#/quest");
  await expect(page.getByText(/^\+\d+ XP today$/)).toHaveText(xpBefore ?? "");
  await expect(page.getByText("Full Body C")).toBeVisible();
});

test("a backup exports and imports back the same days", async ({ page }) => {
  await openDemo(page);
  await page.goto("/next/#/profile");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const file = await download;
  const path = await file.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "Reset guest data" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
  await page.getByRole("button", { name: "Start fresh" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.goto("/next/#/profile");
  await page.locator('input[type="file"]').setInputFiles(path as string);
  await expect(page.getByRole("dialog", { name: /Import/ })).toBeVisible();
  await page.getByRole("dialog", { name: /Import/ }).getByRole("button", { name: "Import" }).click();
  await page.goto("/next/#/stats");
  await expect(page.getByText(/^Lv 1\d · /)).toBeVisible();
});
