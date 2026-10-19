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
| Randomized, adequate N and window | **Intention-to-treat estimate** | Absolute and relative difference with Newcombe (Wilson-based) 95% interval |

Additional caveats are always attached: simulated data, and for partner/site-week randomization the note that intervals ignore clustering (they are optimistic).

### Supported outcome definitions

* Partner-randomized: denominator = inquiries with codes from partners in the arm since start; success = verified start.
* Site-level before/after (`care_starts`): inquiries created at the site in the baseline window vs since start; success = verified start.
* `response_within_sla_rate`: inquiries answered or overdue; success = first outreach within SLA.
* `benefits_verified_within_threshold`: inquiries entering `benefits_pending`; success = `benefits_verified` within the stall threshold.

## Guardrails

Shown for every experiment (site-level, baseline vs since start): inquiry volume, median hours to first contact, and close-without-resolution count. Optional equity audit (access-rate differences across payer groups) is aggregate-only and **never** used for scoring or exclusion; small cells must be suppressed (Phase 2).

## Seeded examples (labelled SIMULATED)

* *South benefits checklist pilot* — observational before/after; reported as descriptive only.
* *Referral info sheet format (partner-randomized)* — 50/50 HMAC assignment across active partners with contact permission; currently **insufficient evidence** (low N, censoring).

## Phase 2

Geo holdouts, interrupted time series / difference-in-differences with validity checks, cluster-robust intervals, Bayesian hierarchical funnel models, and bandits limited to low-risk material variants — see `agent-decisions.md`.
