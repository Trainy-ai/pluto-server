import {
  LineChartIcon,
  BarChart3Icon,
  ChartAreaIcon,
  FileTextIcon,
  ImageIcon,
  VideoIcon,
  MusicIcon,
  Loader2Icon,
  CheckIcon,
  TerminalIcon,
  TriangleAlertIcon,
  CircleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Shared metric/file results list used by both Search and Regex panels. */
export function MetricResultsList({
  metrics,
  selectedValues,
  isLoading,
  emptyMessage,
  onToggle,
  onSelectAll,
  runMetricSet,
  nonFiniteOnlySet,
  footer,
  itemLabel = "metric",
  typeMap,
  truncated = false,
  showSkeleton = false,
}: {
  metrics: string[];
  selectedValues: string[];
  isLoading: boolean;
  emptyMessage: string;
  onToggle: (metric: string) => void;
  onSelectAll?: () => void;
  runMetricSet?: Set<string> | null;
  /** Set of metrics whose values are entirely NaN/Inf in the selected runs.
   *  Only populated when the "Include NaN/Inf-only metrics" toggle is ON. */
  nonFiniteOnlySet?: Set<string> | null;
  footer?: React.ReactNode;
  itemLabel?: string;
  typeMap?: Map<string, string>;
  /** Caller set this to true when `metrics` was sliced down from a larger
   *  pre-cap list. Shows a "+" suffix so the count reads e.g. "500+ metrics"
   *  to signal "there were more — type to search for them". */
  truncated?: boolean;
  /** Render shimmer placeholder rows INSTEAD of `metrics`. Use when the
   *  caller is still waiting on slow data sources whose results would
   *  cause new rows to pop in mid-render (e.g. N+1 eligiblePrefixes
   *  fans, or hardcoded synthetic entries that render before the real
   *  list arrives). Keeps the dropdown visually stable. */
  showSkeleton?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border" data-testid="metric-results-list">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {isLoading || showSkeleton
            ? "Loading..."
            : `${metrics.length}${truncated ? "+" : ""} ${itemLabel}${metrics.length !== 1 ? "s" : ""}`}
        </span>
        {onSelectAll && metrics.length > 0 && (
          <button
            className="text-xs font-medium text-primary hover:underline"
            onClick={onSelectAll}
          >
            Select all
          </button>
        )}
      </div>
      <div className="h-[200px] overflow-y-auto overflow-x-hidden">
        {showSkeleton ? (
          // Shimmer placeholders sized to the real row height so the
          // list area doesn't jump when the data finally lands. 8 rows
          // ≈ what fits in the 200px viewport — enough to look like a
          // populated list while sources finish loading.
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
              <div className="size-3.5 shrink-0 animate-pulse rounded bg-muted" />
              <div
                className="h-3 animate-pulse rounded bg-muted"
                style={{ width: `${40 + ((i * 13) % 40)}%` }}
              />
            </div>
          ))
        ) : isLoading && metrics.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Searching...
          </div>
        ) : metrics.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          metrics.map((metric) => {
            const notInRuns = runMetricSet != null && !runMetricSet.has(metric);
            const isNonFiniteOnly = !notInRuns && nonFiniteOnlySet?.has(metric);
            return (
              <button
                key={metric}
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden px-2 py-1.5 text-sm hover:bg-accent"
                data-testid="metric-results-row"
                data-metric={metric}
                onClick={() => onToggle(metric)}
              >
                {selectedValues.includes(metric) ? (
                  <CheckIcon className="size-3.5 shrink-0" />
                ) : typeMap?.has(metric) ? (
                  <FileTypeIcon logType={typeMap.get(metric)!} className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <LineChartIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={cn("w-0 flex-1 truncate text-left", notInRuns && "text-muted-foreground")} title={metric}>{metric}</span>
                {notInRuns ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-auto flex shrink-0 items-center">
                        <TriangleAlertIcon className="size-3.5 text-amber-500" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Not present in selected run(s)
                    </TooltipContent>
                  </Tooltip>
                ) : isNonFiniteOnly ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-auto flex shrink-0 items-center">
                        <CircleAlertIcon className="size-3.5 text-rose-500" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      All values are NaN or Infinity in the selected run(s)
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      {footer}
    </div>
  );
}

/** Icon for file log types. */
export function FileTypeIcon({ logType, className }: { logType: string; className?: string }) {
  switch (logType) {
    // Numeric histograms get a filled-area chart glyph — visually a
    // smooth distribution — so they read as distinct from {bars}
    // categorical rollups, which keep the bar-chart glyph below.
    case "HISTOGRAM":
      return <ChartAreaIcon className={className} />;
    case "BARS":
      return <BarChart3Icon className={className} />;
    case "IMAGE": return <ImageIcon className={className} />;
    case "VIDEO": return <VideoIcon className={className} />;
    case "AUDIO": return <MusicIcon className={className} />;
    case "CONSOLE_STDOUT":
    case "CONSOLE_STDERR": return <TerminalIcon className={className} />;
    default: return <FileTextIcon className={className} />;
  }
}
