import Link from "next/link";
import { Suspense } from "react";
import { DemoModeChip } from "./DemoModeChip";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="SmartTrip home" className="rounded-md">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}>
            <DemoModeChip />
          </Suspense>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
