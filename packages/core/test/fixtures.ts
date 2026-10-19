import type { MatchCenter } from "../src/matching";
import { DEFAULT_POLICY } from "../src/policy";

export const NOW = new Date("2026-10-15T18:00:00Z");
export const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
export const PAYER_A = "00000000-0000-4000-8000-00000000000a";
export const PAYER_B = "00000000-0000-4000-8000-00000000000b";
export const ctx = (over: Partial<{ zcta: { lat: number; lng: number } | null }> = {}) => ({ now: NOW, policy: DEFAULT_POLICY, zcta: { lat: 32.9, lng: -117.8 }, payerName: "Payer B", ...over });

const weekday = [1, 2, 3, 4, 5];
export function center(id: string, over: Partial<MatchCenter> = {}): MatchCenter {
  return {
    id,
    name: `Center ${id.slice(-1)}`,
    active: true,
    latitude: 32.9,
    longitude: -117.85,
    serviceModes: ["center"],
    serviceRadiusMiles: 10,
    acceptedAgeMin: null,
    acceptedAgeMax: null,
    payers: [
      { payerId: PAYER_A, status: "verified_accepted", lastVerifiedAt: daysAgo(10) },
      { payerId: PAYER_B, status: "verified_accepted", lastVerifiedAt: daysAgo(10) },
    ],
    windows: [
      ...weekday.map((d) => ({ role: "RBT" as const, dayOfWeek: d, startMinute: 780, endMinute: 1080, weeklyAvailableHours: 5, serviceMode: "center" as const, verifiedAt: daysAgo(3) })),
      { role: "BCBA", dayOfWeek: 2, startMinute: 480, endMinute: 1020, weeklyAvailableHours: 4, serviceMode: "center", verifiedAt: daysAgo(3) },
    ],
    rules: [{ payerId: null, requiredBcbaHoursPerDirectHour: 0.1, maxNewStartsPerWeek: 4, isVerified: true }],
    holds: [],
    startsLast7Days: 0,
    onboardingBacklog: 2,
    ...over,
  };
}

export const REQUEST = {
  serviceZip: "00106",
  payerId: PAYER_B,
  preferredModes: ["center" as const],
  preferredWindows: [1, 3, 4].map((d) => ({ dayOfWeek: d, startMinute: 840, endMinute: 1080 })),
  requestedDirectHoursPerWeek: 6,
};
