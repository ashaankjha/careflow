import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("viewer sees no edit controls and the API refuses capacity edits", async ({ page }) => {
  await loginAs(page, "viewer");
  await page.goto("/capacity");
  await expect(page.getByTestId("site-card-west")).toBeVisible();
  await expect(page.getByTestId("edit-capacity-west")).toHaveCount(0);
  // UI hiding is not authorization: call the API directly
  const centers = await page.request.get("/api/v1/dashboard");
  const west = (await centers.json()).siteMatrix.find((s: { centerName: string }) => s.centerName === "West Center");
  const res = await page.request.put(`/api/v1/centers/${west.centerId}/capacity`, { data: { version: 1, windows: [], rules: [] }, headers: { origin: page.url().replace(/\/capacity$/, "") } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe("FORBIDDEN");
});

test("keyboard navigation reaches primary nav with a visible focus ring", async ({ page }) => {
  await loginAs(page, "admin");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 12; i++) {
    const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute("href"));
    if (href === "/intake") break;
    await page.keyboard.press("Tab");
  }
  const focused = page.locator(":focus");
  await expect(focused).toHaveAttribute("href", "/intake");
  const ring = await focused.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/intake/);
});

test("unauthenticated API calls get the error envelope", async ({ request }) => {
  const res = await request.get("/api/v1/inquiries");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe("UNAUTHENTICATED");
  expect(body.error.requestId).toBeTruthy();
});
