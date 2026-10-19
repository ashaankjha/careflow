# Metric definitions

All KPIs are computed on request from `inquiry_events` (immutable) and verified capacity (current, or the capacity version in force at inquiry time for capacity-fit), in `packages/db/src/services/metrics.ts`. `daily_metrics` holds **derived snapshots** (mission evidence, `compute-daily-metrics` job) and is never a source of truth. Every KPI shares the same filters — window `[from, to)`, optional site (`inquiries.center_id`) and source channel — so numerators and denominators move together (tested in `operations.test.ts`).

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

Numerator: cohort inquiries for which the matcher returns at least one `potential_fit` **as of the inquiry's `created_at`**. Denominator: cohort inquiries with the required inputs (ZIP in the study area, payer recorded, ≥1 mode, ≥1 time window). Missing-input inquiries are reported separately (`missingInputs`), never silently dropped.

As-of semantics (`asOf: "inquiry_created_at"` in the API response):

* **Capacity sheet** — the `capacity_versions` row whose `[valid_from, valid_to)` contains `created_at`, with its `staff_capacity_window_versions` rows and rules snapshot. Every capacity save appends a version (and closes the previous one), so editing capacity today never rewrites a past cohort's fit (tested in `capacity-history.test.ts`).
* **Verification freshness** — a window counts as verified if its recorded `verified_at` was within `capacityVerificationMaxAgeDays` *at `created_at`*.
* **Holds** — holds whose `created_at ≤ t < min(released_at, expires_at)` subtract hours and count against the weekly new-start limit.
* **Weekly new starts** — verified starts in `(t − 7 d, t]`.
* Not versioned (applied as currently recorded): payer participation status (verification time capped at `t`), site profile (radius, modes, age policy) and the onboarding backlog (affects the score only, never eligibility). The current tenant policy is used.
* A site with no capacity version in force at `t` is evaluated with no recorded capacity (verification needed); the count of such inquiries is reported as `withoutCapacityVersion`. The seed backfills a version history (ops re-attesting the same sheet every 28 days) that covers every seeded inquiry, so the seeded numbers equal the previous current-capacity evaluation.

## verified_weekly_direct_hours_available

Current snapshot (not as-of). Per site: `floor(min(verified RBT hours − proposed/reserved hold hours, (verified BCBA hours − BCBA hold hours) / r))`, where `r` is the verified site supervision ratio; `0` if `starts in last 7 days + active holds ≥ max_new_starts_per_week`; `null` (“unverified”) if no verified supervision rule exists. Windows are “verified” only if `verified_at` is within `capacityVerificationMaxAgeDays` (default 30). Unverified/stale hours are shown separately as *pending*. Released holds and holds past `expires_at` never subtract (lazy expiry at read time).

## referral_source_attribution

Inquiries (and how many have a verified start) grouped by first-party referral code recorded at creation, plus an explicit **Unattributed** bucket (no code or unrecognized code) and a per-channel breakdown. Single-touch, first-party only — not multi-touch or incremental attribution.

## Known biases and caveats

* **Right censoring** — recent cohorts have had less time to start; typical inquiry-to-start in the seed is ~38 days.
* **Partially versioned history** — capacity-fit uses the capacity version in force at inquiry time, but payer participation and site profile are applied as currently recorded (see capacity_fit_rate).
* **Small numbers** — per-site, per-week numbers are small; the UI shows denominators everywhere and experiments refuse intervals below the configured minimum N.
* **Synthetic data** — all values in the demo come from a deterministic simulator and are labelled synthetic.
* **Time zones** — timestamps are stored in UTC; weekly buckets use the organization’s time zone.
