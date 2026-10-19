import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as equity from "../src/equity";
import { buildEquityReport, EQUITY_AUDIT_NOTICE, EQUITY_STEPS, suppressColumn, type EquityGroupInput, type EquityStepKey } from "../src/equity";
import { createRng } from "../src/stats";

const g = (key: string, n: number, s: Partial<Record<EquityStepKey, [number, number?]>> = {}): EquityGroupInput => ({
  key,
  label: key,
  inquiries: n,
  steps: Object.fromEntries(
    EQUITY_STEPS.map(({ key: k }) => {
      const [num, den] = s[k] ?? [0, n];
      return [k, { numerator: num, denominator: den ?? n }];
    }),
  ) as EquityGroupInput["steps"],
});

describe("suppressColumn", () => {
  it("leaves a column alone when nothing is primary", () => {
    expect(suppressColumn([10, 20, 30], [false, false, false], false)).toEqual({ groups: [null, null, null], total: null });
  });
  it("a single hidden group forces the smallest shown group to be hidden too", () => {
    expect(suppressColumn([3, 40, 12], [true, false, false], false)).toEqual({ groups: ["primary", null, "complementary"], total: null });
  });
  it("ties break by position (deterministic)", () => {
    expect(suppressColumn([2, 9, 9], [true, false, false], false).groups).toEqual(["primary", "complementary", null]);
  });
  it("two hidden groups need no complement", () => {
    expect(suppressColumn([2, 3, 50], [true, true, false], false).groups).toEqual(["primary", "primary", null]);
  });
  it("only one group: hide the total instead", () => {
    expect(suppressColumn([3], [true], false)).toEqual({ groups: ["primary"], total: "complementary" });
  });
  it("hidden total needs no group complement", () => {
    expect(suppressColumn([3, 0], [true, false], true)).toEqual({ groups: ["primary", null], total: "primary" });
  });
});

