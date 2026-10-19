import { safeRate } from "./stats";

/**
 * Equity audit (PRD §11 guardrail): aggregate-only, descriptive access-rate
 * differences across payer groups. This module is deliberately isolated — it
 * is never imported by the matcher, missions, scoring or ranking code, and its
 * output is never used to score, rank, match or exclude anyone.
 */
export const EQUITY_AUDIT_NOTICE =
  "Equity audit only — never used for scoring, ranking, matching or exclusion. Descriptive, aggregate counts; differences are not causal and do not explain why groups differ.";

export const EQUITY_STEPS = [
  {
    key: "contact_within_sla",
    label: "First contact within SLA",
    denominatorLabel: "inquiries answered or past the SLA",
  },
  {
    key: "match_proposed",
    label: "Site match proposed (not an appointment)",
    denominatorLabel: "inquiries",
  },
  {
    key: "assessment_scheduled",
    label: "Intake assessment scheduled by staff",
    denominatorLabel: "inquiries",
  },
  {
    key: "care_started",
    label: "Verified care start",
    denominatorLabel: "inquiries",
  },
] as const;
export type EquityStepKey = (typeof EQUITY_STEPS)[number]["key"];

export type EquityGroupInput = {
  key: string;
  label: string;
  inquiries: number;
  steps: Record<EquityStepKey, { numerator: number; denominator: number }>;
};

export type Suppression = "primary" | "complementary" | null;

export type EquityCell = {
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  /** group rate − overall rate (proportion points); null when either is suppressed. */
  differenceVsOverall: number | null;
  suppressed: Suppression;
};

export type EquityRow = {
  key: string;
  label: string;
  inquiries: number | null;
  inquiriesSuppressed: Suppression;
  steps: Record<EquityStepKey, EquityCell>;
};

export type EquityReport = {
  notice: string;
  minCellSize: number;
  overall: EquityRow;
  groups: EquityRow[];
  suppressedCells: number;
};

/** A count discloses a small group when it is between 1 and k − 1 (zero is not suppressed). */
const isSmall = (v: number, k: number) => v > 0 && v < k;

/**
 * Complementary suppression over one additive column (group values that sum
 * to a total). Starts from the primary flags; if a hidden value could be
 * recovered by subtraction (exactly one hidden group while the total is
 * shown), also hides the smallest remaining shown group value, or the total
 * when no group is left. Deterministic: ties break by position.
 */
export function suppressColumn(
  values: number[],
  groupPrimary: boolean[],
  totalPrimary: boolean,
): { groups: Suppression[]; total: Suppression } {
  const groups: Suppression[] = values.map((_, i) => (groupPrimary[i] ? "primary" : null));
  let total: Suppression = totalPrimary ? "primary" : null;
  if (total === null && groups.filter((g) => g !== null).length === 1) {
    const candidates = values
      .map((v, i) => ({ v, i }))
      .filter(({ i }) => groups[i] === null)
      .sort((a, b) => a.v - b.v || a.i - b.i);
    if (candidates.length > 0) groups[candidates[0]!.i] = "complementary";
    else total = "complementary";
  }
  return { groups, total };
}

const merge = (...flags: Suppression[]): Suppression =>
  flags.includes("primary") ? "primary" : flags.includes("complementary") ? "complementary" : null;

const HIDDEN: EquityCell = { numerator: null, denominator: null, rate: null, differenceVsOverall: null, suppressed: null };

/**
 * Build the aggregate equity report with small-cell suppression using the
 * tenant `minCellSize` (k):
 *  - a group's inquiry count is suppressed when it is between 1 and k − 1;
 *  - a step cell is suppressed when its denominator is below k, or its
 *    numerator — or the complement (denominator − numerator) — is between 1 and
 *    k − 1 ("all but two" discloses as much as "two");
 *  - complementary suppression runs per additive column (inquiries, each step's
 *    numerator, each step's denominator) so no hidden value equals a total
 *    minus shown values;
 *  - a row whose inquiry count is hidden has every step cell hidden (step
 *    denominators would otherwise reveal or bound it);
 *  - a cell shows numerator, denominator, rate and difference vs overall
 *    together or not at all.
 */
export function buildEquityReport(groupsIn: EquityGroupInput[], minCellSize: number): EquityReport {
  const k = Math.max(1, Math.floor(minCellSize));
  const groups = [...groupsIn].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  const totalInquiries = groups.reduce((s, g) => s + g.inquiries, 0);
  const inq = suppressColumn(
    groups.map((g) => g.inquiries),
    groups.map((g) => isSmall(g.inquiries, k)),
    isSmall(totalInquiries, k),
  );
  const cellPrimary = (n: number, d: number) => d < k || isSmall(n, k) || isSmall(d - n, k);

  const steps = EQUITY_STEPS.map(({ key }) => {
    const nums = groups.map((g) => g.steps[key].numerator);
    const dens = groups.map((g) => g.steps[key].denominator);
    const totNum = nums.reduce((s, v) => s + v, 0);
    const totDen = dens.reduce((s, v) => s + v, 0);
    const prim = groups.map((_, i) => cellPrimary(nums[i]!, dens[i]!) || inq.groups[i] !== null);
    const totPrim = cellPrimary(totNum, totDen) || inq.total !== null;
    const num = suppressColumn(nums, prim, totPrim);
    const den = suppressColumn(dens, prim, totPrim);
    const totalFlag = merge(num.total, den.total);
    const overallRate = totalFlag ? null : safeRate(totNum, totDen);
    const show = (n: number, d: number, flag: Suppression, ref: number | null): EquityCell => {
      if (flag) return { ...HIDDEN, suppressed: flag };
      const rate = safeRate(n, d);
      return { numerator: n, denominator: d, rate, differenceVsOverall: rate !== null && ref !== null ? rate - ref : null, suppressed: null };
    };
    return {
      key,
      groupCells: groups.map((_, i) => show(nums[i]!, dens[i]!, merge(num.groups[i]!, den.groups[i]!), overallRate)),
      totalCell: show(totNum, totDen, totalFlag, overallRate),
    };
  });

  const rows: EquityRow[] = groups.map((g, i) => ({
    key: g.key,
    label: g.label,
    inquiries: inq.groups[i] ? null : g.inquiries,
    inquiriesSuppressed: inq.groups[i]!,
    steps: Object.fromEntries(steps.map((s) => [s.key, s.groupCells[i]!])) as Record<EquityStepKey, EquityCell>,
  }));
  const overall: EquityRow = {
    key: "overall",
    label: "All payer groups",
    inquiries: inq.total ? null : totalInquiries,
    inquiriesSuppressed: inq.total,
    steps: Object.fromEntries(steps.map((s) => [s.key, s.totalCell])) as Record<EquityStepKey, EquityCell>,
  };
  const suppressedCells = [overall, ...rows].reduce(
    (s, r) => s + (r.inquiriesSuppressed ? 1 : 0) + Object.values(r.steps).filter((c) => c.suppressed).length,
    0,
  );
  return { notice: EQUITY_AUDIT_NOTICE, minCellSize: k, overall, groups: rows, suppressedCells };
}
