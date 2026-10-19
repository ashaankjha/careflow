"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { week: string; inquiries: number; starts: number };

const SERIES = [
  { key: "starts", label: "Verified care starts", color: "#2a78d6" },
  { key: "inquiries", label: "Inquiries created", color: "#eb6834" },
] as const;

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-medium text-ink">Week of {label}</div>
      {SERIES.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-6 text-ink-2">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="font-medium text-ink tabular">{p?.value ?? 0}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({ data }: { data: Point[] }) {
  const fmt = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-ink-2" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <div className="h-56" role="img" aria-label="Weekly inquiries created and verified care starts">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#EEEAE3" vertical={false} />
            <XAxis dataKey="week" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#6B7686" }} axisLine={{ stroke: "#E7E3DC" }} tickLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B7686" }} axisLine={false} tickLine={false} />
            <Tooltip content={<TooltipBox />} labelFormatter={fmt} cursor={{ stroke: "#98A1AD", strokeDasharray: "3 3" }} />
            {SERIES.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Weekly trend</caption>
        <thead><tr><th>Week</th><th>Inquiries</th><th>Starts</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.week}><td>{d.week}</td><td>{d.inquiries}</td><td>{d.starts}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
