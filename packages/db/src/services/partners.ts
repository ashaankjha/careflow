import { describeFinding, scanForSuspiciousPii } from "@careflow/core";
import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Executor } from "../client";
import { referralCodes, referralPartners } from "../schema";
import { audit } from "./audit";
import { AppError, assertCan, nowOf, type Ctx } from "./context";

export const PARTNER_CATEGORIES = [
  "pediatrics",
  "developmental_pediatrics",
  "speech_therapy",
  "occupational_therapy",
  "child_psychology",
  "family_medicine",
  "family_resource_center",
  "early_intervention",
  "other",
] as const;

export const createPartnerSchema = z.object({
  businessName: z.string().trim().min(3).max(120),
  category: z.enum(PARTNER_CATEGORIES),
  publicContactName: z.string().trim().max(80).nullable().optional(),
  publicContactEmail: z.string().trim().email().max(120).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  zcta5: z.string().regex(/^\d{5}$/).nullable().optional(),
  relationshipStatus: z.enum(["prospect", "active", "paused"]).default("prospect"),
  contactPermissionStatus: z.enum(["not_requested", "granted", "declined"]).default("not_requested"),
});

export async function listPartners(db: Executor, ctx: Ctx) {
  assertCan(ctx, "partner:read");
  const partners = await db.select().from(referralPartners).where(eq(referralPartners.organizationId, ctx.orgId)).orderBy(asc(referralPartners.businessName));
  const codes = await db.select().from(referralCodes).where(eq(referralCodes.organizationId, ctx.orgId));
  // Aggregate attribution only — never a specific family's status.
  const agg = (await db.execute(sql`
    select rc.partner_id, count(*)::int as inquiries,
      count(*) filter (where exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'care_started_verified_by_staff'))::int as starts
    from inquiries i join referral_codes rc on rc.id = i.referral_code_id and rc.organization_id = i.organization_id
    where i.organization_id = ${ctx.orgId} and i.created_at >= ${new Date(nowOf(ctx).getTime() - 90 * 86_400_000)}
    group by rc.partner_id`)) as unknown as { partner_id: string; inquiries: number; starts: number }[];
  return partners.map((p) => {
    const a = agg.find((x) => x.partner_id === p.id);
    return {
      ...p,
      codes: codes.filter((c) => c.partnerId === p.id),
      inquiries90d: Number(a?.inquiries ?? 0),
      starts90d: Number(a?.starts ?? 0),
    };
  });
}

export async function createPartner(db: Db, ctx: Ctx, input: z.input<typeof createPartnerSchema>) {
  assertCan(ctx, "partner:manage");
  const data = createPartnerSchema.parse(input);
  // Professional business listings only: block clinical/family details in free text.
  const findings = scanForSuspiciousPii({ businessName: data.businessName, location: data.location ?? null }).filter((f) => f.kind !== "address");
  if (findings.length) throw new AppError("VALIDATION_FAILED", findings.map(describeFinding).join("; "));
  const [p] = await db
    .insert(referralPartners)
    .values({ ...data, organizationId: ctx.orgId, lastReviewedAt: nowOf(ctx), demoFixture: false })
    .returning();
  await audit(db, ctx, "partner.create", "referral_partner", p!.id, true, { category: data.category });
  return p!;
}

export async function createReferralCode(db: Db, ctx: Ctx, partnerId: string, opts: { centerId?: string | null } = {}) {
  assertCan(ctx, "partner:manage");
  const [p] = await db.select().from(referralPartners).where(and(eq(referralPartners.organizationId, ctx.orgId), eq(referralPartners.id, partnerId)));
  if (!p) throw new AppError("NOT_FOUND", "Partner not found");
  const prefix = p.businessName.replace(/\(DEMO\)/g, "").replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase() || "REF";
  for (let i = 0; i < 5; i++) {
    const code = `${prefix}${randomBytes(2).toString("hex").toUpperCase()}`;
    const res = await db
      .insert(referralCodes)
      .values({ organizationId: ctx.orgId, code, partnerId, centerId: opts.centerId ?? null, status: "active", validFrom: nowOf(ctx) })
      .onConflictDoNothing()
      .returning();
    if (res[0]) {
      await audit(db, ctx, "referral_code.create", "referral_code", res[0].id, true, { partnerId });
      return res[0];
    }
  }
  throw new AppError("CONFLICT", "Could not allocate a unique code");
}
