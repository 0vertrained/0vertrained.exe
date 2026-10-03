// Guest mode end to end on the production build: the demo character, the
// fresh-start onboarding, and the check-in that issues a quest. No network
// beyond the preview server, no secrets.
import { expect, test, type Page } from "@playwright/test";

// Every test gets a fresh browser context, so guest storage starts empty.
async function openNext(page: Page) {
  await page.goto("/next/");
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
}

test("Try the demo lands on a reduced quest with the character's level and rank in the strip", async ({ page }) => {
  await openNext(page);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Tier: Reduced" })).toBeVisible();
  await expect(page.getByText(/^Lv 1[0-9]$/)).toBeVisible();
  await expect(page.getByRole("img", { name: /^Rank D/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin quest" })).toBeVisible();
  await expect(page.getByText("Guest")).toBeVisible();
});

test("the demo survives a reload from local storage", async ({ page }) => {
  await openNext(page);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Tier: Reduced" })).toBeVisible();
});

test("Start fresh runs onboarding and the first check-in issues a Daily Quest", async ({ page }) => {
  await openNext(page);
  await page.getByRole("button", { name: "Start fresh" }).click();
  await expect(page.getByRole("dialog", { name: "What are you training for?" })).toBeVisible();
  await page.getByRole("radio", { name: "Strength" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "What do you train with?" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Your first week" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Program preview" }).getByRole("listitem")).toHaveCount(7);
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByText(/^Lv 1$/)).toBeVisible();
  await page.getByRole("button", { name: "Check in" }).click();
  const sheet = page.getByRole("dialog", { name: "How do you feel today?" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radiogroup", { name: "Slept" }).getByRole("radio", { name: "poorly" }).click();
  await sheet.getByRole("radiogroup", { name: "Sore" }).getByRole("radio", { name: "very" }).click();
  await sheet.getByRole("radiogroup", { name: "Stress" }).getByRole("radio", { name: "some" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("img", { name: /^Tier: (Full|Reduced|Recover|Rest)$/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Begin quest|Mark recovery done/ })).toBeVisible();
});

test("the demo loop: begin, bank every set, finish, claim", async ({ page }) => {
  await openNext(page);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Begin quest" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Full Body C" })).toBeVisible();
  const complete = page.getByRole("button", { name: /^Complete set/ });
  await expect(complete).toBeInViewport();
  for (let i = 0; i < 10; i += 1) {
    await page.getByRole("button", { name: /^Complete set/ }).click();
    if (i === 0) await expect(page.getByRole("region", { name: "Rest timer" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Finish session" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quest" })).toBeVisible();
  await expect(page.getByText("10/10 sets")).toBeVisible();
  await page.getByRole("button", { name: "Claim rewards" }).click();
  const sheet = page.getByRole("dialog", { name: /Quest cleared/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/^\+\d+ XP$/).first()).toBeVisible();
  await expect(sheet.getByText("Training")).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /^Quest (cleared|claimed) · \+\d+ XP$/ })).toBeDisabled();
});

test("an illness check-in protects the day and keeps the streak", async ({ page }) => {
  await openNext(page);
  await page.getByRole("button", { name: "Start fresh" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Check in" }).click();
  const sheet = page.getByRole("dialog", { name: "How do you feel today?" });
  await sheet.getByRole("switch", { name: /Ill or injured/ }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/Ill or injured: (rest today|streak protected)/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /today: protected/ })).toBeVisible();
});

test("sets banked offline survive a reload", async ({ page, context }) => {
  await openNext(page);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Begin quest" }).click();
  await page.getByRole("button", { name: "Complete set 1 of 2" }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Complete set 2 of 2" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Push-Up" })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Push-Up" })).toBeVisible();
  await page.getByRole("button", { name: "Exit session" }).click();
  await expect(page.getByText("2/10 sets")).toBeVisible();
});
