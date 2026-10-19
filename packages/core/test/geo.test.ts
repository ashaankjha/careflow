import { describe, expect, it } from "vitest";
import { computeOpportunityScores, haversineMiles } from "../src/geo";

describe("opportunity heuristic", () => {
  const rows = [
    { zcta5: "1", children0to14: 5000, providerListings: 2, siteFit: 1 },
    { zcta5: "2", children0to14: 3000, providerListings: 10, siteFit: 0 },
    { zcta5: "3", children0to14: 4000, providerListings: null, siteFit: 0.5 },
    { zcta5: "4", children0to14: 200, providerListings: 0, siteFit: 1 },
  ];
  const r = computeOpportunityScores(rows, 500);
  it("does not rank small denominators", () => {
    expect(r[3]!.ranked).toBe(false);
    expect(r[3]!.score).toBeNull();
  });
  it("re-normalizes missing components with a range and low confidence (never an artificial zero)", () => {
    expect(r[2]!.confidence).toBe("low");
    expect(r[2]!.components.listingGap).toBeNull();
    expect(r[2]!.scoreHigh! - r[2]!.scoreLow!).toBeCloseTo(25, 5);
    expect(r[2]!.score).toBeGreaterThan(0);
  });
  it("scores within 0..100 and prefers population + gap + fit", () => {
    expect(r[0]!.score).toBe(100);
    expect(r[1]!.score).toBe(0);
  });
  it("haversine is sane", () => {
    expect(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(69.09, 1);
  });
});
