import { can } from "@careflow/core";
import { listDrafts, listPartners } from "@careflow/db";
import QRCode from "qrcode";
import { SyntheticBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { ReferralsWorkspace } from "@/components/referrals/workspace";
import { db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "Referral Network" };

export default async function ReferralsPage() {
  const s = await requireSession();
  const [partners, drafts] = await Promise.all([listPartners(db(), s.ctx), listDrafts(db(), s.ctx)]);
  const qr: Record<string, string> = {};
  for (const p of partners) for (const c of p.codes) qr[c.code] = await QRCode.toDataURL(`REF:${c.code}`, { margin: 1, width: 120, color: { dark: "#0F1B2D", light: "#FFFFFF" } });
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Professional relationships <SyntheticBadge label="Fictional partners" /></span>}
        title="Referral network"
        description="Professional partners from public business listings only. Attribution is aggregate; a partner never sees an individual family's status. No gifts, fees or pay-per-referral — ever."
      />
      <ReferralsWorkspace
        partners={JSON.parse(JSON.stringify(partners))}
        packets={JSON.parse(JSON.stringify(drafts.filter((d) => d.kind === "partner_packet" || d.kind === "referral_email")))}
        qr={qr}
        canManage={can(s.user.role, "partner:manage")}
        tz={s.org.timezone}
      />
    </>
  );
}
