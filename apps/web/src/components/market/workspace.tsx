"use client";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, SyntheticBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/misc";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtNum } from "@/lib/format";

type Zcta = {
  zcta5: string;
  label: string;
  demoFixture: boolean;
  asOfYear: number;
  centroid: { lat: number; lng: number } | null;
  children0to14: number | null;
  children0to14Moe: number | null;
  providerListings: number | null;
  listingsPer1k: number | null;
  internalInquiries: number | null;
  internalInquiriesSuppressed: boolean;
  siteFit: number | null;
  coveringCenters: { centerId: string; centerName: string; distanceMiles: number; verifiedHours: number | null }[];
  opportunity: { ranked: boolean; score: number | null; scoreLow: number | null; scoreHigh: number | null; confidence: string; components: { population: number | null; listingGap: number | null; siteFit: number | null }; warnings: string[] };
};
type Snapshot = { id: string; sourceKey: string; status: string; ingestedAt: string; datasetVersion: string | null; licenseNote: string | null; parsingWarnings: string[]; demoFixture: boolean; url: string | null; rowCount: number };
type Data = { zctas: Zcta[]; method: { name: string; formula: string; notes: string[] }; provenance: { acs: Snapshot | null; listings: Snapshot | null; internal: Snapshot | null; recentRuns: Snapshot[] } };

const LAYERS = {
  opportunity: { label: "Opportunity score", get: (z: Zcta) => z.opportunity.score, fmt: (v: number) => v.toFixed(0), note: "Heuristic 0–100; not a need estimate" },
  children: { label: "Children 0–14", get: (z: Zcta) => z.children0to14, fmt: (v: number) => fmtNum(v), note: "ACS-shaped estimate (synthetic)" },
  listings: { label: "Listings per 1k children", get: (z: Zcta) => z.listingsPer1k, fmt: (v: number) => v.toFixed(2), note: "Public listing density proxy ≠ supply" },
  inquiries: { label: "Internal inquiries", get: (z: Zcta) => z.internalInquiries, fmt: (v: number) => String(v), note: "First-party aggregate; <5 suppressed" },
  fit: { label: "Verified site fit", get: (z: Zcta) => z.siteFit, fmt: (v: number) => v.toFixed(2), note: "Verified capacity within operational radius" },
} as const;
type LayerKey = keyof typeof LAYERS;

// Sequential single-hue ramp (validated blue ramp, light → dark).
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

const ORIGIN = { lat: 32.95, lng: -117.95 };
const K = 11; // px per mile
const toXY = (lat: number, lng: number) => ({ x: (lng - ORIGIN.lng) * 58 * K, y: (ORIGIN.lat - lat) * 69 * K });
const hexPath = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

