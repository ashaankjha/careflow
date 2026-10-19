import { exportDraft, getDraft } from "@careflow/db";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db, withOrg } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { PrintButton } from "./print-button";

export const metadata = { title: "Referral packet" };

/** Printable local preview of an APPROVED referral packet. Nothing is sent or published. */
export default async function PacketPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const d = await withOrg(s.ctx, () => getDraft(db(), s.ctx, id)).catch(() => null);
  if (!d) notFound();
  if (d.approvalStatus !== "approved") {
    return <main className="mx-auto max-w-2xl p-10 text-sm">This packet is not approved yet. Approve it in Growth Missions before printing.</main>;
  }
  const r = await withOrg(s.ctx, () => exportDraft(db(), s.ctx, id, "html"));
  const es = d.locale === "es-US";
  const code = /(?:referral code|código de referencia) \*\*([A-Z0-9]+)\*\*/.exec(d.bodyMd)?.[1];
  const qr = code ? await QRCode.toDataURL(`REF:${code}`, { margin: 1, width: 140 }) : null;
  return (
    <main className="mx-auto max-w-[760px] bg-white p-10 print:p-0">
      <div className="no-print mb-6 flex items-center justify-between rounded-lg border border-line bg-canvas p-3 text-[12.5px]">
        <span>
          Local print preview · approved {d.approvedAt?.toISOString().slice(0, 10)} · revision {d.revision}. Sending is disabled.
          {es && <strong className="mt-1 block text-warn" data-testid="packet-translation-note">Machine-authored Spanish template: have a qualified human translator review it before any real use.</strong>}
        </span>
        <PrintButton />
      </div>
      <div lang={d.locale} className="mb-4 rounded border border-dashed border-warn/60 bg-warn-soft px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-warn">
        {es ? "Demostración sintética — organización ficticia" : "Synthetic demonstration — fictional organization"}
      </div>
      <article lang={d.locale} className="prose-draft" dangerouslySetInnerHTML={{ __html: r.content }} data-testid="packet-body" />
      {qr && (
        <div lang={d.locale} className="mt-6 flex items-center gap-4 border-t border-line pt-4">
          <img src={qr} alt={es ? `Código de referencia ${code}` : `Referral code ${code}`} className="h-24 w-24" />
          <p className="text-[12px] text-ink-3">
            {es ? "Código de atribución opcional " : "Optional attribution code "}
            <strong className="font-mono">{code}</strong>. {es ? "Solo se cuenta de forma agregada." : "Counted in aggregate only."}
          </p>
        </div>
      )}
    </main>
  );
}
