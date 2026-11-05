import { connection } from "next/server";
import { demoOffline } from "@/mcp-server/lib/providers";

/** "Offline demo data" in the header while DEMO_FALLBACK=offline is set. Read per request, so a restart is enough to change it. */
export async function DemoModeChip() {
  await connection();
  if (!demoOffline()) return null;
  return (
    <span
      title="DEMO_FALLBACK=offline: saved searches where they exist, sample data otherwise. No live searches."
      className="rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning"
    >
      Offline demo data
    </span>
  );
}
