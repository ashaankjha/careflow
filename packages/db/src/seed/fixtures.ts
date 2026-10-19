/**
 * Static synthetic fixture definitions. EVERYTHING here is fictional:
 * organisation, sites, addresses, payers, partners, people and geography.
 * The "Harbor Bay" metro is placed over open water on purpose so its
 * coordinates cannot be mistaken for a real practice location, and ZCTA-like
 * codes 00101–00112 are not assigned by the US Census Bureau.
 */
import { seedUuid } from "../ids";

export const DEMO_PASSWORD = "demo-pass-2026";

export const HARBOR = {
  id: seedUuid("org:harbor"),
  name: "Harbor Behavioral Services (DEMO)",
  timezone: "America/Los_Angeles",
};
export const LAKESIDE = {
  id: seedUuid("org:lakeside"),
  name: "Lakeside Autism Partners (DEMO)",
  timezone: "America/Chicago",
};

export const USERS = [
  { key: "admin", org: HARBOR.id, email: "admin@harbor.demo", role: "admin", displayName: "Avery Chen" },
  { key: "growth", org: HARBOR.id, email: "growth@harbor.demo", role: "growth", displayName: "Riley Okafor" },
  { key: "intake", org: HARBOR.id, email: "intake@harbor.demo", role: "intake", displayName: "Jordan Lee" },
  { key: "intake2", org: HARBOR.id, email: "intake2@harbor.demo", role: "intake", displayName: "Morgan Diaz" },
  { key: "ops", org: HARBOR.id, email: "ops@harbor.demo", role: "ops", displayName: "Sam Patel" },
  { key: "viewer", org: HARBOR.id, email: "viewer@harbor.demo", role: "viewer", displayName: "Casey Brooks" },
  { key: "lakeside_admin", org: LAKESIDE.id, email: "admin@lakeside.demo", role: "admin", displayName: "Drew Lindqvist" },
] as const;
export const userId = (key: string) => seedUuid(`user:${key}`);

// Fictional local plane: x/y miles from an origin over open water.
const ORIGIN = { lat: 32.95, lng: -117.95 };
export const toLatLng = (x: number, y: number) => ({
  lat: Math.round((ORIGIN.lat - y / 69) * 1e5) / 1e5,
  lng: Math.round((ORIGIN.lng + x / 58) * 1e5) / 1e5,
});
const hexXY = (q: number, r: number) => ({ x: 6.93 * (q + r / 2), y: 6 * r });

export const ZCTAS = [
  { zcta: "00101", label: "Harbor Heights", q: 0, r: 0, children: 2850, moe: 310, listings: 4 },
  { zcta: "00102", label: "Northgate", q: 1, r: 0, children: 4120, moe: 390, listings: 9 },
  { zcta: "00103", label: "Cedar Park", q: 2, r: 0, children: 5340, moe: 470, listings: 11 },
  { zcta: "00104", label: "Eastbluff", q: 3, r: 0, children: 1980, moe: 260, listings: 2 },
  { zcta: "00105", label: "Westshore", q: 0, r: 1, children: 3660, moe: 350, listings: 3 },
  { zcta: "00106", label: "Midtown", q: 1, r: 1, children: 6120, moe: 520, listings: 12 },
  { zcta: "00107", label: "Riverbend", q: 2, r: 1, children: 4480, moe: 410, listings: 6 },
  { zcta: "00108", label: "Lighthouse Point", q: 3, r: 1, children: 380, moe: 140, listings: 0 },
  { zcta: "00109", label: "Sandpiper", q: -1, r: 2, children: 2310, moe: 280, listings: 1 },
  { zcta: "00110", label: "Old Mill", q: 0, r: 2, children: 3890, moe: 360, listings: null },
  { zcta: "00111", label: "Southport", q: 1, r: 2, children: 5720, moe: 500, listings: 8 },
  { zcta: "00112", label: "Kelp Bay", q: 2, r: 2, children: 3010, moe: 300, listings: 5 },
].map((z) => {
  const { x, y } = hexXY(z.q, z.r);
  return { ...z, ...toLatLng(x, y) };
});

