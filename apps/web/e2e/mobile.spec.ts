import { expect, test } from "@playwright/test";
import { loginAs, shot } from "./helpers";

test("mobile: navigation menu and overview are usable", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page.getByTestId("kpi-care-starts")).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const width = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width + 1);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Growth Missions" }).click();
  await expect(page.getByRole("heading", { name: "Growth missions" })).toBeVisible();
  await shot(page, "mobile-missions");
});
