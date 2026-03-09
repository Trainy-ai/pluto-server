import {
  LineChartIcon,
  BarChart3Icon,
  FileTextIcon,
  ImageIcon,
  VideoIcon,
  MusicIcon,
  Loader2Icon,
  CheckIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared metric/file results list used by both Search and Regex panels. */
export function MetricResultsList({
  metrics,
  selectedValues,
  isLoading,
  emptyMessage,
  onToggle,
  onSelectAll,
  runMetricSet,
  footer,
  itemLabel = "metric",
  typeMap,
}: {
  metrics: string[];
  selectedValues: string[];
  isLoading: boolean;
  emptyMessage: string;
  onToggle: (metric: string) => void;
  onSelectAll?: () => void;
  runMetricSet?: Set<string> | null;
  footer?: React.ReactNode;
  itemLabel?: string;
  typeMap?: Map<string, string>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {isLoading ? "Searching..." : `${metrics.length}${metrics.length === 500 ? "+" : ""} ${itemLabel}${metrics.length !== 1 ? "s" : ""}`}
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
        {isLoading && metrics.length === 0 ? (
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
            return (
              <button
                key={metric}
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden px-2 py-1.5 text-sm hover:bg-accent"
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
                {notInRuns && (
                  <span className="group/warn relative ml-auto shrink-0">
                    <TriangleAlertIcon className="size-3.5 text-amber-500" />
                    <span className="pointer-events-none absolute bottom-full right-0 z-[999] mb-1.5 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover/warn:block">
                      Not present in selected run(s)
                    </span>
                  </span>
                )}
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
    case "HISTOGRAM": return <BarChart3Icon className={className} />;
    case "IMAGE": return <ImageIcon className={className} />;
    case "VIDEO": return <VideoIcon className={className} />;
    case "AUDIO": return <MusicIcon className={className} />;
    case "CONSOLE_STDOUT":
    case "CONSOLE_STDERR": return <TerminalIcon className={className} />;
    default: return <FileTextIcon className={className} />;
  }
}
