"use client";

import { useSyncExternalStore } from "react";
import { cx } from "./ui/cx";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const listeners = new Set<() => void>();

/**
 * Runs in <head> before the first paint: applies the saved theme, or the device's preference on a first visit,
 * so the page never flashes the wrong colors.
 */
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${STORAGE_KEY}")}catch(e){}if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)})()`;

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked (e.g. a private window): the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light theme", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" },
  { value: "dark", label: "Dark theme", icon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" },
];

export function ThemeToggle() {
  // The server doesn't know the theme, so it renders "light" and the browser corrects it after hydration.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  return (
    <div role="group" aria-label="Color theme" className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.label}
          aria-pressed={theme === o.value}
          title={o.label}
          onClick={() => setTheme(o.value)}
          className={cx(
            "inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors duration-150",
            theme === o.value ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink",
          )}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d={o.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}
