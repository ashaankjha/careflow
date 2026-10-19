/**
 * Deterministic synthetic intake simulation. Produces ~150 inquiries with
 * coherent, time-ordered administrative event histories so every dashboard
 * KPI is computed from the event log (nothing is hard-coded).
 */
import { createRng, eventTypeForTransition, type Stage, ACTIVE_STAGES } from "@careflow/core";
import { seedUuid } from "../ids";
import { CENTERS, PARTNERS, ZCTAS, centerId, payerId, partnerId, referralCodeId, userId } from "./fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Profile = {
  count: number;
  zctas: [string, number][];
  payers: [string | null, number][];
  modes: [string, number][];
  afternoonShare: number;
  firstResponseHours: () => number;
  benefitsDays: () => number;
  /** Probability a qualified inquiry is waitlisted for capacity reasons. */
  waitlistAtQualified: (payer: string | null, afternoon: boolean) => number;
  partnerWeight: number;
};

export type SimInquiry = {
  id: string;
  centerKey: string;
  createdAt: Date;
  contactAlias: string;
  serviceZip: string;
  payerId: string | null;
  preferredModes: string[];
  windows: { dayOfWeek: number; startMinute: number; endMinute: number }[];
  requestedHours: number | null;
  sourceChannel: string;
  referralCode: string | null;
  referralCodeId: string | null;
  partnerKey: string | null;
  intakeOwnerId: string | null;
  stage: Stage;
  stageEnteredAt: Date;
};

export type SimEvent = {
  id: string;
  inquiryId: string;
  eventType: string;
  previousStage: Stage | null;
  nextStage: Stage | null;
  occurredAt: Date;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
};

