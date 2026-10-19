import { expect, test } from "@playwright/test";
import { kpiNumber, loginAs, shot } from "./helpers";

/**
 * The seven seeded demo workflows from PRD §16, run in order against one
 * deterministic seed (global setup). Includes the acceptance demo from the
 * agent handoff: Meridian accepted by West but not North, West staff-hours
 * edit changes eligibility, West mission from verified capacity, approved
 * packet, connected experiment, and a full reset.
 */
test.describe.configure({ mode: "serial" });

const ALIAS = `Demo Family E2E${Date.now() % 1000}`;

test("1. overview shows three operational bottlenecks computed from events", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page.getByRole("heading", { name: "Growth overview" })).toBeVisible();
  const north = page.getByTestId("site-row-north");
  await expect(north).toContainText("Demand exceeds verified capacity");
  await expect(page.getByTestId("site-row-south")).toContainText("Benefits verification stalls");
  await expect(page.getByTestId("site-row-west")).toContainText("pending ops verification");
  await expect(page.getByTestId("verified-hours-west")).toContainText("20");
  // KPIs show numerator / denominator
  await expect(page.getByTestId("kpi-start-rate-ratio")).toHaveText(/\d+ \/ \d+/);
  await expect(page.getByTestId("kpi-capacity-fit-ratio")).toHaveText(/\d+ \/ \d+/);
  await expect(page.getByTestId("unattributed-row")).toBeVisible();
  // filtering by site changes numerator and denominator together
  const allRatio = await page.getByTestId("kpi-start-rate-ratio").innerText();
  await page.getByLabel("Site").selectOption({ label: "West Center" });
  await expect(page.getByTestId("kpi-start-rate-ratio")).not.toHaveText(allRatio);
  await page.getByLabel("Site").selectOption({ label: "All sites" });
  await shot(page, "01-overview");
});

test("2. enter a synthetic inquiry and inspect ranked matches", async ({ page }) => {
  await loginAs(page, "intake");
  await page.goto("/intake");
  await page.getByTestId("add-inquiry").click();
  // real-looking PII is rejected
  await page.getByLabel("Demo alias").fill("jane.doe@gmail.com");
  await page.getByLabel("Payer (as reported)").selectOption({ label: "Meridian Medicaid Plan (DEMO)" });
  await page.getByTestId("synthetic-ack").check();
  await page.getByTestId("submit-inquiry").click();
  await expect(page.getByTestId("inquiry-error")).toBeVisible();
  // valid synthetic inquiry (defaults: ZCTA 00106, Mon/Wed/Thu 2–6pm, 6 h)
  await page.getByLabel("Demo alias").fill(ALIAS);
  await page.getByTestId("submit-inquiry").click();
  const results = page.getByTestId("match-results");
  await expect(results).toBeVisible();
  await expect(page.getByTestId("match-north")).toHaveAttribute("data-eligibility", "not_feasible");
  await expect(page.getByTestId("match-north").locator('[data-gate="payer"]')).toHaveAttribute("data-gate-status", "fail");
  await expect(page.getByTestId("match-west").locator('[data-gate="payer"]')).toHaveAttribute("data-gate-status", "pass");
  await expect(page.getByTestId("match-west")).toHaveAttribute("data-eligibility", "verification_needed");
  await expect(page.getByTestId("timeline")).toContainText("Inquiry Created");
  await shot(page, "02-intake-drawer-matches");
});

test("3. editing West staff hours changes eligibility; dashboard refreshes", async ({ page }) => {
  await loginAs(page, "ops");
  await page.goto("/capacity");
  await page.getByRole("button", { name: "Load acceptance scenario" }).click();
  await expect(page.getByTestId("match-west")).toHaveAttribute("data-eligibility", "verification_needed");
  await expect(page.getByTestId("match-north").locator('[data-gate="payer"]')).toContainText("not accepting");
  await shot(page, "03a-capacity-before");
  await page.getByTestId("edit-capacity-west").click();
  // Monday 13:00 RBT window: 5 → 6 hours, then save & attest as verified
  await page.getByTestId("hours-RBT-1-780").fill("6");
  await page.getByTestId("save-capacity").click();
  await expect(page.getByTestId("match-west")).toHaveAttribute("data-eligibility", "potential_fit");
  await expect(page.getByTestId("match-west").getByTestId("match-score")).toBeVisible();
  await expect(page.getByTestId("card-verified-hours-west")).toHaveText("46");
  await shot(page, "03b-capacity-after");
  await page.goto("/");
  await expect(page.getByTestId("verified-hours-west")).toContainText("46");
  await expect(page.getByTestId("site-row-west")).toContainText("Verified capacity available");
});

