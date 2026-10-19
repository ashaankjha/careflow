import { describe, expect, it } from "vitest";
import { renderDraft, validateDraft, type VerifiedFacts } from "../src/content";

const facts: VerifiedFacts = {
  orgName: "Harbor Behavioral Services (DEMO)",
  center: { name: "West Center", addressLine: "200 Demo Way", city: "Harbor Bay (DEMO)", state: "DM", zip: "00105", serviceModes: ["center", "telehealth_if_applicable"], serviceRadiusMiles: 11, acceptedAgeMin: 2, acceptedAgeMax: 16, intakePhone: "555-0101 (demo)", intakeEmail: "west@harbor.demo" },
  verifiedPayers: [{ name: "Cascade Commercial (DEMO)", lastVerifiedAt: "2026-10-01T00:00:00Z" }, { name: "Meridian Medicaid Plan (DEMO)", lastVerifiedAt: "2026-10-01T00:00:00Z" }],
  otherPayers: ["Pinecrest Health Network (DEMO)"],
  verifiedHoursAvailable: 46,
  capacityVerifiedAt: "2026-10-15T00:00:00Z",
  serviceAreaZctas: ["00101", "00105", "00106"],
  referralCode: "BAYPEDS",
  partnerName: "Bayview Pediatrics Group (DEMO)",
  mission: null,
};

describe("deterministic drafts (AI disabled)", () => {
  it("referral packet is substantive and only lists verified facts", () => {
    const d = renderDraft("partner_packet", facts);
    expect(d.bodyMd.length).toBeGreaterThan(800);
    expect(d.bodyMd).toContain("Meridian Medicaid Plan (DEMO)");
    expect(d.bodyMd).toContain("subject to verification");
    expect(d.bodyMd).not.toContain("Pinecrest");
    expect(d.bodyMd).toMatch(/do not offer gifts, payments/i);
    expect(validateDraft(d.bodyMd, facts, "partner_packet").status).toBe("pass");
  });
  it("every template passes the claim validator", () => {
    for (const k of ["seo_page", "partner_packet", "referral_email", "internal_plan"] as const) {
      expect(validateDraft(renderDraft(k, facts).bodyMd, facts, k).issues).toEqual([]);
    }
  });
});

describe("claim validator", () => {
  it("flags unverified payers, guarantees, wait-time promises and remuneration", () => {
    const bad = "We accept Pinecrest Health Network (DEMO). Guaranteed results, no waitlist, start within 3 days. $50 gift card per referral.";
    const v = validateDraft(bad, facts, "partner_packet");
    expect(v.status).toBe("needs_review");
    const msgs = v.issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/not verified as accepted/);
    expect(msgs).toMatch(/guarantees/);
    expect(msgs).toMatch(/Wait-time/);
    expect(msgs).toMatch(/Timeframe/);
    expect(msgs).toMatch(/remuneration/);
  });
  it("flags ZIPs outside the verified service area", () => {
    expect(validateDraft("We serve 90210.", facts, "seo_page").issues[0]?.message).toMatch(/not in the verified service area/);
  });
});
