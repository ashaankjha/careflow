/**
 * Deterministic, approval-only content drafting (PRD §12). Drafts are built
 * strictly from verified records; a claim validator flags anything that
 * cannot be traced to those records. Nothing here sends or publishes.
 */
import type { DraftKind, EvidenceItem } from "./missions";
import { SERVICE_MODE_LABELS, type ServiceMode } from "./schemas";

export type VerifiedFacts = {
  orgName: string;
  center: {
    name: string;
    addressLine: string;
    city: string;
    state: string;
    zip: string;
    serviceModes: ServiceMode[];
    serviceRadiusMiles: number;
    acceptedAgeMin: number | null;
    acceptedAgeMax: number | null;
    intakePhone: string;
    intakeEmail: string;
  };
  verifiedPayers: { name: string; lastVerifiedAt: string }[];
  /** Payers whose participation is unknown or not accepted at this site — must never be listed as accepted. */
  otherPayers: string[];
  verifiedHoursAvailable: number | null;
  capacityVerifiedAt: string | null;
  serviceAreaZctas: string[];
  referralCode?: string | null;
  partnerName?: string | null;
  mission?: {
    title: string;
    explanation: string;
    proposedAction: string;
    guardrail: string;
    evidence: EvidenceItem[];
    experiment?: { hypothesis: string; primaryMetric: string; guardrails: string[] } | null;
  } | null;
};

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "not verified");
const modes = (f: VerifiedFacts) => f.center.serviceModes.map((m) => SERVICE_MODE_LABELS[m]).join(", ");
const ages = (f: VerifiedFacts) =>
  f.center.acceptedAgeMin != null || f.center.acceptedAgeMax != null
    ? `Practice policy: ages ${f.center.acceptedAgeMin ?? "—"}–${f.center.acceptedAgeMax ?? "—"} (confirm with intake).`
    : "";
const payerList = (f: VerifiedFacts) =>
  f.verifiedPayers.length
    ? f.verifiedPayers.map((p) => `- ${p.name} — participation verified by staff on ${dateOnly(p.lastVerifiedAt)}`).join("\n")
    : "- No payer participation is currently verified for this location. Please contact intake.";

const PAYER_CAVEAT =
  "Plan participation is listed as recorded by our staff and is **subject to verification**. It does not confirm any individual family's coverage, benefits, or authorization.";