test("4. progressing an inquiry to a verified start recomputes the dashboard", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/?range=30");
  const before = await kpiNumber(page, "kpi-care-starts");
  await page.goto(`/intake?q=${encodeURIComponent(ALIAS)}`);
  await page.getByTestId("inquiry-row").first().click();
  await page.getByTestId("match-west").getByRole("button", { name: "Select as target site" }).click();
  await expect(page.getByTestId("match-west")).toContainText("Selected site");
  await page.getByTestId("log-outreach").click();
  for (const s of ["contacted", "qualified", "benefits_pending", "benefits_verified", "assessment_pending", "authorization_pending", "ready_to_start", "started"]) {
    await page.getByTestId(`transition-${s}`).click();
    await expect(page.getByTestId("drawer-stage")).not.toHaveText(/New/);
    await page.waitForTimeout(150);
  }
  await expect(page.getByTestId("drawer-stage")).toHaveText("Started (verified)");
  await expect(page.getByTestId("timeline")).toContainText("Care Started Verified By Staff");
  await page.goto("/?range=30");
  expect(await kpiNumber(page, "kpi-care-starts")).toBe(before + 1);
});

test("5. generate a West mission from verified capacity, approve packet, connect experiment", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/missions");
  await page.getByTestId("generate-missions").click();
  const m2 = page.getByTestId("mission-M2-west");
  await expect(m2).toBeVisible();
  await expect(m2.getByTestId("mission-evidence")).toContainText("Verified direct h/wk available");
  await m2.getByTestId("approve-mission").click();
  await expect(m2).toHaveAttribute("data-status", "approved");
  await m2.getByTestId("generate-draft-partner_packet").click();
  await expect(page.getByTestId("draft-validation")).toContainText("traces to verified records");
  // accurate packet: verified payers only, never the not-accepted one
  await expect(page.locator(".prose-draft")).toContainText("Meridian Medicaid Plan (DEMO)");
  await expect(page.locator(".prose-draft")).not.toContainText("Pinecrest");
  await page.getByTestId("approve-draft").click();
  await expect(page.getByTestId("draft-status")).toHaveText("Approved");
  await expect(page.getByRole("button", { name: /Send \(disabled\)/ })).toBeDisabled();
  await shot(page, "05a-approved-packet");
  await page.keyboard.press("Escape");
  await m2.getByTestId("start-experiment").click();
  await page.getByTestId("create-experiment").click();
  await expect(m2.getByTestId("mission-experiment-link")).toBeVisible();
  await expect(m2).toHaveAttribute("data-status", "in_progress");
  await shot(page, "05b-missions");
  await m2.getByTestId("mission-experiment-link").click();
  await expect(page.getByTestId("experiment-results")).toBeVisible();
  await expect(page.getByTestId("experiment-verdict")).toHaveText("Insufficient evidence");
  await expect(page.getByText(/persisted HMAC assignments/)).toBeVisible();
  await shot(page, "05c-experiment");
});

test("6. market map shows source freshness and survives a refresh with no API key", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/market");
  await expect(page.getByTestId("market-map")).toBeVisible();
  await page.getByTestId("tile-00108").click();
  await expect(page.getByTestId("zcta-detail")).toContainText("not ranked");
  await page.getByTestId("tile-00105").click();
  await expect(page.getByTestId("zcta-detail")).toContainText("Westshore");
  await expect(page.getByTestId("provenance")).toContainText("Synthetic values in ACS 2024 5-year B01001 shape");
  await page.getByTestId("market-refresh").click();
  await expect(page.getByTestId("provenance")).toContainText("skipped");
  await expect(page.getByTestId("market-map")).toBeVisible();
  await shot(page, "06-market-map");
});

test("7. reset demo restores the exact seed state", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/settings");
  await page.getByTestId("demo-reset").click();
  await page.getByTestId("confirm-reset").click();
  await expect(page.getByText(/Demo reset: 150 inquiries/)).toBeVisible({ timeout: 30_000 });
  await page.goto("/");
  await expect(page.getByTestId("verified-hours-west")).toContainText("20");
  await page.goto("/missions");
  await expect(page.getByTestId("mission-M2-west")).toHaveCount(0);
  await page.goto(`/intake?q=${encodeURIComponent(ALIAS)}`);
  await expect(page.getByTestId("inquiry-row")).toHaveCount(0);
  await page.goto("/settings");
  await shot(page, "07-settings");
});

