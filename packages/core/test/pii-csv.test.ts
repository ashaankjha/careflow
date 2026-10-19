import { describe, expect, it } from "vitest";
import { validateCsv, CSV_TEMPLATE } from "../src/csv";
import { isDemoAlias, scanForSuspiciousPii } from "../src/pii";

describe("demo PII guard", () => {
  it("accepts clearly fake aliases only", () => {
    expect(isDemoAlias("Demo Family 042")).toBe(true);
    expect(isDemoAlias("Maria Lopez")).toBe(false);
  });
  it("detects real-looking contact data and clinical terms", () => {
    const kinds = scanForSuspiciousPii({ a: "jane@gmail.com", b: "(619) 555-1234", c: "123 Main Street", d: "autism diagnosis", e: "04/12/2019" }).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["email", "phone", "address", "clinical", "dob"]));
  });
});

describe("CSV import validation", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  it("template parses cleanly", () => {
    const r = validateCsv(CSV_TEMPLATE, { now });
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });
  it("reports line-specific errors and rejects PII and non-new stages", () => {
    const csv = `${CSV_TEMPLATE.split("\n")[0]}
x1,2026-10-01T10:00:00Z,john.smith@example.com,00104,,center,1,15:00,18:00,phone,,new
x2,not-a-date,Demo Family 2,123,,boat,9,18:00,15:00,fax,,started
x1,2026-10-01T10:00:00Z,Demo Family 3,00104,,center,,,,phone,,new`;
    const r = validateCsv(csv, { now });
    expect(r.rows).toHaveLength(0);
    const lines = new Set(r.errors.map((e) => e.line));
    expect([...lines]).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(r.errors.find((e) => e.line === 2 && e.column === "contact_alias")).toBeTruthy();
    expect(r.errors.find((e) => e.line === 3 && e.column === "current_stage")).toBeTruthy();
    expect(r.errors.find((e) => e.line === 4 && /Duplicate/.test(e.message))).toBeTruthy();
  });
  it("rejects future timestamps", () => {
    const csv = `${CSV_TEMPLATE.split("\n")[0]}\nf1,2030-01-01T00:00:00Z,Demo Family 9,00104,,center,,,,phone,,new`;
    expect(validateCsv(csv, { now }).errors[0]?.message).toMatch(/future/);
  });
});
