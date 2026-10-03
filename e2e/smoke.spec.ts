// The strangler router: /next is the new app, / is still v19.
import { expect, test } from "@playwright/test";

test("/next serves the v20 app and nothing legacy", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/next/");
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
  await expect(page.getByRole("img", { name: "0VERTRAINED" })).toBeVisible();
  const legacy = requests.filter((u) => /\/assets\/(boot|index-legacy|App)-/.test(u));
  expect(legacy).toEqual([]);
});

test("/ still renders the legacy app", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByText(/0VERTRAINED/i).first()).toBeVisible();
});
