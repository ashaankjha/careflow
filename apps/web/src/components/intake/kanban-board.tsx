"use client";
import { BOARD_STAGES, legalMoves, requiresReason, STAGE_LABELS, type Stage } from "@careflow/core/stages";
import { AlertCircle, GripVertical, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { api, ApiError, idemKey } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { InquiryRow } from "./workspace";

/**
 * Intake Kanban. Cards move between stage columns by native HTML5 drag and
 * drop or the per-card "Move to…" menu; both call the same state-machine API
 * as the drawer. Only legal targets (packages/core legalMoves) accept a drop.
 * Moves that need a reason or a verified care start open the drawer instead of
 * transitioning silently. The move is optimistic and rolls back on any error.
 */
export function KanbanBoard({ rows, canTransition, onOpen }: { rows: InquiryRow[]; canTransition: boolean; onOpen: (id: string, pendingStage?: Stage) => void }) {
  const router = useRouter();
  // optimistic stage overrides while a transition is in flight / until the refreshed board arrives
  const [moved, setMoved] = useState<Record<string, Stage>>({});
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{ id: string; from: Stage } | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => setMoved({}), [rows]);

  const cards = useMemo(() => rows.map((r) => (moved[r.id] ? { ...r, stage: moved[r.id]! } : r)), [rows, moved]);
  const dragTargets = useMemo(() => (dragging ? new Set(legalMoves(dragging.from, BOARD_STAGES).map((m) => m.to)) : null), [dragging]);

  async function move(card: InquiryRow, to: Stage) {
    if (!canTransition || inFlight.has(card.id) || card.stage === to) return;
    const legal = legalMoves(card.stage).find((m) => m.to === to);
    if (!legal) return;
    if (legal.needsInput) {
      // a reason or a verified care start is required: the drawer collects it
      onOpen(card.id, requiresReason(card.stage, to) ? to : undefined);
      return;
    }
    setError(null);
    setMoved((m) => ({ ...m, [card.id]: to }));
    setInFlight((s) => new Set(s).add(card.id));
    try {
      await api(`/inquiries/${card.id}/transition`, { body: { toStage: to, reason: null, eventIdempotencyKey: idemKey("tr") } });
      toast.success(`${card.contactAlias} moved to ${STAGE_LABELS[to]}`);
      setAnnounce(`${card.contactAlias} moved to ${STAGE_LABELS[to]}`);
      router.refresh();
    } catch (e) {
      setMoved((m) => {
        const next = { ...m };
        delete next[card.id];
        return next;
      });
      const msg = `${card.contactAlias} was not moved: ${e instanceof ApiError ? e.message : "Action failed"}`;
      setError(msg);
      setAnnounce(msg);
      toast.error(msg);
    } finally {
      setInFlight((s) => {
        const next = new Set(s);
        next.delete(card.id);
        return next;
      });
    }
  }

  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };

  const onDragOver = (stage: Stage) => (e: DragEvent) => {
    // not calling preventDefault keeps illegal columns from accepting the drop
    if (!dragTargets?.has(stage)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== stage) setOver(stage);
  };

  const onDrop = (stage: Stage) => (e: DragEvent) => {
    e.preventDefault();
    const card = dragging && cards.find((c) => c.id === dragging.id);
    endDrag();
    if (card && dragTargets?.has(stage)) void move(card, stage);
  };

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad" data-testid="kanban-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="rounded p-0.5 hover:bg-bad/10"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      {canTransition && <p className="mb-2 text-[12px] text-ink-3">Drag a card to the next stage, or use its “Move to…” menu. Only allowed stage changes accept a drop; waitlisting asks for a reason in the inquiry drawer.</p>}
      <div className="flex gap-3 overflow-x-auto pb-3" data-testid="kanban">
        {BOARD_STAGES.map((stage) => {
          const items = cards.filter((i) => i.stage === stage);
          const drop = dragTargets ? (dragTargets.has(stage) ? "legal" : stage === dragging?.from ? "source" : "illegal") : undefined;
          return (
            <section
              key={stage}
              aria-label={STAGE_LABELS[stage]}
              data-testid={`kanban-col-${stage}`}
              data-drop={drop}
              onDragOver={onDragOver(stage)}
              onDragLeave={() => over === stage && setOver(null)}
              onDrop={onDrop(stage)}
              className={cn(
                "w-64 shrink-0 rounded-xl border border-line bg-surface/60 transition-[opacity,box-shadow]",
                drop === "legal" && "border-accent/50 ring-2 ring-accent/30",
                drop === "legal" && over === stage && "bg-accent-soft/40 ring-accent",
                drop === "illegal" && "cursor-not-allowed opacity-50",
              )}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <h3 className="text-[12.5px] font-semibold">{STAGE_LABELS[stage]}</h3>
                <Badge tone="neutral">{items.length}</Badge>
              </div>
              <div className="max-h-[60vh] min-h-24 space-y-2 overflow-y-auto p-2">
                {items.map((i) => {
                  const moves = legalMoves(i.stage);
                  const busy = inFlight.has(i.id);
                  const draggable = canTransition && !busy && moves.length > 0;
                  return (
                    <div
                      key={i.id}
                      data-testid="kanban-card"
                      data-inquiry-id={i.id}
                      data-stage={i.stage}
                      draggable={draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", i.id);
                        setDragging({ id: i.id, from: i.stage });
                      }}
                      onDragEnd={endDrag}
                      aria-busy={busy || undefined}
                      className={cn("rounded-lg border border-line bg-surface shadow-card hover:border-accent/40", draggable && "cursor-grab active:cursor-grabbing", busy && "opacity-60", dragging?.id === i.id && "opacity-40")}
                    >
                      <button type="button" onClick={() => onOpen(i.id)} className="block w-full rounded-t-lg p-2.5 pb-1.5 text-left">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1">
                            {draggable && <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />}
                            <span className="truncate text-[12.5px] font-medium">{i.contactAlias}</span>
                          </span>
                          {i.stalled && <Badge tone="warn">Stalled</Badge>}
                        </div>
                        <div className="mt-1 text-[11.5px] text-ink-3">{i.centerName ?? "Unrouted"} · {i.daysInStage} d in stage</div>
                      </button>
                      {canTransition && moves.length > 0 && (
                        <div className="px-2.5 pb-2.5">
                          <Select
                            aria-label={`Move ${i.contactAlias} to…`}
                            data-testid="kanban-move"
                            className="h-7 text-[12px]"
                            value=""
                            disabled={busy}
                            onChange={(e) => e.target.value && void move(i, e.target.value as Stage)}
                          >
                            <option value="">Move to…</option>
                            {moves.map((m) => (
                              <option key={m.to} value={m.to}>{STAGE_LABELS[m.to]}{m.needsInput ? " (opens drawer)" : ""}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}
                {items.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-ink-4">Empty</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
