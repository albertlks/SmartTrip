/** The SmartTrip mark (a route between two stops) and wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 22c3-9 11-3 14-12" fill="none" stroke="var(--on-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="0.1 4.5" />
      <circle cx="9" cy="22" r="2.75" fill="var(--on-accent)" />
      <circle cx="23" cy="10" r="2.75" fill="var(--on-accent)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark className="h-7 w-7" />
      <span className="text-lg font-semibold tracking-tight text-ink">SmartTrip</span>
    </span>
  );
}
