# Data sources

The demo ships **synthetic** values for a **fictional** study area (“Harbor Bay”, placed over open water) using ZCTA-like codes `00101`–`00112`, which the Census Bureau does not assign. Every snapshot carries `demo_fixture`, status, vintage, checksum and warnings; the UI badges synthetic data everywhere.

| Priority | Source | Use | Link | Terms | Status in MVP |
|---|---|---|---|---|---|
| 1 | US Census ACS 2024 5-year, table B01001 | Children 0–14 per ZCTA = `B01001_003E + _004E + _005E + _027E + _028E + _029E` | https://www.census.gov/data/developers/data-sets/acs-5year/2024.html · https://api.census.gov/data/2024/acs/acs5/examples.html | Public domain; attribution (“uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau”) | Optional live fetch with `CENSUS_API_KEY` + `ACS_ZCTAS` (stored as provenance rows); synthetic fixture for the map |
| 2 | CMS NPPES | Public provider-listing density proxy | https://download.cms.gov/nppes/NPI_Files.html · https://npiregistry.cms.hhs.gov/ | CMS public data | Synthetic prefiltered fixture; live ingestion is Phase 2 |
| 3 | IDEA Section 618 | Optional regional context only | https://www.ed.gov/data/idea-section-618-data | Public | Not ingested (documented only) |
| 4 | Internal inquiries | First-party aggregate per ZCTA | CareFlow event log | Tenant-scoped | Live; cells < 5 suppressed |
| 5 | Payer directories | — | — | — | Not used. Network listing ≠ accepting patients ≠ any family’s coverage |

## Geographic definitions and caveats

* **ZCTA ≠ ZIP code.** ZCTAs approximate USPS delivery areas; the matcher maps a family’s service ZIP to the configured ZCTA centroid and labels distance as a great-circle approximation. Unknown ZIPs → `verification_needed`.
* ACS 5-year estimates are **period estimates** with margins of error (MOE displayed). Suppressed cells use large negative sentinels (e.g. `-666666666`); the adapter treats them as missing and warns when a sum is a lower bound.
* **Listing count is not supply.** It does not measure clinical staffing, openings, licensure, payer enrollment or ABA capacity.
* **No prevalence multiplication.** CareFlow never multiplies CDC ADDM prevalence by child counts to claim “demand”; ADDM sites are not nationally representative and diagnosis ≠ ABA preference or suitability.

## Opportunity heuristic

`score = 100 × (0.45·P + 0.25·L + 0.30·F)` over ranked ZCTAs, where P = child-population percentile, L = inverse listings-per-1k percentile, F = verified site fit (verified h/wk of sites whose radius covers the ZCTA, saturating at 20 h). Missing components re-normalize the remaining weights and report a **range** (missing component at 0 vs 1) with low confidence — never an artificial zero. ZCTAs below the minimum child population (default 500) are not ranked. No protected demographic fields are used; results rank *places to research*, never individuals.

## Refresh cadence & stale-data rules

| Source | Cadence | Stale rule |
|---|---|---|
| ACS 5-year | Annual (December release) | Warn when vintage is more than one release behind |
| NPPES | Monthly file | Warn when older than 60 days (Phase 2) |
| Internal aggregates | Every refresh / mission generation | Recomputed on demand |
| Payer participation (staff) | Per tenant policy, default 180 days | Older → matcher `verification_needed` |
| Staff capacity (staff) | Per tenant policy, default 30 days | Older → hours counted as *pending*, not verified |

Refreshes are admin-only (`POST /market/refresh` or `pnpm jobs refresh-market`), use hard timeouts and bounded exponential backoff, and write a `source_snapshots` row whether they succeed, are skipped (no key) or fail. A failed refresh never alters seeded data (tested).
