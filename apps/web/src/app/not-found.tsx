import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 text-xl font-semibold">Not found</h1>
        <p className="mt-1 text-[13px] text-ink-3">The page or record doesn’t exist in your organization.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">Back to overview</Link>
      </div>
    </main>
  );
}
