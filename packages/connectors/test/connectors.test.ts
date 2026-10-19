import type { VerifiedFacts } from "@careflow/core";
import { describe, expect, it, vi } from "vitest";
import { buildLlmPayload, contentProviderFromEnv, createLlmProvider, templateProvider } from "../src/llm";
import { createAcsConnector, normalizeAcs } from "../src/acs";
import { disabledDeliveryProvider } from "../src/delivery";
import { FeatureDisabled } from "../src/errors";
import { fetchWithRetry } from "../src/fetch";

const facts: VerifiedFacts = {
  orgName: "Harbor Behavioral Services (DEMO)",
  center: { name: "West Center", addressLine: "200 Demo Way", city: "Harbor Bay (DEMO)", state: "DM", zip: "00105", serviceModes: ["center"], serviceRadiusMiles: 11, acceptedAgeMin: 2, acceptedAgeMax: 16, intakePhone: "555-0101 (demo)", intakeEmail: "west@harbor.demo" },
  verifiedPayers: [{ name: "Cascade Commercial (DEMO)", lastVerifiedAt: "2026-10-01T00:00:00Z" }],
  otherPayers: [],
  verifiedHoursAvailable: 46,
  capacityVerifiedAt: "2026-10-15T00:00:00Z",
  serviceAreaZctas: ["00105"],
  mission: {
    title: "West: connect families to verified capacity",
    explanation: "46 verified hours",
    proposedAction: "Packet",
    guardrail: "No promises",
    evidence: [{ metricKey: "inquiries_created", label: "Inquiries", numerator: 11, denominator: null, timeRange: "last 30 days", eventCount: 11 }],
  },
};

describe("LLM adapter", () => {
  it("payload is an explicit allowlist of public business facts and aggregates — no family data", () => {
    // Smuggle family-like data onto the facts object: it must not reach the payload.
    const polluted = { ...facts, inquiries: [{ contactAlias: "Demo Family 042", serviceZip: "00106", notes: "x" }], contactAlias: "Demo Family 042" } as unknown as VerifiedFacts;
    const payload = buildLlmPayload("partner_packet", polluted, "base draft");
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/Demo Family|contactAlias|inquiries|notes|serviceZip/);
    expect(Object.keys(payload.facts).sort()).toEqual(
      ["aggregateEvidence", "city", "centerName", "intakePhone", "missionTitle", "orgName", "serviceModes", "serviceRadiusMiles", "state", "verifiedPayerNames"].sort(),
    );
    expect(Object.keys(payload.facts.aggregateEvidence[0]!).sort()).toEqual(["denominator", "label", "numerator", "timeRange"]);
  });

  it("is offline by default", () => {
    expect(contentProviderFromEnv({}).name).toBe("template");
    expect(contentProviderFromEnv({ LLM_ENABLED: "true" }).name).toBe("template"); // missing config => offline
  });

  it("falls back to the deterministic template when the LLM fails or adds unsupported claims", async () => {
    const failing = createLlmProvider({ baseUrl: "http://x", apiKey: "k", model: "m", fetchImpl: vi.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch });
    expect((await failing.generate("partner_packet", facts)).generator).toBe("template");
    const lying = createLlmProvider({
      baseUrl: "http://x",
      apiKey: "k",
      model: "m",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Guaranteed openings today, no waitlist!" } }] }))) as unknown as typeof fetch,
    });
    const out = await lying.generate("partner_packet", facts);
    expect(out.generator).toBe("template");
    expect(out.bodyMd).not.toMatch(/Guaranteed/);
  });

  it("template provider produces a substantive draft", async () => {
    const d = await templateProvider.generate("seo_page", facts);
    expect(d.bodyMd).toContain("West Center");
    expect(d.bodyMd.length).toBeGreaterThan(600);
  });
});

describe("ACS connector", () => {
  it("sums the six age cells and handles suppressed sentinels", () => {
    const raw = [
      ["NAME", "B01001_003E", "B01001_004E", "B01001_005E", "B01001_027E", "B01001_028E", "B01001_029E", "zip code tabulation area"],
      ["ZCTA5 92618", "100", "110", "120", "90", "95", "105", "92618"],
      ["ZCTA5 00000", "-666666666", "10", "10", "10", "10", "10", "00000"],
      ["ZCTA5 00001", "-666666666", "-666666666", "-666666666", "-666666666", "-666666666", "-666666666", "00001"],
    ];
    const { rows, warnings } = normalizeAcs(raw);
    expect(rows[0]).toMatchObject({ zcta5: "92618", child014Est: 620 });
    expect(rows[1]!.warnings[0]).toMatch(/lower bound/);
    expect(rows[2]!.child014Est).toBeNull();
    expect(warnings.join(" ")).toMatch(/ZCTAs approximate/);
  });

  it("without an API key the connector declines to run (fixture retained)", () => {
    expect(createAcsConnector({}).validateConfig()).toMatchObject({ ok: false });
  });

  it("network failure surfaces as an error after bounded retries (caller records a failed snapshot)", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    const c = createAcsConnector({ apiKey: "k", zctas: ["92618"], fetchImpl: f as unknown as typeof fetch, retries: 1, timeoutMs: 50 });
    await expect(c.fetch()).rejects.toThrow("ENOTFOUND");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("fetchWithRetry retries 5xx then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const res = await fetchWithRetry("http://x", { fetchImpl: f as unknown as typeof fetch, baseDelayMs: 1 });
    expect(res.status).toBe(200);
  });
});

describe("delivery", () => {
  it("send is disabled in the MVP", async () => {
    await expect(disabledDeliveryProvider.send({ title: "t", bodyMd: "b" })).rejects.toBeInstanceOf(FeatureDisabled);
    expect(disabledDeliveryProvider.preview({ title: "t", bodyMd: "b" }).channel).toBe("local_preview");
  });
});
