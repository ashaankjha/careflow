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

test("pages are served with a per-request nonce CSP and still hydrate", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/login");
  const csp = res!.headers()["content-security-policy"]!;
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "))!;
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc)?.[1];
  expect(nonce, "script-src carries a nonce").toBeTruthy();
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  // Next.js stamps the nonce on its own scripts
  const stamped = await page.locator("script[nonce]").count();
  expect(stamped).toBeGreaterThan(0);
  // nonces are fresh per request
  const again = await page.request.get("/login");
  expect(again.headers()["content-security-policy"]).not.toContain(nonce!);
  // hydration works under the policy: the client-side login flow navigates
  await loginAs(page, "admin");
  const appCsp = (await page.request.get("/")).headers()["content-security-policy"];
  expect(appCsp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(violations).toEqual([]);
});