export const CENTERS = [
  {
    key: "north",
    name: "North Center",
    addressLine: "100 Demo Way, Suite N",
    city: "Harbor Bay (DEMO)",
    zip: "00103",
    xy: { x: 13.9, y: 0.5 },
    serviceModes: ["center", "home"],
    radius: 11,
    ageMin: 2,
    ageMax: 12,
    phone: "555-0100 (demo)",
    email: "north-intake@harbor.demo",
    publicProfileStatus: "current",
  },
  {
    key: "west",
    name: "West Center",
    addressLine: "200 Demo Way, Suite W",
    city: "Harbor Bay (DEMO)",
    zip: "00105",
    xy: { x: 2.0, y: 7.0 },
    serviceModes: ["center", "telehealth_if_applicable"],
    radius: 11,
    ageMin: 2,
    ageMax: 16,
    phone: "555-0101 (demo)",
    email: "west-intake@harbor.demo",
    publicProfileStatus: "missing",
  },
  {
    key: "south",
    name: "South Center",
    addressLine: "300 Demo Way, Suite S",
    city: "Harbor Bay (DEMO)",
    zip: "00111",
    xy: { x: 14.5, y: 12.5 },
    serviceModes: ["center", "home"],
    radius: 11,
    ageMin: 3,
    ageMax: 14,
    phone: "555-0102 (demo)",
    email: "south-intake@harbor.demo",
    publicProfileStatus: "current",
  },
] as const;
export const centerId = (key: string) => seedUuid(`center:harbor:${key}`);

export const PAYERS = [
  { key: "cascade", name: "Cascade Commercial (DEMO)", category: "commercial" },
  { key: "meridian", name: "Meridian Medicaid Plan (DEMO)", category: "medicaid_managed_care" },
  { key: "pinecrest", name: "Pinecrest Health Network (DEMO)", category: "commercial" },
] as const;
export const payerId = (key: string) => seedUuid(`payer:harbor:${key}`);

/** Payer participation as recorded by ops staff (the story: Meridian is accepted by West but not North). */
export const CENTER_PAYERS: Record<string, Record<string, { status: "verified_accepted" | "not_accepted" | "unknown"; verifiedDaysAgo: number | null; notes?: string }>> = {
  north: {
    cascade: { status: "verified_accepted", verifiedDaysAgo: 21 },
    meridian: { status: "not_accepted", verifiedDaysAgo: 21, notes: "Site not in network (staff-confirmed)" },
    pinecrest: { status: "unknown", verifiedDaysAgo: null, notes: "Contract renewal status unconfirmed" },
  },
  west: {
    cascade: { status: "verified_accepted", verifiedDaysAgo: 18 },
    meridian: { status: "verified_accepted", verifiedDaysAgo: 18 },
    pinecrest: { status: "not_accepted", verifiedDaysAgo: 18 },
  },
  south: {
    cascade: { status: "verified_accepted", verifiedDaysAgo: 33 },
    meridian: { status: "unknown", verifiedDaysAgo: null, notes: "Credentialing in progress" },
    pinecrest: { status: "verified_accepted", verifiedDaysAgo: 33 },
  },
};

type W = { role: "RBT" | "BCBA"; days: number[]; start: number; end: number; hours: number | number[]; mode: string; verifiedDaysAgo: number | null };
const MORNING = { start: 8 * 60, end: 12 * 60 };
const AFTERNOON = { start: 13 * 60, end: 18 * 60 };
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Aggregated weekly *unbooked* staff hours per window (12–14 rows per site). */
export const CAPACITY_WINDOWS: Record<string, W[]> = {
  // North: afternoons fully booked (0 verified hours) → afternoon RBT bottleneck.
  north: [
    { role: "RBT", days: WEEKDAYS, ...MORNING, hours: 1, mode: "center", verifiedDaysAgo: 6 },
    { role: "RBT", days: WEEKDAYS, ...AFTERNOON, hours: 0, mode: "center", verifiedDaysAgo: 6 },
    { role: "BCBA", days: [1, 3], start: 8 * 60, end: 17 * 60, hours: 4, mode: "center", verifiedDaysAgo: 6 },
  ],
  // West: verified morning hours; new afternoon hours entered by the location manager, pending ops verification.
  west: [
    { role: "RBT", days: WEEKDAYS, ...MORNING, hours: 4, mode: "center", verifiedDaysAgo: 5 },
    { role: "RBT", days: WEEKDAYS, ...AFTERNOON, hours: 5, mode: "center", verifiedDaysAgo: null },
    { role: "BCBA", days: [2, 4], start: 8 * 60, end: 17 * 60, hours: 3, mode: "center", verifiedDaysAgo: 5 },
  ],
  // South: reasonable staffing; throughput limited by benefits verification.
  south: [
    { role: "RBT", days: WEEKDAYS, ...MORNING, hours: 3, mode: "center", verifiedDaysAgo: 4 },
    { role: "RBT", days: WEEKDAYS, ...AFTERNOON, hours: 4, mode: "center", verifiedDaysAgo: 4 },
    { role: "RBT", days: [2, 4], start: 9 * 60, end: 18 * 60, hours: 4, mode: "home", verifiedDaysAgo: 4 },
    { role: "BCBA", days: [1, 4], start: 8 * 60, end: 17 * 60, hours: 4.5, mode: "center", verifiedDaysAgo: 4 },
  ],
};

