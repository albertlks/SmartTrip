import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** A surface for grouped content. interactive adds a hover state for clickable cards and rows. */
export function Card({ interactive = false, className, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-lg border border-line bg-surface p-5 shadow-card",
        interactive && "transition-[box-shadow,border-color] duration-150 hover:border-muted hover:shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