export function simulateInquiries(now: Date, seed = 20261019): { inquiries: SimInquiry[]; events: SimEvent[] } {
  const rng = createRng(seed);
  const lognormalHours = (medianH: number, spread: number) => Math.max(0.3, medianH * Math.exp((rng.next() - 0.5) * spread));

  const profiles: Record<string, Profile> = {
    north: {
      count: 60,
      zctas: [["00103", 5], ["00102", 5], ["00106", 3], ["00101", 2], ["00107", 3], ["00104", 1.5]],
      payers: [["cascade", 50], ["meridian", 25], ["pinecrest", 15], [null, 10]],
      modes: [["center", 70], ["home", 30]],
      afternoonShare: 0.8,
      firstResponseHours: () => (rng.chance(0.5) ? lognormalHours(40, 1.2) : lognormalHours(10, 1.4)),
      benefitsDays: () => rng.int(3, 8),
      waitlistAtQualified: (_p, afternoon) => (afternoon ? 0.55 : 0.1),
      partnerWeight: 1,
    },
    west: {
      count: 25,
      zctas: [["00105", 6], ["00101", 3], ["00109", 3], ["00110", 2], ["00106", 2]],
      payers: [["cascade", 45], ["meridian", 40], ["pinecrest", 5], [null, 10]],
      modes: [["center", 80], ["telehealth_if_applicable", 20]],
      afternoonShare: 0.45,
      firstResponseHours: () => lognormalHours(4, 1.2),
      benefitsDays: () => rng.int(3, 7),
      waitlistAtQualified: () => 0.05,
      partnerWeight: 0.15,
    },
    south: {
      count: 65,
      zctas: [["00111", 6], ["00110", 3], ["00112", 3], ["00107", 2], ["00106", 2], ["00109", 1]],
      payers: [["cascade", 40], ["pinecrest", 35], ["meridian", 15], [null, 10]],
      modes: [["center", 80], ["home", 20]],
      afternoonShare: 0.5,
      firstResponseHours: () => (rng.chance(0.2) ? lognormalHours(34, 0.8) : lognormalHours(8, 1.2)),
      benefitsDays: () => (rng.chance(0.85) ? rng.int(14, 40) : rng.int(5, 9)),
      waitlistAtQualified: () => 0.05,
      partnerWeight: 1,
    },
  };

  const activePartners = PARTNERS.filter((p) => p.code && p.weight > 0);
  const owners = [userId("intake"), userId("intake2"), null] as const;
  const inquiries: SimInquiry[] = [];
  const events: SimEvent[] = [];
  let aliasN = 100;

  for (const center of CENTERS) {
    const prof = profiles[center.key]!;
    for (let i = 0; i < prof.count; i++) {
      const id = seedUuid(`inquiry:harbor:${center.key}:${i}`);
      // creation: 1..90 days ago, business hours local (≈ 15:00–01:00 UTC)
      const daysAgo = rng.int(1, 90);
      const created = new Date(now.getTime() - daysAgo * DAY);
      created.setUTCHours(15 + rng.int(0, 9), rng.int(0, 59), 0, 0);
      if (created.getTime() > now.getTime() - HOUR) created.setTime(now.getTime() - 2 * HOUR - rng.int(0, 600) * 60_000);
      // A few very recent inquiries so the intake queue has uncontacted work (no extra RNG draws: keeps the story stable).
      if (i % 13 === 5) created.setTime(now.getTime() - (3 + (i % 9)) * HOUR);

      const payerKey = rng.weighted(prof.payers);
      const mode = rng.weighted(prof.modes);
      const afternoon = rng.chance(prof.afternoonShare);
      const days = [1, 2, 3, 4, 5].filter(() => rng.chance(0.6));
      if (days.length < 2) days.push(rng.chance(0.5) ? 2 : 4);
      const uniqDays = [...new Set(days)].sort();
      const windows = uniqDays.map((d) =>
        afternoon ? { dayOfWeek: d, startMinute: 15 * 60, endMinute: 18 * 60 } : { dayOfWeek: d, startMinute: 8 * 60 + 30, endMinute: 12 * 60 },
      );
      // Families never request more direct hours than their own preferred windows contain.
      const requestFor = (ws: { startMinute: number; endMinute: number }[]) => {
        const windowHours = ws.reduce((s, w) => s + (w.endMinute - w.startMinute) / 60, 0);
        const options = [4, 5, 6, 8, 10].filter((h) => h <= windowHours * 0.7);
        return options.length ? rng.pick(options) : 4;
      };
      const source = rng.weighted([
        ["professional_referral", 32 * prof.partnerWeight],
        ["website_form", 28],
        ["phone", 20],
        ["local_search", 14],
        ["community_event", 6],
      ] as const);
      let partner: (typeof activePartners)[number] | null = null;
      if (source === "professional_referral" && rng.chance(0.85)) {
        partner = rng.weighted(activePartners.map((p) => [p, p.weight] as const));
      }
      const owner = rng.pick(owners);
      const inq: SimInquiry = {
        id,
        centerKey: center.key,
        createdAt: created,
        contactAlias: `Demo Family ${aliasN++}`,
        serviceZip: rng.weighted(prof.zctas),
        payerId: payerKey ? payerId(payerKey) : null,
        preferredModes: [mode],
        windows,
        requestedHours: rng.chance(0.2) ? null : requestFor(windows),
        sourceChannel: source,
        referralCode: partner?.code ?? null,
        referralCodeId: partner?.code ? referralCodeId(partner.code) : null,
        partnerKey: partner?.key ?? null,
        intakeOwnerId: owner,
        stage: "new",
        stageEnteredAt: created,
      };

      let seq = 0;
      const push = (type: string, at: Date, prev: Stage | null, next: Stage | null, meta: Record<string, unknown> = {}) => {
        events.push({
          id: seedUuid(`event:${id}:${seq}`),
          inquiryId: id,
          eventType: type,
          previousStage: prev,
          nextStage: next,
          occurredAt: at,
          actorUserId: type === "inquiry_created" ? null : (owner ?? userId("intake")),
          metadata: { synthetic: true, ...meta },
          idempotencyKey: `seed:${id}:${seq++}`,
        });
      };
      push("inquiry_created", created, null, "new", {
        sourceChannel: source,
        referralCode: inq.referralCode,
        centerId: centerId(center.key),
      });

      let t = created.getTime();
      let stage: Stage = "new";
      const move = (to: Stage, delayMs: number, reason?: string): boolean => {
        const at = t + delayMs;
        if (at >= now.getTime() - 5 * 60_000) return false;
        t = at;
        push(eventTypeForTransition(stage, to), new Date(at), stage, to, reason ? { reason } : {});
        stage = to;
        inq.stage = to;
        inq.stageEnteredAt = new Date(at);
        return true;
      };
      const exit = (to: Stage, delayMs: number, reason: string) => move(to, delayMs, reason);

      // First outreach (may not have happened yet for young inquiries).
      const fr = prof.firstResponseHours() * HOUR;
      if (t + fr < now.getTime() - 5 * 60_000) {
        t += fr;
        push("outreach_attempted", new Date(t), null, null, { attempt: 1 });
        const reached = rng.chance(0.84);
        if (!reached) {
          if (rng.chance(0.5) && t + 2 * DAY < now.getTime()) {
            t += 2 * DAY;
            push("outreach_attempted", new Date(t), null, null, { attempt: 2 });
            if (rng.chance(0.5)) exit("inactive", 7 * DAY, "No response after outreach attempts");
          }
        } else {
          run();
        }
      }
      inquiries.push(inq);

      function run() {
        if (!move("contacted", rng.int(1, 30) * HOUR)) return;
        if (rng.chance(0.08)) return void exit("withdrawn", rng.int(1, 5) * DAY, "Family chose another option");
        if (!move("qualified", rng.int(1, 5) * DAY)) return;
        // capacity / payer realities at qualification
        const centerPayer = { north: { meridian: "no" }, west: { pinecrest: "no" }, south: {} } as Record<string, Record<string, string>>;
        if (payerKey && centerPayer[center.key]?.[payerKey] === "no") {
          return void exit("closed_unserviceable", rng.int(1, 3) * DAY, "Payer not accepted at routed site; alternate resources shared");
        }
        if (rng.chance(prof.waitlistAtQualified(payerKey, afternoon))) {
          return void exit("waitlisted", rng.int(1, 2) * DAY, "No verified RBT capacity in family's preferred windows");
        }
        if (!move("benefits_pending", rng.int(0, 2) * DAY + rng.int(2, 20) * HOUR)) return;
        if (!move("benefits_verified", prof.benefitsDays() * DAY)) return;
        if (rng.chance(0.06)) return void exit("withdrawn", rng.int(2, 6) * DAY, "Family withdrew");
        if (!move("assessment_pending", rng.int(2, 6) * DAY)) return;
        if (!move("authorization_pending", rng.int(3, 9) * DAY)) return;
        if (!move("ready_to_start", rng.int(5, 12) * DAY)) return;
        move("started", rng.int(3, 8) * DAY);
      }
    }
  }

  // sanity: never leave an inquiry in an impossible state
  for (const q of inquiries) {
    if (!(ACTIVE_STAGES as readonly string[]).concat(["started", "waitlisted", "closed_unserviceable", "withdrawn", "inactive"]).includes(q.stage)) {
      throw new Error(`bad stage ${q.stage}`);
    }
  }
  return { inquiries, events };
}

export const ZCTA_CODES = ZCTAS.map((z) => z.zcta);
export { partnerId };
