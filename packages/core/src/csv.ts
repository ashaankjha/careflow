/**
 * Demo CSV import (PRD §14). Pure parse + validate with line-specific errors.
 * Persistence (idempotent on organization/source/external_id) happens in the db layer.
 */
import { describeFinding, isDemoAlias, scanForSuspiciousPii } from "./pii";
import { SERVICE_MODES, SOURCE_CHANNELS, type ServiceMode, type SourceChannel } from "./schemas";
import { ALL_STAGES, type Stage } from "./stages";

export const CSV_COLUMNS = [
  "external_id",
  "created_at",
  "contact_alias",
  "service_zip",
  "payer_name",
  "preferred_mode",
  "preferred_day",
  "start_local",
  "end_local",
  "source_channel",
  "referral_code",
  "current_stage",
] as const;

export const CSV_TEMPLATE = `${CSV_COLUMNS.join(",")}
demo-1001,2026-10-01T16:30:00Z,Demo Family 1001,00104,Meridian Medicaid Plan (DEMO),center,1,15:00,18:00,website_form,,new
demo-1002,2026-10-02T18:05:00Z,Demo Family 1002,00107,Cascade Commercial (DEMO),home,3,09:00,12:00,professional_referral,BAYPEDS,new
`;

export type CsvRow = {
  line: number;
  externalId: string;
  createdAt: Date;
  contactAlias: string;
  serviceZip: string;
  payerName: string | null;
  preferredMode: ServiceMode;
  window: { dayOfWeek: number; startMinute: number; endMinute: number } | null;
  sourceChannel: SourceChannel;
  referralCode: string | null;
  currentStage: Stage;
};

export type CsvError = { line: number; column?: string; message: string };

/** Minimal RFC-4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function parseHm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}

export function validateCsv(text: string, opts: { now: Date; maxRows?: number }): { rows: CsvRow[]; errors: CsvError[] } {
  const errors: CsvError[] = [];
  const rows: CsvRow[] = [];
  const table = parseCsv(text);
  if (table.length === 0) return { rows, errors: [{ line: 1, message: "File is empty" }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { rows, errors: [{ line: 1, message: `Missing columns: ${missing.join(", ")}` }] };
  const idx = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof CSV_COLUMNS)[number], number>;
  const maxRows = opts.maxRows ?? 500;
  if (table.length - 1 > maxRows) errors.push({ line: 1, message: `Too many rows (max ${maxRows} in demo mode)` });
  const seen = new Set<string>();

  table.slice(1, maxRows + 1).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: (typeof CSV_COLUMNS)[number]) => (cells[idx[c]] ?? "").trim();
    const rowErrors: CsvError[] = [];
    const externalId = get("external_id");
    if (!/^[\w.-]{1,64}$/.test(externalId)) rowErrors.push({ line, column: "external_id", message: "Required; letters, digits, . _ - only" });
    if (seen.has(externalId)) rowErrors.push({ line, column: "external_id", message: "Duplicate external_id in file" });
    seen.add(externalId);

    const createdAt = new Date(get("created_at"));
    if (Number.isNaN(createdAt.getTime())) rowErrors.push({ line, column: "created_at", message: "Invalid ISO timestamp" });
    else if (createdAt.getTime() > opts.now.getTime() + 60_000)
      rowErrors.push({ line, column: "created_at", message: "Timestamp is in the future" });

    const alias = get("contact_alias");
    if (!isDemoAlias(alias)) rowErrors.push({ line, column: "contact_alias", message: describeFinding({ field: "contact_alias", kind: "alias_format" }) });
    for (const f of scanForSuspiciousPii({ contact_alias: alias, referral_code: get("referral_code"), payer_name: get("payer_name") })) {
      rowErrors.push({ line, column: f.field, message: `Rejected: ${describeFinding(f)}` });
    }

    const zip = get("service_zip");
    if (!/^\d{5}$/.test(zip)) rowErrors.push({ line, column: "service_zip", message: "5-digit ZIP/ZCTA required" });
    const mode = get("preferred_mode") as ServiceMode;
    if (!SERVICE_MODES.includes(mode)) rowErrors.push({ line, column: "preferred_mode", message: `One of ${SERVICE_MODES.join("|")}` });
    const source = get("source_channel") as SourceChannel;
    if (!SOURCE_CHANNELS.includes(source)) rowErrors.push({ line, column: "source_channel", message: `One of ${SOURCE_CHANNELS.join("|")}` });
    const stage = (get("current_stage") || "new") as Stage;
    if (!ALL_STAGES.includes(stage)) rowErrors.push({ line, column: "current_stage", message: "Unknown stage" });
    else if (stage !== "new")
      rowErrors.push({ line, column: "current_stage", message: "Demo import creates inquiries at 'new'; progress them with staff transitions" });

    let window: CsvRow["window"] = null;
    const day = get("preferred_day");
    if (day || get("start_local") || get("end_local")) {
      const d = Number(day);
      const s = parseHm(get("start_local"));
      const e = parseHm(get("end_local"));
      if (!Number.isInteger(d) || d < 0 || d > 6) rowErrors.push({ line, column: "preferred_day", message: "0 (Sun) – 6 (Sat)" });
      else if (s === null || e === null || e <= s) rowErrors.push({ line, column: "start_local", message: "HH:MM start before end" });
      else window = { dayOfWeek: d, startMinute: s, endMinute: e };
    }
    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    rows.push({
      line,
      externalId,
      createdAt,
      contactAlias: alias,
      serviceZip: zip,
      payerName: get("payer_name") || null,
      preferredMode: mode,
      window,
      sourceChannel: source,
      referralCode: get("referral_code") || null,
      currentStage: stage,
    });
  });
  return { rows, errors };
}