test("8. reserve verified capacity as a hold (not an appointment), then release it", async ({ page }) => {
  const alias = `Demo Family Hold${Date.now() % 1000}`;
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
  const south = page.getByTestId("match-south");
  await expect(south).toHaveAttribute("data-eligibility", "potential_fit");
  // only verified potential fits offer a reservation
  await expect(page.getByTestId("match-west").getByTestId("reserve-hold")).toHaveCount(0);
  await south.getByTestId("reserve-hold").click();
  await expect(south.getByTestId("hold-reserved-badge")).toContainText("not an appointment");
  const holds = page.getByTestId("holds");
  await expect(holds.getByTestId("hold-reserved")).toContainText("Reserved — not an appointment");
  await expect(holds).toContainText("It is not an appointment");
  await expect(page.getByTestId("timeline")).toContainText("Capacity Hold Reserved");
  await expect(page.getByTestId("reserve-hold")).toHaveCount(0);
  await shot(page, "08-capacity-hold");
  await holds.getByTestId("release-hold").click();
  await expect(holds.getByTestId("hold-released")).toBeVisible();
  await expect(page.getByTestId("timeline")).toContainText("Capacity Hold Released");
  await expect(south.getByTestId("reserve-hold")).toBeVisible();
});

test("9. equity audit tab shows suppressed, aggregate-only payer-group rates", async ({ page }) => {
  await loginAs(page, "ops");
  await page.goto("/experiments");
  await page.getByTestId("tab-equity").click();
  const panel = page.getByTestId("equity-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("equity-notice")).toHaveText("Equity audit only — never used for scoring, ranking, matching or exclusion.");
  await expect(page.getByTestId("equity-row-overall")).toContainText("All payer groups");
  await expect(page.getByTestId("equity-row-commercial")).toBeVisible();
  await expect(page.getByTestId("equity-min-cell")).toContainText("Small-cell threshold: 5");
  await expect(page.getByTestId("equity-table").getByText("suppressed", { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("equity-caveats")).toContainText("Nothing here is causal");
  await page.getByLabel("Site").selectOption({ label: "North Center" });
  await expect(panel).toContainText("North Center");
  await shot(page, "09-equity-audit");
  // read-only location managers do not get the equity audit
  await page.context().clearCookies();
  await loginAs(page, "viewer");
  await page.goto("/experiments");
  await expect(page.getByTestId("experiment-item").first()).toBeVisible();
  await expect(page.getByTestId("tab-equity")).toHaveCount(0);
});

test("10. generate and approve a Spanish (es-US) referral packet; print page sets lang", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/capacity");
  await page.getByTestId("edit-capacity-west").click();
  await page.getByTestId("hours-RBT-1-780").fill("6");
  await page.getByTestId("save-capacity").click();
  await expect(page.getByTestId("card-verified-hours-west")).toHaveText("46");
  await page.goto("/missions");
  await page.getByTestId("generate-missions").click();
  const m2 = page.getByTestId("mission-M2-west");
  await m2.getByTestId("approve-mission").click();
  await expect(m2).toHaveAttribute("data-status", "approved");
  // defaults to English; Spanish is flagged as machine-authored
  await expect(m2.getByTestId("draft-locale")).toHaveValue("en-US");
  await m2.getByTestId("draft-locale").selectOption("es-US");
  await expect(m2.getByTestId("draft-locale-note")).toContainText("qualified human translator");
  await m2.getByTestId("generate-draft-partner_packet").click();
  await expect(page.getByTestId("draft-locale-badge")).toHaveText("Spanish (es-US)");
  await expect(page.getByTestId("draft-translation-note")).toContainText("Machine-authored Spanish template");
  await expect(page.getByTestId("draft-validation")).toContainText("traces to verified records");
  const preview = page.locator(".prose-draft");
  await expect(preview).toHaveAttribute("lang", "es-US");
  await expect(preview).toContainText("Información de referidos para socios profesionales");
  await expect(preview).toContainText("Meridian Medicaid Plan (DEMO) — participación verificada por el personal");
  await expect(preview).toContainText("sujeta a verificación");
  await expect(preview).not.toContainText("Pinecrest");
  await page.getByTestId("approve-draft").click();
  await expect(page.getByTestId("draft-status")).toHaveText("Approved");
  await expect(page.getByRole("button", { name: /Send \(disabled\)/ })).toBeDisabled();
  await shot(page, "10a-spanish-packet");
  const href = await page.getByTestId("print-packet").getAttribute("href");
  await page.goto(href!);
  await expect(page.getByTestId("packet-body")).toHaveAttribute("lang", "es-US");
  await expect(page.getByTestId("packet-body")).toContainText("No ofrecemos regalos, pagos ni nada de valor");
  await expect(page.getByTestId("packet-translation-note")).toBeVisible();
  const exported = await page.request.get(`/api/v1/drafts/${href!.split("/").pop()}/export?format=html`);
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toContain('<html lang="es-US">');
  await shot(page, "10b-spanish-packet-print");
});
