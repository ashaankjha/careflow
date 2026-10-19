# Metric definitions

All KPIs are computed on request from `inquiry_events` (immutable) and current verified capacity, in `packages/db/src/services/metrics.ts`. `daily_metrics` holds **derived snapshots** (mission evidence, `compute-daily-metrics` job) and is never a source of truth. Every KPI shares the same filters — window `[from, to)`, optional site (`inquiries.center_id`) and source channel — so numerators and denominators move together (tested in `operations.test.ts`).

Common filter fragment (`i` = inquiries):

```sql
i.organization_id = :org [AND i.center_id = :center] [AND i.source_channel = :source]
```

## care_starts

Distinct inquiries whose **first** `care_started_verified_by_staff` event falls in the window. A partial unique index already guarantees at most one per inquiry; `min()` keeps the definition robust.

```sql
SELECT count(*) FROM (
  SELECT e.inquiry_id, min(e.occurred_at) AS first_start
  FROM inquiry_events e JOIN inquiries i ON i.id = e.inquiry_id AND i.organization_id = e.organization_id
  WHERE e.organization_id = :org AND e.event_type = 'care_started_verified_by_staff' AND <filter>
  GROUP BY e.inquiry_id) s
WHERE s.first_start >= :from AND s.first_start < :to;
```

## inquiries_created

`count(*)` of inquiries with `created_at ∈ [from, to)`.

## cohort_start_rate

Creation cohort = inquiries created in the window. Numerator = cohort members with a verified start at or before the **reporting cutoff** (`min(to, now)`).

* Displayed with the cutoff and the number of cohort members younger than 45 days (`censoredYoung`) — those are right-censored and will keep converting. Do not compare a young cohort to an old one.

## median_first_response_hours

Among cohort inquiries with at least one `outreach_attempted`, the median of `first_outreach − created_at` (hours, `percentile_cont(0.5)`).

* Shown alongside: unanswered count, and **within-SLA share** = answered within SLA / (answered + unanswered older than the SLA). Young unanswered inquiries still inside the SLA are excluded from that denominator rather than counted as misses.

## median_days_to_start

Median days from `created_at` to first verified start, among inquiries whose first start is in the window; `n` is always displayed.

## stage_conversion (funnel)

For the creation cohort, distinct inquiries that ever reached each funnel stage (any event with that `next_stage`; `new` = all). Conversion = reached(next) / reached(stage). Exit states (waitlist/close) are not counted as “reached”.

Mission M5 uses a fixed **14-day horizon** conversion (entered stage → advanced within 14 days) for two cohorts (entered 14–44 days ago vs 44–90 days ago) so recent and baseline cohorts get equal observation time.

## stall_rate / unresolved stalls

Snapshot as of now: active inquiries (pre-start stages) whose `now − stage_entered_at` exceeds the per-stage threshold from tenant policy (defaults: new 2 d, contacted 5, qualified 7, benefits_pending 10, benefits_verified 7, assessment_pending 14, authorization_pending 21, ready_to_start 10). Reported as stalled / active, per stage and site.

## capacity_fit_rate

Numerator: cohort inquiries for which the matcher returns at least one `potential_fit` against the **current** verified capacity snapshot. Denominator: cohort inquiries with the required inputs (ZIP in the study area, payer recorded, ≥1 mode, ≥1 time window). Missing-input inquiries are reported separately (`missingInputs`), never silently dropped.

* Bias: evaluated against today’s capacity, not the capacity at inquiry time (capacity history is not versioned in the MVP).

## verified_weekly_direct_hours_available

Per site: `floor(min(verified RBT hours − proposed/reserved hold hours, (verified BCBA hours − BCBA hold hours) / r))`, where `r` is the verified site supervision ratio; `0` if `starts in last 7 days + active holds ≥ max_new_starts_per_week`; `null` (“unverified”) if no verified supervision rule exists. Windows are “verified” only if `verified_at` is within `capacityVerificationMaxAgeDays` (default 30). Unverified/stale hours are shown separately as *pending*.

## referral_source_attribution

Inquiries (and how many have a verified start) grouped by first-party referral code recorded at creation, plus an explicit **Unattributed** bucket (no code or unrecognized code) and a per-channel breakdown. Single-touch, first-party only — not multi-touch or incremental attribution.

## Equity audit: access rates by payer group

*Equity audit only — never used for scoring, ranking, matching or exclusion.* Computed in `packages/db/src/services/equity.ts` (SQL aggregation) and `packages/core/src/equity.ts` (rates + suppression). Descriptive, not causal.

* **Cohort:** inquiries created in `[now − days, now)` (default 90), optional site filter. Outcomes are counted up to the report time, so recent inquiries are right-censored.
* **Group:** `payers.category` of the inquiry's recorded payer; inquiries without a payer form *Payer not recorded*. Payer listings are not verified benefits.
* **Steps** (numerator / denominator):
  * `contact_within_sla` — first `outreach_attempted` within `firstResponseSlaHours` / inquiries answered or older than the SLA (same rule as `median_first_response_hours`).
  * `match_proposed` — a `center_match_selected` event or a current `proposed`/`reserved` capacity hold / cohort inquiries. A proposed match is **not** an appointment.
  * `assessment_scheduled` — an `assessment_scheduled_by_staff` event / cohort inquiries.
  * `care_started` — a `care_started_verified_by_staff` event / cohort inquiries.
* **Difference vs overall:** group rate − all-groups rate (proportion points); shown only when both are unsuppressed.
* **Small-cell suppression** (tenant `minCellSize`, default 5 = `k`):
  * primary — a group's inquiry count in `1..k−1`; a step cell whose denominator is `< k`, or whose numerator **or** complement (denominator − numerator) is in `1..k−1`; any step cell of a row whose inquiry count is hidden; and the overall cell under the same rules;
  * complementary — per additive column (inquiry counts, each step's numerators, each step's denominators): if exactly one group value is hidden while the total is shown, the smallest remaining group value is hidden too (ties by position); if no group is left, the total is hidden;
  * a cell's numerator, denominator, rate and difference are shown together or not at all. Zero counts are shown.
* **Limits:** suppression is per report; differencing two reports (e.g. two sites, two windows) is not prevented — see security gate R11.

## Known biases and caveats

* **Right censoring** — recent cohorts have had less time to start; typical inquiry-to-start in the seed is ~38 days.
* **Current-capacity evaluation** of historical cohorts (see capacity_fit_rate).
* **Small numbers** — per-site, per-week numbers are small; the UI shows denominators everywhere and experiments refuse intervals below the configured minimum N.
* **Synthetic data** — all values in the demo come from a deterministic simulator and are labelled synthetic.
* **Time zones** — timestamps are stored in UTC; weekly buckets use the organization’s time zone.
