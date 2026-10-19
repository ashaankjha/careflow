import { z } from "zod";
import { ALL_STAGES } from "./stages";

export const SERVICE_MODES = ["center", "home", "telehealth_if_applicable"] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];
export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  center: "Center-based",
  home: "In-home",
  telehealth_if_applicable: "Telehealth (if applicable)",
};

export const SOURCE_CHANNELS = [
  "website_form",
  "phone",
  "professional_referral",
  "local_search",
  "community_event",
  "other",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];
export const SOURCE_LABELS: Record<SourceChannel, string> = {
  website_form: "Website form",
  phone: "Phone",
  professional_referral: "Professional referral",
  local_search: "Local search",
  community_event: "Community event",
  other: "Other",
};

export const PAYER_STATUSES = ["verified_accepted", "not_accepted", "unknown"] as const;
export type PayerStatus = (typeof PAYER_STATUSES)[number];

export const STAFF_ROLES = ["RBT", "BCBA"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const timeWindowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })
  .refine((w) => w.endMinute > w.startMinute, { message: "endMinute must be after startMinute" });
export type TimeWindow = z.infer<typeof timeWindowSchema>;

export const stageSchema = z.enum(ALL_STAGES);

export const createInquirySchema = z.object({
  contactAlias: z.string().trim().min(3).max(60),
  serviceZip: z.string().trim().regex(/^\d{5}$/, "5-digit ZIP/ZCTA required"),
  payerId: z.string().uuid().nullable().optional(),
  preferredModes: z.array(z.enum(SERVICE_MODES)).min(1),
  preferredWindows: z.array(timeWindowSchema).max(14).default([]),
  requestedDirectHoursPerWeek: z.number().min(1).max(40).nullable().optional(),
  sourceChannel: z.enum(SOURCE_CHANNELS),
  referralCode: z.string().trim().max(32).nullable().optional(),
  centerId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(8).max(100),
  /** Must be explicitly acknowledged: demo mode accepts synthetic entries only. */
  syntheticAcknowledged: z.literal(true),
});
export type CreateInquiryInput = z.infer<typeof createInquirySchema>;

export const transitionSchema = z.object({
  toStage: stageSchema,
  reason: z.string().trim().max(280).nullable().optional(),
  eventIdempotencyKey: z.string().min(8).max(100),
  centerId: z.string().uuid().nullable().optional(),
});

export const outreachSchema = z.object({
  eventIdempotencyKey: z.string().min(8).max(100),
  note: z.string().trim().max(200).optional(),
});

export const matchRequestSchema = z.object({
  serviceZip: z.string().trim().regex(/^\d{5}$/),
  payerId: z.string().uuid().nullable().optional(),
  preferredModes: z.array(z.enum(SERVICE_MODES)).min(1),
  preferredWindows: z.array(timeWindowSchema).max(14).default([]),
  requestedDirectHoursPerWeek: z.number().min(1).max(40).nullable().optional(),
  childAgeYears: z.number().int().min(0).max(21).nullable().optional(),
});
export type MatchRequest = z.infer<typeof matchRequestSchema>;

export const capacityWindowInputSchema = z
  .object({
    role: z.enum(STAFF_ROLES),
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
    weeklyAvailableHours: z.number().min(0).max(200),
    serviceMode: z.enum(SERVICE_MODES),
  })
  .refine((w) => w.endMinute > w.startMinute, { message: "End must be after start" })
  .refine((w) => w.weeklyAvailableHours <= ((w.endMinute - w.startMinute) / 60) * 20, {
    message: "Hours exceed what 20 staff could supply in this window",
  });
export type CapacityWindowInput = z.infer<typeof capacityWindowInputSchema>;

export const capacityRuleInputSchema = z.object({
  payerId: z.string().uuid().nullable(),
  requiredBcbaHoursPerDirectHour: z.number().min(0).max(1).nullable(),
  minRbtCoverage: z.number().min(0).max(10).nullable(),
  maxNewStartsPerWeek: z.number().int().min(0).max(100).nullable(),
  isVerified: z.boolean(),
});

export const capacityUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  windows: z.array(capacityWindowInputSchema).max(80),
  rules: z.array(capacityRuleInputSchema).max(20),
  /** Saving as ops attests that the sheet was verified now. */
  attestVerified: z.boolean().default(true),
});

export const payerUpdateSchema = z.object({
  payers: z
    .array(
      z.object({
        payerId: z.string().uuid(),
        status: z.enum(PAYER_STATUSES),
        notes: z.string().trim().max(280).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

/** Detect overlapping windows for the same role/day/mode (keeps capacity summation reproducible). */
export function findOverlappingWindows(windows: CapacityWindowInput[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i]!;
      const b = windows[j]!;
      if (a.role !== b.role || a.dayOfWeek !== b.dayOfWeek || a.serviceMode !== b.serviceMode) continue;
      if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) out.push([i, j]);
    }
  }
  return out;
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function minuteToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${suffix}`;
}

export function windowLabel(w: { dayOfWeek: number; startMinute: number; endMinute: number }): string {
  return `${DAY_LABELS[w.dayOfWeek]} ${minuteToLabel(w.startMinute)}–${minuteToLabel(w.endMinute)}`;
}
