import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LogGroup } from "@/lib/grouping/types";
import {
  StringSeriesChart,
  type StringSeriesLine,
} from "@/components/charts/string-series-chart";
import { ChartCardWrapper } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/chart-card-wrapper";
import { DEFAULT_SERIES_COLOR } from "./custom-chart-view";
import { useLineSettings } from "../use-line-settings";

interface StringSeriesViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
  /** Display name for the legend/tooltip. Falls back to the run's sqid. */
  runName?: string;
  /** Run start, for the Relative Time baseline. */
  runCreatedAt?: string;
  boundsResetKey?: number;
  className?: string;
}

/**
 * Single-run series colour. Runs-table colours are an all-runs concept, so
 * both single-run viewers in this directory fall back to the same blue —
 * shared from its sibling rather than repeating the literal.
 */
const SINGLE_RUN_COLOR = DEFAULT_SERIES_COLOR;

/**
 * A non-numeric (string) metric over steps — `log("phase", "warmup")`.
 *
 * This was a coloured band. The band's problem wasn't that it looked plain:
 * having no x-axis, the one question it should have answered — *at which step
 * did this change?* — was the one it couldn't. It is now the shared staircase
 * chart, which answers that directly and comes with hover, drag-zoom and
 * cross-chart cursor sync, so hovering the loss chart shows the phase at that
 * step.
 */
export function StringSeriesView({
  log,
  tenantId,
  projectName,
  runId,
  runName,
  runCreatedAt,
  boundsResetKey,
  className,
}: StringSeriesViewProps) {
  // Same settings store the numeric charts on this page read, so the drawer's
  // X-axis log toggle applies here too.
  const { settings } = useLineSettings(tenantId, projectName, runId);
  const { data, isLoading } = useQuery(
    trpc.runs.data.stringSeries.queryOptions({
      organizationId: tenantId,
      projectName,
      runId,
      logName: log.logName,
    }),
  );

  const lines = useMemo<StringSeriesLine[]>(() => {
    if (!data || data.steps.length === 0) return [];
    return [
      {
        runId,
        // The run's name, not the metric's — this is the series label, and the
        // legend/tooltip read it as "which run is this line".
        runName: runName || runId,
        color: SINGLE_RUN_COLOR,
        steps: data.steps,
        times: data.times,
        values: data.values,
        canonicalLabels: data.canonicalLabels,
        createdAt: runCreatedAt,
      },
    ];
  }, [data, runId, runName, runCreatedAt]);

  return (
    <ChartCardWrapper
      metricName={log.logName}
      groupId={`run-${runId}`}
      globalLogXAxis={settings.xAxisLogScale}
      boundsResetKey={boundsResetKey}
      // Y is a list of labels — its log-scale control is hidden rather than
      // shown doing nothing.
      categoricalY
      renderChart={(_onResetBounds, logXAxis) =>
        isLoading ? (
          // Same loading state as the numeric charts on this page
          // (LineChartWithFetch) — a string metric shouldn't announce itself
          // as a different kind of thing while it loads.
          <Card className="h-full">
            <Skeleton className="h-full" />
          </Card>
        ) : lines.length === 0 ? (
          <div className={cn("flex h-full flex-col p-4", className)}>
            <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
              {log.logName}
            </h3>
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No values recorded
            </div>
          </div>
        ) : (
          <StringSeriesChart
            lines={lines}
            title={log.logName}
            logXAxis={logXAxis}
            xAxis={settings.selectedLog}
            className={cn("h-full w-full", className)}
          />
        )
      }
    />
  );
}
