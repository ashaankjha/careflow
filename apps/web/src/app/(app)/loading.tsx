export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-6 w-48 rounded bg-ink/[0.06]" />
      <div className="h-4 w-96 max-w-full rounded bg-ink/[0.05]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 rounded-xl border border-line bg-surface" />)}
      </div>
      <div className="h-72 rounded-xl border border-line bg-surface" />
    </div>
  );
}