export const CAPACITY_RULES: Record<string, { payer: string | null; ratio: number | null; minRbt: number | null; maxNew: number | null; verified: boolean }[]> = {
  north: [{ payer: null, ratio: 0.1, minRbt: 1, maxNew: 4, verified: true }],
  west: [{ payer: null, ratio: 0.1, minRbt: 1, maxNew: 4, verified: true }],
  south: [
    { payer: null, ratio: 0.1, minRbt: 1, maxNew: 6, verified: true },
    { payer: "pinecrest", ratio: 0.125, minRbt: 1, maxNew: null, verified: true },
  ],
};

export const PARTNERS = [
  { key: "bayview", name: "Bayview Pediatrics Group (DEMO)", category: "pediatrics", zcta: "00106", status: "active", permission: "granted", code: "BAYPEDS", weight: 22 },
  { key: "cedar", name: "Cedar Park Speech & Language (DEMO)", category: "speech_therapy", zcta: "00103", status: "active", permission: "granted", code: "CEDARSLP", weight: 2 },
  { key: "riverbend", name: "Riverbend Developmental Pediatrics (DEMO)", category: "developmental_pediatrics", zcta: "00107", status: "active", permission: "granted", code: "RVBDEV", weight: 2 },
  { key: "southport_ot", name: "Southport Occupational Therapy (DEMO)", category: "occupational_therapy", zcta: "00111", status: "active", permission: "granted", code: "SPORTOT", weight: 1.5 },
  { key: "harbor_frc", name: "Harbor Family Resource Center (DEMO)", category: "family_resource_center", zcta: "00110", status: "active", permission: "granted", code: "HBFRC", weight: 1 },
  { key: "northgate_peds", name: "Northgate Children's Clinic (DEMO)", category: "pediatrics", zcta: "00102", status: "active", permission: "granted", code: "NGCC", weight: 1 },
  { key: "westshore_peds", name: "Westshore Pediatric Associates (DEMO)", category: "pediatrics", zcta: "00105", status: "prospect", permission: "not_requested", code: null, weight: 0 },
  { key: "sandpiper_slp", name: "Sandpiper Speech Studio (DEMO)", category: "speech_therapy", zcta: "00109", status: "prospect", permission: "not_requested", code: null, weight: 0 },
  { key: "midtown_psych", name: "Midtown Child Psychology (DEMO)", category: "child_psychology", zcta: "00106", status: "active", permission: "granted", code: "MIDPSY", weight: 0.5 },
  { key: "kelp_ot", name: "Kelp Bay Therapy Collective (DEMO)", category: "occupational_therapy", zcta: "00112", status: "paused", permission: "declined", code: "KELPOT", weight: 0.2 },
  { key: "oldmill_fp", name: "Old Mill Family Practice (DEMO)", category: "family_medicine", zcta: "00110", status: "active", permission: "granted", code: "OMFP", weight: 0.5 },
  { key: "eastbluff_peds", name: "Eastbluff Pediatrics (DEMO)", category: "pediatrics", zcta: "00104", status: "prospect", permission: "not_requested", code: null, weight: 0 },
  { key: "heights_dev", name: "Harbor Heights Early Learning Network (DEMO)", category: "early_intervention", zcta: "00101", status: "active", permission: "granted", code: "HHELN", weight: 0.6 },
  { key: "westshore_slp", name: "Westshore Speech Collaborative (DEMO)", category: "speech_therapy", zcta: "00105", status: "prospect", permission: "not_requested", code: null, weight: 0 },
] as const;
export const partnerId = (key: string) => seedUuid(`partner:harbor:${key}`);
export const referralCodeId = (code: string) => seedUuid(`refcode:harbor:${code}`);
