import AxeBuilder from "@axe-core/playwright";
import { createDb, databaseUrl, seedDatabase } from "@careflow/db";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on every screen. This catches
 * machine-detectable issues only; it is not a full WCAG audit (no
 * screen-reader, zoom/reflow or cognitive review). Light scheme only: dark
 * mode is not implemented.
 *
 * The packet print page needs an approved packet, so this spec mutates the
 * demo state and restores the exact seed afterwards.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function reseed() {
  const { db, client } = createDb(databaseUrl(), { max: 2 });
  try {
    await seedDatabase(db);
  } finally {
    await client.end();
  }
}

async function expectAccessible(page: Page, screen: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // let entry animations settle so contrast is measured on final colours
  await page.waitForTimeout(300);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n").join(" ")}`).join("\n")}`);
  expect.soft(summary, `${screen}: axe WCAG 2.1 A/AA violations`).toEqual([]);
}

test.use({ colorScheme: "light" });
test.afterAll(reseed);

test("login and not-found", async ({ page }) => {
  await page.goto("/login");
  await expectAccessible(page, "login");
  await loginAs(page, "admin");
  await page.goto("/this-page-does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAccessible(page, "not-found");
});

test("read screens", async ({ page }) => {
  await loginAs(page, "admin");
  for (const [path, heading] of [
    ["/", "Growth overview"],
    ["/market", /Market/],
    ["/referrals", /Referral/],
    ["/capacity", /Capacity/],
    ["/missions", "Growth missions"],
    ["/experiments", /Experiments/],
    ["/settings", /Settings/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectAccessible(page, path);
  }
});

test("intake: table, open inquiry drawer, add-inquiry dialog", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/intake");
  await expect(page.getByTestId("inquiry-row").first()).toBeVisible();
  await expectAccessible(page, "intake");
  await page.getByTestId("inquiry-row").first().click();
  await expect(page.getByTestId("drawer-stage")).toBeVisible();
  await expectAccessible(page, "intake drawer");
  await page.keyboard.press("Escape");
  await page.getByTestId("add-inquiry").click();
  await expect(page.getByTestId("submit-inquiry")).toBeVisible();
  await expectAccessible(page, "add-inquiry dialog");
});

test("capacity editor, mission draft editor and packet print page", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/capacity");
  await page.getByTestId("edit-capacity-west").click();
  await expect(page.getByTestId("hours-RBT-1-780")).toBeVisible();
  await expectAccessible(page, "capacity editor");
  await page.getByTestId("hours-RBT-1-780").fill("6");
  await page.getByTestId("save-capacity").click();
  await expect(page.getByTestId("card-verified-hours-west")).toHaveText("46");

  await page.goto("/missions");
  await page.getByTestId("generate-missions").click();
  const m2 = page.getByTestId("mission-M2-west");
  await m2.getByTestId("approve-mission").click();
  await expect(m2).toHaveAttribute("data-status", "approved");
  await m2.getByTestId("generate-draft-partner_packet").click();
  await expect(page.getByTestId("draft-validation")).toBeVisible();
  await expectAccessible(page, "draft editor");
  await page.getByTestId("approve-draft").click();
  await expect(page.getByTestId("draft-status")).toHaveText("Approved");
  const href = await page.getByTestId("print-packet").getAttribute("href");
  await page.goto(href!);
  await expect(page.locator(".prose-draft")).toBeVisible();
  await expectAccessible(page, "packet print page");
});

test("experiments equity audit tab", async ({ page }) => {
  await loginAs(page, "ops");
  await page.goto("/experiments");
  await page.getByTestId("tab-equity").click();
  await expect(page.getByTestId("equity-table")).toBeVisible();
  await expectAccessible(page, "equity audit");
});

test("inquiry drawer with a reserved capacity hold", async ({ page }) => {
  const alias = `Demo Family Axe${Date.now() % 1000}`;
  await loginAs(page, "intake");
  await page.goto("/intake");
  await page.getByTestId("add-inquiry").click();
  await page.getByLabel("Demo alias").fill(alias);
  await page.getByLabel("Service ZCTA (study area)").selectOption("00111");
  await page.getByLabel("Payer (as reported)").selectOption({ label: "Cascade Commercial (DEMO)" });
  await page.getByTestId("synthetic-ack").check();
  await page.getByTestId("submit-inquiry").click();
  await expect(page.getByTestId("match-results")).toBeVisible();
  await page.goto(`/intake?q=${encodeURIComponent(alias)}`);
  await page.getByTestId("inquiry-row").first().click();
  await page.getByTestId("match-south").getByTestId("reserve-hold").click();
  await expect(page.getByTestId("holds").getByTestId("hold-reserved")).toBeVisible();
  await expectAccessible(page, "drawer with reserved hold");
});

test("intake Kanban board with move menus", async ({ page }) => {
  await loginAs(page, "intake");
  await page.goto("/intake");
  await page.getByRole("button", { name: "Kanban" }).click();
  await expect(page.getByTestId("kanban-card").first()).toBeVisible();
  await expect(page.getByTestId("kanban-move").first()).toBeVisible();
  await expectAccessible(page, "intake kanban");
});
