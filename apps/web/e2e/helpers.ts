import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SHOTS = resolve(process.cwd(), "../../docs/screenshots");
mkdirSync(SHOTS, { recursive: true });

export async function loginAs(page: Page, who: "admin" | "growth" | "ops" | "intake" | "viewer") {
  await page.goto("/login");
  await page.getByTestId(`login-as-${who}`).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect(page.getByTestId("current-user")).toBeVisible();
}

export async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });
}

export async function kpiNumber(page: Page, id: string): Promise<number> {
  const t = (await page.getByTestId(`${id}-value`).innerText()).replace(/[^\d.]/g, "");
  return Number(t);
}