describe("buildEquityReport", () => {
  it("carries the equity-only notice", () => {
    const r = buildEquityReport([g("a", 50)], 5);
    expect(r.notice).toBe(EQUITY_AUDIT_NOTICE);
    expect(r.notice).toMatch(/never used for scoring, ranking, matching or exclusion/);
  });

  it("computes rates and differences vs overall", () => {
    const r = buildEquityReport([g("a", 40, { care_started: [10] }), g("b", 60, { care_started: [30] })], 5);
    expect(r.overall.steps.care_started).toMatchObject({ numerator: 40, denominator: 100, rate: 0.4, suppressed: null });
    const a = r.groups.find((x) => x.key === "a")!.steps.care_started;
    expect(a.rate).toBe(0.25);
    expect(a.differenceVsOverall).toBeCloseTo(-0.15, 12);
    expect(r.groups.find((x) => x.key === "b")!.steps.care_started.differenceVsOverall).toBeCloseTo(0.1, 12);
  });

  it("primary: numerator between 1 and k−1 is suppressed; complementary hides another group", () => {
    const r = buildEquityReport([g("a", 40, { care_started: [3] }), g("b", 60, { care_started: [30] }), g("c", 50, { care_started: [20] })], 5);
    const cells = Object.fromEntries(r.groups.map((x) => [x.key, x.steps.care_started]));
    expect(cells.a!.suppressed).toBe("primary");
    expect(cells.a!.numerator).toBeNull();
    expect(cells.a!.rate).toBeNull();
    expect(cells.a!.differenceVsOverall).toBeNull();
    // c has the smaller numerator (20 < 30) → complementary
    expect(cells.c!.suppressed).toBe("complementary");
    expect(cells.b!.suppressed).toBeNull();
    expect(r.overall.steps.care_started.numerator).toBe(53);
  });

  it("zero numerators are shown, but 'all but a few' is suppressed", () => {
    const r = buildEquityReport([g("a", 40, { care_started: [0], contact_within_sla: [38] }), g("b", 60), g("c", 30)], 5);
    const a = r.groups.find((x) => x.key === "a")!;
    expect(a.steps.care_started).toMatchObject({ numerator: 0, suppressed: null });
    expect(a.steps.contact_within_sla.suppressed).toBe("primary");
  });

  it("denominator below k suppresses the cell", () => {
    const r = buildEquityReport([g("a", 50, { contact_within_sla: [0, 4] }), g("b", 50, { contact_within_sla: [20, 40] }), g("c", 50, { contact_within_sla: [25, 45] })], 5);
    expect(r.groups.find((x) => x.key === "a")!.steps.contact_within_sla.suppressed).toBe("primary");
    expect(r.groups.filter((x) => x.steps.contact_within_sla.suppressed).length).toBe(2);
  });

  it("a small group hides its count and every step cell, with complementary suppression of the count", () => {
    const r = buildEquityReport([g("tiny", 3, { care_started: [0] }), g("b", 60, { care_started: [30] }), g("c", 50, { care_started: [20] })], 5);
    const tiny = r.groups.find((x) => x.key === "tiny")!;
    expect(tiny.inquiries).toBeNull();
    expect(tiny.inquiriesSuppressed).toBe("primary");
    expect(Object.values(tiny.steps).every((c) => c.suppressed === "primary")).toBe(true);
    expect(r.groups.filter((x) => x.inquiriesSuppressed).length).toBe(2);
    // the complementary row's step denominators would reveal its count, so they are hidden too
    const comp = r.groups.find((x) => x.inquiriesSuppressed === "complementary")!;
    expect(Object.values(comp.steps).every((c) => c.suppressed !== null)).toBe(true);
    expect(r.overall.inquiries).toBe(113);
  });

  it("a single group with a small count hides the total too", () => {
    const r = buildEquityReport([g("only", 50, { care_started: [2] })], 5);
    expect(r.groups[0]!.steps.care_started.suppressed).toBe("primary");
    expect(r.overall.steps.care_started.suppressed).not.toBeNull();
  });

  it("overall below k suppresses everything for that step", () => {
    const r = buildEquityReport([g("a", 50, { match_proposed: [2] }), g("b", 50, { match_proposed: [1] }), g("c", 50)], 5);
    expect(r.overall.steps.match_proposed.suppressed).toBe("primary");
    expect(r.groups.find((x) => x.key === "c")!.steps.match_proposed).toMatchObject({ numerator: 0, differenceVsOverall: null });
  });

  it("minCellSize 1 disables suppression; empty input is safe", () => {
    expect(buildEquityReport([g("a", 2, { care_started: [1] }), g("b", 1)], 1).suppressedCells).toBe(0);
    const e = buildEquityReport([], 5);
    expect(e.groups).toEqual([]);
    expect(e.overall.inquiries).toBe(0);
  });

  it("property: no suppressed count can be recovered by subtraction from a shown total", () => {
    const rng = createRng(20261019);
    for (let trial = 0; trial < 400; trial++) {
      const k = rng.int(2, 11);
      const groups = Array.from({ length: rng.int(1, 6) }, (_, i) => {
        const n = rng.int(0, 40);
        const sla = rng.int(0, n);
        return g(`g${i}`, n, {
          contact_within_sla: [rng.int(0, sla), sla],
          match_proposed: [rng.int(0, Math.min(n, 6))],
          assessment_scheduled: [rng.int(0, n)],
          care_started: [rng.int(0, n)],
        });
      });
      const r = buildEquityReport(groups, k);
      const check = (shown: (number | null)[], total: number | null) => {
        const hidden = shown.filter((v) => v === null).length;
        if (total !== null) expect(hidden === 0 || hidden >= 2).toBe(true);
      };
      check(r.groups.map((x) => x.inquiries), r.overall.inquiries);
      for (const { key } of EQUITY_STEPS) {
        check(r.groups.map((x) => x.steps[key].numerator), r.overall.steps[key].numerator);
        check(r.groups.map((x) => x.steps[key].denominator), r.overall.steps[key].denominator);
        for (const x of [...r.groups, r.overall]) {
          const c = x.steps[key];
          if (c.numerator === null) continue;
          // every shown cell satisfies the primary rule
          expect(c.denominator!).toBeGreaterThanOrEqual(k);
          expect(c.numerator === 0 || c.numerator >= k).toBe(true);
          const rest = c.denominator! - c.numerator;
          expect(rest === 0 || rest >= k).toBe(true);
          // a shown step cell implies a shown inquiry count for that row
          expect(x.inquiries).not.toBeNull();
        }
      }
      for (const x of r.groups) if (x.inquiries !== null) expect(x.inquiries === 0 || x.inquiries >= k).toBe(true);
    }
  });
});

describe("matcher isolation", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const read = (p: string) => readFileSync(resolve(root, p), "utf8");
  const equityExports = Object.keys(equity);
  const importedNames = (src: string, from: RegExp) =>
    [...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)]
      .filter((m) => from.test(m[2]!))
      .flatMap((m) => m[1]!.split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!))
      .filter(Boolean);

  it("core matcher does not import equity code (directly or via its relative imports)", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = read(file);
      expect(src).not.toMatch(/from\s+"\.\/equity"/);
      for (const m of src.matchAll(/from\s+"\.\/([^"]+)"/g)) visit(`packages/core/src/${m[1]}.ts`);
    };
    visit("packages/core/src/matching.ts");
    expect(seen.has("packages/core/src/equity.ts")).toBe(false);
  });

  it("db matching service (and the services it imports) use no equity symbol or module", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = read(file);
      expect(src, file).not.toMatch(/from\s+"\.\/equity"/);
      expect(importedNames(src, /^@careflow\/core$/).filter((n) => equityExports.includes(n)), file).toEqual([]);
      for (const m of src.matchAll(/from\s+"\.\/([^"]+)"/g)) visit(`packages/db/src/services/${m[1]}.ts`);
    };
    visit("packages/db/src/services/matching.ts");
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.has("packages/db/src/services/equity.ts")).toBe(false);
    expect(read("packages/db/src/services/matching.ts")).not.toMatch(/equity/i);
  });
});
