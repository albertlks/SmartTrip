import type { ReactNode } from "react";
import { cx } from "./cx";

type StateProps = { title: string; children?: ReactNode; action?: ReactNode; className?: string };

/** Shown when there is nothing to list yet, with an optional next step. */
export function EmptyState({ title, children, action, className }: StateProps) {
  return (
    <div className={cx("rounded-lg border border-dashed border-line px-6 py-10 text-center", className)}>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** A readable error with what to do next. Announced to screen readers when it appears. */
export function ErrorState({ title, children, action, className }: StateProps) {
  return (
    <div role="alert" className={cx("rounded-lg border border-danger/30 bg-danger-soft px-5 py-4", className)}>
      <p className="text-sm font-semibold text-danger">{title}</p>
      {children && <div className="mt-1 text-sm text-ink">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
