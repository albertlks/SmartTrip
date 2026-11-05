import { cx } from "./cx";

/** A placeholder block with the size of the content it stands for, so the page doesn't jump when it loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("rounded-md bg-raised motion-safe:animate-pulse", className)} />;
}
