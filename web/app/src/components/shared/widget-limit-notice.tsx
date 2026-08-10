import { cn } from "@/lib/utils";
import { MAX_RUNS_PER_BATCH } from "@/lib/batch-limits";

interface WidgetLimitNoticeProps {
  /** Metric / log name, shown as the widget's heading. */
  title?: string;
  /**
   * What the widget counts. Line charts draw one series per (metric, run), so
   * they report series; media, histogram and bars widgets draw one strip per
   * run and have no metric axis, so they report runs.
   */
  unit: "runs" | "series";
  count: number;
  max: number;
  /** Overrides the default remedy line when runs aren't the binding limit. */
  hint?: string;
  className?: string;
}

/**
 * Shown in place of a widget that would exceed a request or render limit.
 * States the count, the limit, and the action that clears it — never a bare
 * error, and never an empty state that reads as "there is no data here".
 */
export function WidgetLimitNotice({
  title,
  unit,
  count,
  max,
  hint,
  className,
}: WidgetLimitNoticeProps) {
  return (
    <div
      data-testid="widget-limit-notice"
      data-unit={unit}
      data-count={count}
      data-max={max}
      className={cn(
        "flex h-full w-full flex-grow flex-col items-center justify-center bg-accent/50 p-4",
        className,
      )}
    >
      {title ? (
        <p className="text-sm font-medium text-foreground">{title}</p>
      ) : null}
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Too many {unit} ({count}). Maximum is {max}.
      </p>
      <p className="text-center text-xs text-muted-foreground">
        {hint ?? `Reduce your selection to ${MAX_RUNS_PER_BATCH} runs or fewer.`}
      </p>
    </div>
  );
}
