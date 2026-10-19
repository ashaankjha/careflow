"use client";
import { ACTIVE_STAGES, STAGE_LABELS, type Stage } from "@careflow/core/stages";
import { SOURCE_LABELS, type SourceChannel } from "@careflow/core/schemas";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { AlertCircle, ArrowUpDown, ChevronLeft, ChevronRight, Download, FileUp, LayoutGrid, Plus, Search, Table2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { AddInquiryDialog } from "./add-inquiry";
import { ImportDialog } from "./import-dialog";
import { InquiryDrawer } from "./drawer";

export type InquiryRow = {
  id: string;
  contactAlias: string;
  stage: Stage;
  stageEnteredAt: string;
  serviceZip: string;
  sourceChannel: string;
  sourceReferralCode: string | null;
  createdAt: string;
  centerId: string | null;
  centerName: string | null;
  payerName: string | null;
  ownerName: string | null;
  daysInStage: number;
  stalled: boolean;
};

export type Option = { id: string; name: string };
export type Perms = { create: boolean; transition: boolean; import: boolean; persist: boolean };

export function stageTone(stage: string) {
  if (stage === "started") return "good" as const;
  if (stage === "waitlisted") return "warn" as const;
  if (["closed_unserviceable", "withdrawn", "inactive"].includes(stage)) return "neutral" as const;
  if (["benefits_pending", "authorization_pending"].includes(stage)) return "teal" as const;
  return "blue" as const;
}

const col = createColumnHelper<InquiryRow>();

export function IntakeWorkspace(props: {
  list: { items: InquiryRow[]; total: number; page: number; pageSize: number };
  board: InquiryRow[];
  centers: Option[];
  payers: Option[];
  owners: { id: string; displayName: string }[];
  zctas: { zcta5: string; label: string }[];
  perms: Perms;
  tz: string;
  initialInquiryId: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [view, setView] = useState<"table" | "board">("table");
  const [openId, setOpenId] = useState<string | null>(props.initialInquiryId);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [sorting, setSorting] = useState<SortingState>([]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    router.push(`${path}?${next.toString()}`);
  };

  const columns = useMemo(
    () => [
      col.accessor("contactAlias", {
        header: "Demo alias",
        cell: (c) => (
          <div>
            <div className="font-medium text-ink">{c.getValue()}</div>
            <div className="text-[11.5px] text-ink-3">ZCTA {c.row.original.serviceZip}</div>
          </div>
        ),
      }),
      col.accessor("stage", {
        header: "Stage",
        cell: (c) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={stageTone(c.getValue())}>{STAGE_LABELS[c.getValue()]}</Badge>
            {c.row.original.stalled && <Badge tone="warn"><AlertCircle className="h-3 w-3" />Stalled</Badge>}
          </div>
        ),
      }),
      col.accessor("daysInStage", { header: "Days in stage", cell: (c) => <span className="tabular">{c.getValue()}</span> }),
      col.accessor("centerName", { header: "Site", cell: (c) => c.getValue() ?? <span className="text-ink-4">Unrouted</span> }),
      col.accessor("payerName", { header: "Payer", cell: (c) => <span className="text-ink-2">{c.getValue()?.replace(" (DEMO)", "") ?? <span className="text-ink-4">Not recorded</span>}</span> }),
      col.accessor("sourceChannel", {
        header: "Source",
        cell: (c) => (
          <div className="text-ink-2">
            {SOURCE_LABELS[c.getValue() as SourceChannel] ?? c.getValue()}
            {c.row.original.sourceReferralCode && <div className="font-mono text-[11px] text-ink-3">{c.row.original.sourceReferralCode}</div>}
          </div>
        ),
      }),
      col.accessor("ownerName", { header: "Owner", cell: (c) => c.getValue() ?? <span className="text-ink-4">Unassigned</span> }),
      col.accessor("createdAt", { header: "Created", cell: (c) => <span className="tabular text-ink-2">{fmtDate(c.getValue(), props.tz)}</span> }),
    ],
    [props.tz],
  );
  const table = useReactTable({ data: props.list.items, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const pages = Math.max(1, Math.ceil(props.list.total / props.list.pageSize));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", q.trim() || null);
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-4" aria-hidden />
          <Input aria-label="Search alias or ZCTA" placeholder="Search alias or ZCTA" className="w-52 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Select aria-label="Stage" className="w-48" value={sp.get("stage") ?? ""} onChange={(e) => setParam("stage", e.target.value || null)}>
          <option value="">All stages</option>
          <option value="active">Active (pre-start)</option>
          <option value="stalled">Stalled only</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Site" className="w-40" value={sp.get("centerId") ?? ""} onChange={(e) => setParam("centerId", e.target.value || null)}>
          <option value="">All sites</option>
          {props.centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Source" className="w-44" value={sp.get("source") ?? ""} onChange={(e) => setParam("source", e.target.value || null)}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Owner queue" className="w-40" value={sp.get("owner") ?? ""} onChange={(e) => setParam("owner", e.target.value || null)}>
          <option value="">All owners</option>
          <option value="me">My queue</option>
          <option value="unassigned">Unassigned</option>
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="View">
            <button aria-pressed={view === "table"} onClick={() => setView("table")} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] font-medium", view === "table" ? "bg-ink text-white" : "text-ink-3")}><Table2 className="h-3.5 w-3.5" />Table</button>
            <button aria-pressed={view === "board"} onClick={() => setView("board")} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] font-medium", view === "board" ? "bg-ink text-white" : "text-ink-3")}><LayoutGrid className="h-3.5 w-3.5" />Kanban</button>
          </div>
          <a href="/api/v1/inquiries/template" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium hover:bg-canvas"><Download className="h-4 w-4" />Template</a>
          {props.perms.import && <Button onClick={() => setImporting(true)}><FileUp className="h-4 w-4" />Import CSV</Button>}
          {props.perms.create && <Button variant="primary" onClick={() => setAdding(true)} data-testid="add-inquiry"><Plus className="h-4 w-4" />Simulated inquiry</Button>}
        </div>
      </div>

      {view === "table" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]" data-testid="inquiry-table">
              <thead className="bg-canvas/60">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-3">
                    {hg.headers.map((h) => (
                      <th key={h.id} className="px-4 py-2.5 font-medium">
                        <button className="inline-flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                        </button>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => setOpenId(r.original.id)}
                    onKeyDown={(e) => e.key === "Enter" && setOpenId(r.original.id)}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-accent-soft/30 focus-visible:bg-accent-soft/40"
                    data-testid="inquiry-row"
                  >
                    {r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-2.5 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {props.list.items.length === 0 && <EmptyState className="m-6" title="No inquiries match these filters">Clear a filter, or add a simulated inquiry.</EmptyState>}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
            <span>{props.list.total} inquiries · page {props.list.page} of {pages}</span>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" aria-label="Previous page" disabled={props.list.page <= 1} onClick={() => setParam("page", String(props.list.page - 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Next page" disabled={props.list.page >= pages} onClick={() => setParam("page", String(props.list.page + 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3" data-testid="kanban">
          {[...ACTIVE_STAGES, "waitlisted" as const].map((stage) => {
            const items = props.board.filter((i) => i.stage === stage);
            return (
              <div key={stage} className="w-64 shrink-0 rounded-xl border border-line bg-surface/60">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="text-[12.5px] font-semibold">{STAGE_LABELS[stage]}</span>
                  <Badge tone="neutral">{items.length}</Badge>
                </div>
                <div className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
                  {items.map((i) => (
                    <button key={i.id} onClick={() => setOpenId(i.id)} className="block w-full rounded-lg border border-line bg-surface p-2.5 text-left shadow-card hover:border-accent/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium">{i.contactAlias}</span>
                        {i.stalled && <Badge tone="warn">Stalled</Badge>}
                      </div>
                      <div className="mt-1 text-[11.5px] text-ink-3">{i.centerName ?? "Unrouted"} · {i.daysInStage} d in stage</div>
                    </button>
                  ))}
                  {items.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-ink-4">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InquiryDrawer id={openId} onClose={() => setOpenId(null)} perms={props.perms} owners={props.owners} centers={props.centers} tz={props.tz} />
      <AddInquiryDialog open={adding} onOpenChange={setAdding} payers={props.payers} centers={props.centers} zctas={props.zctas} onCreated={(id) => { setAdding(false); router.refresh(); setOpenId(id); }} />
      <ImportDialog open={importing} onOpenChange={setImporting} onDone={() => router.refresh()} />
    </div>
  );
}
