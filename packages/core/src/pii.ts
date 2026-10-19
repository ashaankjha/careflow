/**
 * Demo-mode guard: CareFlow's MVP accepts synthetic entries only. These
 * heuristics reject strings that look like real personal contact data. They
 * are a safety net, not a de-identification guarantee.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DOB = /\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b|\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const STREET = /\b\d{1,6}\s+[A-Za-z0-9.' ]+\s(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive|court|ct|way)\b/i;
const CLINICAL = /\b(diagnos\w*|autism|asd|adhd|icd-?10|f84|severity|medication|seizure)\b/i;

/** Demo aliases must follow a clearly fake pattern, e.g. "Demo Family 042" or "Test Parent Q". */
const DEMO_ALIAS = /^(demo|test|synthetic|sample)\b[\w\s#-]{0,40}$/i;

export type PiiFinding = { field: string; kind: "email" | "phone" | "ssn" | "dob" | "address" | "clinical" | "alias_format" };

export function scanForSuspiciousPii(fields: Record<string, string | null | undefined>): PiiFinding[] {
  const out: PiiFinding[] = [];
  for (const [field, raw] of Object.entries(fields)) {
    if (!raw) continue;
    const v = String(raw);
    if (EMAIL.test(v)) out.push({ field, kind: "email" });
    if (PHONE.test(v)) out.push({ field, kind: "phone" });
    if (SSN.test(v)) out.push({ field, kind: "ssn" });
    if (DOB.test(v) && field !== "created_at") out.push({ field, kind: "dob" });
    if (STREET.test(v)) out.push({ field, kind: "address" });
    if (CLINICAL.test(v)) out.push({ field, kind: "clinical" });
  }
  return out;
}

export function isDemoAlias(alias: string): boolean {
  return DEMO_ALIAS.test(alias.trim());
}

export function describeFinding(f: PiiFinding): string {
  const map: Record<PiiFinding["kind"], string> = {
    email: "looks like an email address",
    phone: "looks like a phone number",
    ssn: "looks like a government identifier",
    dob: "looks like a date of birth",
    address: "looks like a street address",
    clinical: "contains clinical/diagnostic terms (not collected in CareFlow)",
    alias_format: 'must be a clearly fake demo alias, e.g. "Demo Family 042"',
  };
  return `${f.field} ${map[f.kind]}`;
}
