import { Badge } from "@/components/ui/Badge";
import type { Freshness } from "@/lib/freshness";

/** Where a piece of data came from ("Live", "Cached 3h ago", "Saved search", "Sample data"). */
export function SourceBadge({ freshness }: { freshness: Freshness }) {
  return (
    <Badge tone={freshness.tone} title={freshness.title} className="whitespace-nowrap">
      <span className="sr-only">Source: </span>
      {freshness.label}
    </Badge>
  );
}
