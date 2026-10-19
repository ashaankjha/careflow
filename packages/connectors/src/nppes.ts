/**
 * Public provider-listing density. The MVP ships a small synthetic,
 * pre-filtered fixture (counts keyed by ZCTA). A live NPPES download is
 * Phase 2: the monthly file is very large and taxonomy selection must be
 * audited. Listing counts are NOT clinical staffing, openings, licensure,
 * enrollment, or exact ABA supply.
 */
export const NPPES_SOURCE_URL = "https://download.cms.gov/nppes/NPI_Files.html";
export const NPPES_LICENSE_NOTE =
  "NPPES data are published by CMS for public use. Counts here are a synthetic fixture shaped like a prefiltered NPPES extract.";
export const NPPES_LIMITATION =
  "Public listing count ≠ clinical staffing, openings, licensure, payer enrollment or exact ABA supply.";
