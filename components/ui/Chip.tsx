import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type ChipProps = { label: string; value: string } & ButtonHTMLAttributes<HTMLButtonElement>;

/** A labeled value such as "From HNL". Clickable (to edit it) when it gets an onClick. */
export function Chip({ label, value, className, onClick, ...props }: ChipProps) {
  const classes = cx(
    "inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent-strong",
    onClick && "transition-opacity duration-150 hover:opacity-80",
    className,
  );
  const content = (
    <>
      <span className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</span>
      <span className="font-medium">{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} {...props}>
      {content}
    </button>
  ) : (
    <span className={classes}>{content}</span>
  );
}
