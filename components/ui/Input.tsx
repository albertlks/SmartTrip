import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const FIELD =
  "w-full rounded-md border border-line bg-surface text-ink placeholder:text-muted " +
  "transition-[border-color] duration-150 hover:border-muted disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, "h-10 px-3 text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, "min-h-24 resize-y px-4 py-3 text-base leading-relaxed", className)} {...props} />;
}
