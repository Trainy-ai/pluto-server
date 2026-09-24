import { Skeleton } from "@/components/ui/skeleton";
import { TruncatedLabel } from "@/components/shared/truncated-label";
import { cn } from "@/lib/utils";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { getCustomColumnValue, formatCellValue, formatCellTitle } from "../columns-utils";

interface CustomColumnCellProps {
  run: Run;
  col: ColumnConfig;
}

/** Cell for a user-added column (system / config / systemMetadata / metric). */
export function CustomColumnCell({ run, col }: CustomColumnCellProps) {
  const value = getCustomColumnValue(run, col);
  // Metric columns: distinguish "still fetching" from "value is
  // genuinely null/NaN". Both used to render as "-", which made
  // it impossible to tell whether to wait or accept the empty.
  if (
    col.source === "metric" &&
    value == null &&
    (run as { _metricsLoading?: boolean })._metricsLoading
  ) {
    return <Skeleton className="h-3 w-12" />;
  }
  const display = formatCellValue(value, col);
  // TruncatedLabel measures scrollWidth vs clientWidth (with a
  // ResizeObserver) so the tooltip appears ONLY when the cell
  // is actually visually truncated — no arbitrary length gate,
  // no tooltip on fully-visible short text. The Radix content
  // is capped at max-w-[28rem] with `text-wrap break-all` so
  // long dependency lists wrap inside the box instead of
  // running off the viewport into a corner. Date columns are the
  // exception: their compact text omits the year, so they always
  // show the full timestamp on hover.
  return (
    <TruncatedLabel
      text={display}
      title={formatCellTitle(value, col)}
      alwaysShowTitle
      className={cn("text-xs", display === "-" && "text-muted-foreground/50")}
    />
  );
}
