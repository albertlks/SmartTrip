import type { ComponentProps } from "react";
import { cx } from "./cx";

const FIELD =
  "w-full rounded-md border border-line bg-surface text-ink placeholder:text-muted " +
  "transition-[border-color] duration-150 hover:border-muted disabled:opacity-50";

// For a field inside another frame (the search box): no border or background of its own.
const BARE = "w-full rounded-md bg-transparent text-ink placeholder:text-muted disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(FIELD, "h-10 px-3 text-sm", className)} {...props} />;
}

export function Textarea({ bare = false, className, ...props }: ComponentProps<"textarea"> & { bare?: boolean }) {
  return (
    <textarea
      className={cx(bare ? BARE : cx(FIELD, "resize-y"), "min-h-24 px-4 py-3 text-base leading-relaxed", className)}
      {...props}
    />
  );
}