export function MarketWorkspace({ data, centers, canRefresh, tz }: { data: Data; centers: { id: string; name: string; lat: number | null; lng: number | null; radius: number }[]; canRefresh: boolean; tz: string }) {
  const router = useRouter();
  const [layer, setLayer] = useState<LayerKey>("opportunity");
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const L = LAYERS[layer];
  const tiles = data.zctas.filter((z) => z.centroid);
  const others = data.zctas.filter((z) => !z.centroid);
  const values = tiles.map((z) => L.get(z)).filter((v): v is number => v != null).sort((a, b) => a - b);
  const bin = (v: number) => {
    if (values.length < 2) return RAMP.length - 1;
    const idx = values.findIndex((x) => x >= v);
    return Math.min(RAMP.length - 1, Math.floor((idx / (values.length - 1)) * (RAMP.length - 1) + 0.0001));
  };
  const pts = tiles.map((z) => ({ z, ...toXY(z.centroid!.lat, z.centroid!.lng) }));
  const cpts = centers.filter((c) => c.lat != null).map((c) => ({ c, ...toXY(c.lat!, c.lng!) }));
  const R = 4 * K;
  const minX = Math.min(...pts.map((p) => p.x)) - R - 20;
  const maxX = Math.max(...pts.map((p) => p.x)) + R + 20;
  const minY = Math.min(...pts.map((p) => p.y)) - R - 20;
  const maxY = Math.max(...pts.map((p) => p.y)) + R + 20;
  const sel = data.zctas.find((z) => z.zcta5 === focus) ?? [...data.zctas].filter((z) => z.opportunity.ranked).sort((a, b) => (b.opportunity.score ?? 0) - (a.opportunity.score ?? 0))[0];
  const ranked = useMemo(() => [...data.zctas].sort((a, b) => (b.opportunity.score ?? -1) - (a.opportunity.score ?? -1)), [data.zctas]);

  async function refresh() {
    setBusy(true);
    try {
      const r = await api<{ results: { sourceKey: string; status: string; message: string }[] }>("/market/refresh", { body: {} });
      r.results.forEach((x) => (x.status === "failed" ? toast.error : toast.message)(`${x.sourceKey}: ${x.status} — ${x.message}`));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader
          title="Harbor Bay study area (fictional)"
          description={`${L.label} · ${L.note}`}
          actions={
            <Tabs value={layer} onValueChange={(v) => setLayer(v as LayerKey)}>
              <TabsList aria-label="Map layer" className="flex-wrap">
                {(Object.keys(LAYERS) as LayerKey[]).map((k) => <TabsTrigger key={k} value={k}>{LAYERS[k].label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          }
        />
        <CardBody>
          <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="h-auto w-full max-h-[460px]" role="img" aria-label={`Hex tile map of ${tiles.length} demo ZCTAs colored by ${L.label}`} data-testid="market-map">
            <defs>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#F1EEE8" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#C9C3B8" strokeWidth="1.5" />
              </pattern>
            </defs>
            {cpts.map(({ c, x, y }) => <circle key={`r-${c.id}`} cx={x} cy={y} r={c.radius * K} fill="none" stroke="#0F1B2D" strokeOpacity={0.18} strokeDasharray="4 4" />)}
            {pts.map(({ z, x, y }) => {
              const v = L.get(z);
              const isSel = sel?.zcta5 === z.zcta5;
              return (
                <g key={z.zcta5} tabIndex={0} role="button" aria-label={`${z.zcta5} ${z.label}: ${v == null ? "no value" : L.fmt(v)}`} onMouseEnter={() => setFocus(z.zcta5)} onFocus={() => setFocus(z.zcta5)} onClick={() => setFocus(z.zcta5)} className="cursor-pointer outline-none" data-testid={`tile-${z.zcta5}`}>
                  <polygon points={hexPath(x, y, R - 1)} fill={v == null ? "url(#hatch)" : RAMP[bin(v)]} stroke={isSel ? "#0F1B2D" : "#FFFFFF"} strokeWidth={isSel ? 3 : 2} />
                  <text x={x} y={y - 18} textAnchor="middle" className="pointer-events-none" fontSize="11" fontWeight={600} fill={v != null && bin(v) >= 3 ? "#FFFFFF" : "#0F1B2D"}>{z.zcta5}</text>
                  <text x={x} y={y - 4} textAnchor="middle" className="pointer-events-none" fontSize="10" fill={v != null && bin(v) >= 3 ? "#FFFFFFCC" : "#3D4A5C"}>{v == null ? (z.internalInquiriesSuppressed && layer === "inquiries" ? "<5" : "n/a") : L.fmt(v)}</text>
                </g>
              );
            })}
            {cpts.map(({ c, x, y }) => (
              <g key={c.id} className="pointer-events-none">
                <circle cx={x} cy={y + 8} r={5} fill="#0F766E" stroke="#fff" strokeWidth={2} />
                <text x={x} y={y + 26} textAnchor="middle" fontSize="9.5" fontWeight={600} fill="#0F1B2D" stroke="#fff" strokeWidth={3} paintOrder="stroke">{c.name}</text>
              </g>
            ))}
          </svg>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-ink-3">
            <span className="flex items-center gap-1">Low {RAMP.map((c) => <span key={c} className="h-3 w-5" style={{ background: c }} />)} High</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-5 border border-line" style={{ background: "repeating-linear-gradient(45deg,#F1EEE8 0 3px,#C9C3B8 3px 4px)" }} />Not ranked / missing / suppressed</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-teal" />Site · dashed ring = operational radius</span>
            <SyntheticBadge label="Fictional geography" />
          </div>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {sel && (
          <Card data-testid="zcta-detail">
            <CardHeader eyebrow={`ZCTA ${sel.zcta5}`} title={sel.label} actions={sel.demoFixture ? <SyntheticBadge /> : <Badge tone="blue">Public ACS</Badge>} />
            <CardBody>
              <div className="mb-3 flex items-end gap-3">
                <div className="text-3xl font-semibold tabular">{sel.opportunity.score?.toFixed(0) ?? "—"}</div>
                <div className="pb-1 text-[12px] text-ink-3">
                  opportunity heuristic{sel.opportunity.scoreLow != null && sel.opportunity.scoreHigh != null && sel.opportunity.scoreLow !== sel.opportunity.scoreHigh ? ` · range ${sel.opportunity.scoreLow}–${sel.opportunity.scoreHigh}` : ""}
                </div>
                <Badge tone={sel.opportunity.confidence === "high" ? "good" : sel.opportunity.confidence === "not_ranked" ? "neutral" : "warn"} className="mb-1 ml-auto">{sel.opportunity.confidence.replace("_", " ")} confidence</Badge>
              </div>
              <KeyValue k="Children 0–14 (est.)" v={sel.children0to14 == null ? "missing" : `${fmtNum(sel.children0to14)} ± ${fmtNum(sel.children0to14Moe)}`} />
              <KeyValue k="Public provider listings" v={sel.providerListings ?? "missing"} />
              <KeyValue k="Listings per 1k children" v={sel.listingsPer1k ?? "—"} />
              <KeyValue k="Internal inquiries (aggregate)" v={sel.internalInquiriesSuppressed ? "<5 (suppressed)" : (sel.internalInquiries ?? 0)} />
              <KeyValue k="Verified site fit" v={sel.siteFit ?? "unknown"} />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11.5px]">
                {(["population", "listingGap", "siteFit"] as const).map((k) => (
                  <div key={k} className="rounded-md bg-canvas p-2"><div className="text-ink-3">{k === "population" ? "Population P (45%)" : k === "listingGap" ? "Listing gap L (25%)" : "Site fit F (30%)"}</div><div className="mt-0.5 font-semibold tabular">{sel.opportunity.components[k]?.toFixed(2) ?? "—"}</div></div>
                ))}
              </div>
              <div className="mt-3 text-[12px] text-ink-2">
                <div className="font-medium">Sites in reach</div>
                {sel.coveringCenters.length ? sel.coveringCenters.map((c) => <div key={c.centerId} className="flex justify-between text-ink-3"><span>{c.centerName} · ~{c.distanceMiles} mi</span><span>{c.verifiedHours ?? "unverified"} verified h/wk</span></div>) : <div className="text-ink-3">None within operational radius</div>}
              </div>
              {sel.opportunity.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-[11.5px] text-warn">{sel.opportunity.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>)}</ul>
              )}
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Source provenance" description="Latest download time, vintage, warnings and errors." actions={canRefresh && <Button size="sm" onClick={refresh} loading={busy} data-testid="market-refresh"><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>} />
          <CardBody className="space-y-3 text-[12.5px]" data-testid="provenance">
            {[["Child population (ACS shape)", data.provenance.acs], ["Provider listings (NPPES shape)", data.provenance.listings], ["Internal inquiries", data.provenance.internal]].map(([label, s]) => {
              const snap = s as Snapshot | null;
              return (
                <div key={label as string} className="rounded-lg border border-line p-2.5">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{label as string}</span>{snap && (snap.demoFixture ? <SyntheticBadge label="Fixture" /> : <Badge tone="good">{snap.status}</Badge>)}</div>
                  {snap ? (
                    <div className="mt-1 text-[11.5px] text-ink-3">
                      <div>{snap.datasetVersion} · ingested {fmtDateTime(snap.ingestedAt, tz)}</div>
                      {snap.parsingWarnings.slice(0, 2).map((w) => <div key={w} className="text-warn">{w}</div>)}
                    </div>
                  ) : <div className="mt-1 text-[11.5px] text-ink-3">No snapshot</div>}
                </div>
              );
            })}
            <div>
              <div className="eyebrow mb-1">Recent refresh runs</div>
              {data.provenance.recentRuns.slice(0, 6).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-0.5 text-[11.5px]">
                  <span className="truncate text-ink-2">{r.sourceKey}</span>
                  <span className="flex items-center gap-1.5"><Badge tone={r.status === "ok" ? "good" : r.status === "failed" ? "bad" : "neutral"}>{r.status}</Badge><span className="text-ink-4">{fmtDateTime(r.ingestedAt, tz)}</span></span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="xl:col-span-2">
        <CardHeader title="Outreach research ranking" description={data.method.formula} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[12.5px]" data-testid="market-table">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="px-5 py-2">ZCTA</th><th className="px-3 py-2 text-right">Children 0–14</th><th className="px-3 py-2 text-right">Listings</th><th className="px-3 py-2 text-right">Per 1k</th><th className="px-3 py-2 text-right">Inquiries</th><th className="px-3 py-2 text-right">Site fit</th><th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2">Confidence</th></tr></thead>
            <tbody>
              {ranked.map((z) => (
                <tr key={z.zcta5} className={cn("border-b border-line/70 last:border-0", focus === z.zcta5 && "bg-accent-soft/40")} onMouseEnter={() => setFocus(z.zcta5)}>
                  <td className="px-5 py-2"><span className="font-mono">{z.zcta5}</span> <span className="text-ink-3">{z.label}</span> {!z.demoFixture && <Badge tone="blue">ACS</Badge>}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtNum(z.children0to14)}</td>
                  <td className="px-3 py-2 text-right tabular">{z.providerListings ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular">{z.listingsPer1k ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular">{z.internalInquiriesSuppressed ? "<5" : (z.internalInquiries ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular">{z.siteFit ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular">{z.opportunity.score?.toFixed(1) ?? "—"}</td>
                  <td className="px-3 py-2">{z.opportunity.confidence.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-line">
          <ul className="grid gap-1 text-[12px] text-ink-3 md:grid-cols-2">{data.method.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
          {others.length > 0 && <p className="mt-2 text-[12px] text-ink-3">{others.length} public ACS ZCTA row(s) have no demo geometry and appear in the table only.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