export function renderDraft(kind: DraftKind, f: VerifiedFacts): { title: string; bodyMd: string } {
  const c = f.center;
  switch (kind) {
    case "seo_page":
      return {
        title: `${c.name} — ABA therapy services in ${c.city}`,
        bodyMd: `# ${c.name}

${f.orgName} provides applied behavior analysis (ABA) services at ${c.name}, ${c.addressLine}, ${c.city}, ${c.state} ${c.zip}.

## Services offered at this location
- Service modes: ${modes(f)}
- Operational service area: approximately ${c.serviceRadiusMiles} miles from the center
${ages(f) ? `- ${ages(f)}\n` : ""}
## Insurance plans
${payerList(f)}

${PAYER_CAVEAT}

## How the inquiry process works
1. Contact our intake team by phone or the clinic's interest form.
2. An intake coordinator follows up to learn about scheduling preferences and insurance.
3. Our staff verify benefits and any required authorization with your plan.
4. If services are a fit, the clinical team coordinates an assessment.

Timeframes vary by plan and staffing; our team will explain next steps directly.

## Frequently asked questions
**Do I need a referral?** Requirements depend on your plan. Our intake team can explain what your plan typically asks for.

**Can I tour the center?** Ask our intake coordinator about visiting options.

**What should I avoid sending by email?** Please do not email medical records or insurance cards. Intake will share a secure method.

## Contact
- Intake phone: ${c.intakePhone}
- Intake email: ${c.intakeEmail}

<!-- schema.org (factual fields only) -->
\`\`\`json
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: c.name,
    address: { "@type": "PostalAddress", streetAddress: c.addressLine, addressLocality: c.city, addressRegion: c.state, postalCode: c.zip },
    telephone: c.intakePhone,
  },
  null,
  2,
)}
\`\`\`
`,
      };
    case "partner_packet":
      return {
        title: `Professional referral information — ${c.name}`,
        bodyMd: `# Referral information for professional partners
**${f.orgName} · ${c.name}**
${c.addressLine}, ${c.city}, ${c.state} ${c.zip}

## Service area
We serve families within approximately ${c.serviceRadiusMiles} miles of the center (service-area ZCTAs: ${f.serviceAreaZctas.join(", ") || "on request"}).

## Services at this location
- ${modes(f)}
${ages(f) ? `- ${ages(f)}\n` : ""}
## Insurance plans
${payerList(f)}

${PAYER_CAVEAT}

## How to refer
- Share our intake contact with the family, or have the family contact us directly.
- **Do not send diagnoses, records, or insurance details by regular email or fax cover notes.** Our intake team will provide a secure channel.
${f.referralCode ? `- Optional: families may mention referral code **${f.referralCode}** so we can count referrals in aggregate. We never share an individual family's status with referring partners.\n` : ""}
## What happens next
Our intake team contacts the family, reviews scheduling preferences, and our staff verify benefits and any required authorization. We do not quote wait times or promise start dates in advance.

## Intake contact
- Phone: ${c.intakePhone}
- Email: ${c.intakeEmail}

_We do not offer gifts, payments, or anything of value for referrals._
`,
      };
    case "referral_email":
      return {
        title: `Draft introduction email — ${c.name}`,
        bodyMd: `**Subject:** Referral information for ${c.name}

Hello${f.partnerName ? ` ${f.partnerName} team` : ""},

I'm reaching out from ${f.orgName} to share up-to-date information about ABA services at ${c.name} (${c.city}, ${c.state}). We'd welcome the chance to be a resource for families you work with.

- Services: ${modes(f)}
- Service area: about ${c.serviceRadiusMiles} miles around the center
- Plans with staff-verified participation: ${f.verifiedPayers.map((p) => p.name).join(", ") || "please contact intake"} (subject to verification of each family's benefits)

Our one-page referral sheet is attached for your reference. Please don't include patient details in email; families can contact our intake team directly at ${c.intakePhone}.

Thank you,
[Staff name], ${f.orgName}

_DRAFT — requires human review. Sending is disabled in this demo._
`,
      };
    case "internal_plan": {
      const m = f.mission;
      return {
        title: `Internal growth plan — ${m?.title ?? c.name}`,
        bodyMd: `# Internal plan: ${m?.title ?? c.name}

## Evidence (from saved metrics)
${(m?.evidence ?? []).map((e) => `- **${e.label}**: ${e.numerator}${e.denominator != null ? ` / ${e.denominator}` : ""} (${e.timeRange}; metric \`${e.metricKey}\`)`).join("\n") || "- No evidence attached"}

## Explanation
${m?.explanation ?? ""}

## Proposed action
${m?.proposedAction ?? ""}

## Guardrail
${m?.guardrail ?? ""}

## Measurement
- Hypothesis: ${m?.experiment?.hypothesis ?? "—"}
- Primary metric: \`${m?.experiment?.primaryMetric ?? "—"}\` on the CareFlow dashboard
- Guardrails: ${(m?.experiment?.guardrails ?? []).map((g) => `\`${g}\``).join(", ") || "—"}

## Review checklist
- [ ] Operations confirmed current verified capacity (${f.verifiedHoursAvailable ?? "unverified"} direct h/wk as of ${dateOnly(f.capacityVerifiedAt)})
- [ ] Payer details verified within policy
- [ ] No family-level data used or shared
- [ ] Owner and review date assigned

## Halt conditions
- Verified capacity drops below the mission threshold
- Median first response time worsens beyond SLA
- Close-without-resolution rate increases
`,
      };
    }
  }
}

export type ValidationIssue = { severity: "error" | "warning"; message: string; excerpt?: string };
export type ValidationResult = { status: "pass" | "needs_review"; issues: ValidationIssue[] };

const BANNED: [RegExp, string][] = [
  [/\bguarantee[ds]?\b/i, "Outcome or access guarantees are not allowed"],
  [/\bcure[sd]?\b/i, "Cure claims are not allowed"],
  [/\bno wait(ing)?\s?list\b|\bno wait\b/i, "Wait-time claims are not verified"],
  [/\b(immediate|instant)\s+(openings?|availability|start)\b|\bopenings? (today|now)\b|\bstart (this|next) week\b/i, "Availability/timeframe promises are not allowed"],
  [/\b(gift card|referral fee|per referral|commission|reward|incentive)\b/i, "Referral remuneration language is not allowed"],
  [/\btestimonial\b|\b5[- ]star\b|\b#1\b|\bbest (aba|provider|center)\b/i, "Testimonials/superlatives are not verifiable"],
  [/\b(diagnos(e|is)|treat(s|ment)? autism|recover(y|ed))\b/i, "Medical/clinical claims require clinical review"],
];

/** Validate every payer, location, capacity and timeframe claim against verified records. */
export function validateDraft(bodyMd: string, f: VerifiedFacts): ValidationResult {
  const issues: ValidationIssue[] = [];
  const text = bodyMd.replace(/```[\s\S]*?```/g, ""); // structured data block checked separately
  for (const [re, msg] of BANNED) {
    const m = text.match(re);
    if (m) issues.push({ severity: "error", message: msg, excerpt: m[0] });
  }
  for (const name of f.otherPayers) {
    if (name && text.toLowerCase().includes(name.toLowerCase())) {
      issues.push({ severity: "error", message: `"${name}" is not verified as accepted at this site`, excerpt: name });
    }
  }
  const zips = new Set([f.center.zip, ...f.serviceAreaZctas]);
  for (const m of text.matchAll(/\b\d{5}\b/g)) {
    if (!zips.has(m[0])) issues.push({ severity: "warning", message: `ZIP/ZCTA ${m[0]} is not in the verified service area`, excerpt: m[0] });
  }
  for (const m of text.matchAll(/\b(?:within|in)\s+\d+\s+(?:business\s+)?(?:days?|weeks?|hours?)\b/gi)) {
    issues.push({ severity: "error", message: "Timeframe claim cannot be verified", excerpt: m[0] });
  }
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:open|available)\s+(?:hours|slots|spots)\b/gi)) {
    issues.push({ severity: "error", message: "Capacity claims must not be published externally", excerpt: m[0] });
  }
  if (!f.verifiedPayers.length && /verified by staff/i.test(text)) {
    issues.push({ severity: "error", message: "Payer verification claimed but none on record" });
  }
  return { status: issues.some((i) => i.severity === "error") || issues.length ? "needs_review" : "pass", issues };
}
