# Experiment design and measurement integrity

## Principles

1. **Measure verified care starts**, not clicks. Secondary metrics (qualified inquiries, response within SLA, benefits turnaround) are reported with denominators.
2. **Never randomize access to care.** Every family gets the same intake and clinical process regardless of arm. Randomize only equivalent factual material, referral-material format or operationally safe workflows — preferably at the **referral-partner** or **site-week** level.
3. **Honest labels.** Designs are `observational` by default. An experiment is reported as randomized **only** if stable assignments were persisted at start; `assignment_unit = none` cannot be randomized (Zod + DB check constraint).
4. **No p-hacking.** No significance stars, no auto-stop on wins, pre-declared primary metric and guardrails.

## Assignment

`unit_hmac = HMAC-SHA256(EXPERIMENT_HMAC_SALT, experimentId + ":" + unitId)`; the first 32 bits map into cumulative allocation buckets. Assignments are persisted (`experiment_assignments`, unique per experiment+unit) when the experiment starts, so they are stable and auditable; the hash is non-reversible. Partner units store the partner (a business) reference to attribute outcomes.

## Analysis (`analyzeExperiment`)

| Situation | Verdict | What is shown |
|---|---|---|
| Any arm below configured minimum N (default 30) | **Insufficient evidence** | Counts, rates and per-arm Wilson intervals; no difference interval |
| Observation window shorter than typical inquiry→start time | **Insufficient evidence** | Censoring caveat |
| Not randomized (or randomized label without persisted assignments) | **Descriptive only — not causal** | Before/after counts and rates; confounding caveat (seasonality, staffing, payer mix); no difference interval |
| Cluster-randomized (partner / site-week) with fewer than `MIN_CLUSTERS_PER_ARM` (10) clusters with data in any arm | **Insufficient evidence** | Counts, rates, clusters per arm (assigned and with data), per-arm cluster-robust intervals; no difference interval |
| Individually randomized, adequate N and window | **Intention-to-treat estimate** | Absolute and relative difference with Newcombe (Wilson-based) 95% interval |
| Cluster-randomized, adequate N, clusters and window | **Intention-to-treat estimate** | Absolute and relative difference with a cluster-robust 95% interval (see below) and its degrees of freedom |

Additional caveats are always attached: simulated data, and for partner/site-week randomization the interval method and number of clusters.

### Cluster-aware uncertainty (partner and site-week randomization)

When the unit of randomization is a cluster (a referral partner, or a site-week), inquiries within a cluster are not independent, so per-inquiry Wilson/Newcombe intervals are too narrow. `analyzeExperiment` therefore switches to `intervalMethod = "cluster_robust"` whenever the design is randomized with persisted assignments and the unit is `partner` or `site_week`:

* **Point estimate** stays the pooled per-inquiry rate `p = Σy / Σn` in each arm (the same number shown in the table).
* **Variance** treats `p` as a ratio estimator over the `k` clusters with ≥1 observation (Taylor linearization with the `k/(k−1)` small-sample factor): `Var(p) = k/(k−1) · Σ(yᵢ − p·nᵢ)² / (Σn)²`. Clusters with no inquiries carry no information and are not counted toward `k`.
* **Per-arm interval:** `p ± t₀.₉₇₅,ₖ₋₁ · √Var(p)`. **Difference:** `(p₁ − p₂) ± t₀.₉₇₅,df · √(Var₁ + Var₂)` with the conservative `df = min(k₁, k₂) − 1`.
* **Floor:** neither interval is ever reported narrower than the unclustered Wilson / Newcombe interval on the same totals (design effect floored at 1), so homogeneous or all-zero clusters cannot look more certain than an individual-level analysis.
* **Minimum clusters:** with fewer than `MIN_CLUSTERS_PER_ARM = 10` clusters with data in any arm (documented constant in `packages/core/src/experiments.ts`; callers may pass `minClustersPerArm`), the verdict is **insufficient evidence** and no difference interval is shown, regardless of inquiry counts. Cluster-robust standard errors are unreliable below roughly that many clusters.
* The results table shows assigned clusters and clusters with data for each arm; the arm with missing cluster data never falls back to a naive interval.
* Site-week designs are analysed by assigned week: each inquiry created at the site counts toward the week (from `started_at`, 7-day buckets) whose HMAC assignment is persisted; weeks not yet reached contribute no data.

Known-answer tests (hand-computed variances, t critical values, intervals) live in `packages/core/test/experiments.test.ts`. The t quantile is computed exactly (regularized incomplete beta + bisection), not from a lookup table.

### Supported outcome definitions

* Partner-randomized: denominator = inquiries with codes from partners in the arm since start; success = verified start.
* Site-level before/after (`care_starts`): inquiries created at the site in the baseline window vs since start; success = verified start.
* `response_within_sla_rate`: inquiries answered or overdue; success = first outreach within SLA.
* `benefits_verified_within_threshold`: inquiries entering `benefits_pending`; success = `benefits_verified` within the stall threshold.

## Guardrails

Shown for every experiment (site-level, baseline vs since start): inquiry volume, median hours to first contact, and close-without-resolution count.

### Equity audit (Experiments → *Equity audit* tab)

An aggregate-only report of access-rate differences across **payer groups** (payer category recorded on the inquiry, plus *payer not recorded*): first contact within SLA, site match proposed (not an appointment), intake assessment scheduled by staff, and verified care start, each with numerator/denominator and the difference vs all groups. It is **equity audit only — never used for scoring, ranking, matching or exclusion**; the matcher and mission code do not import it (enforced by a test). Comparisons are descriptive, not causal. Small cells are suppressed using the tenant `minCellSize` with complementary suppression — see [metric definitions](metric-definitions.md#equity-audit-access-rates-by-payer-group). Restricted to admin, growth and ops roles (`equity:read`).

## Seeded examples (labelled SIMULATED)

* *South benefits checklist pilot* — observational before/after; reported as descriptive only.
* *Referral info sheet format (partner-randomized)* — 50/50 HMAC assignment across active partners with contact permission; currently **insufficient evidence** (low N, censoring).

## Phase 2

Geo holdouts, interrupted time series / difference-in-differences with validity checks, Bayesian hierarchical funnel models, and bandits limited to low-risk material variants — see `agent-decisions.md`.
