export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0F1B2D" />
      <path d="M9 17.5c0-4.1 3.1-7.5 7.2-7.5 2.3 0 4.2 1 5.5 2.6" stroke="#7FB2F0" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M23 14.5c0 4.1-3.1 7.5-7.2 7.5-2.3 0-4.2-1-5.5-2.6" stroke="#2DD4BF" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="21.8" cy="12.6" r="1.6" fill="#7FB2F0" />
      <circle cx="10.2" cy="19.4" r="1.6" fill="#2DD4BF" />
    </svg>
  );
}
