import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import {
  StringSeriesChart,
  type StringSeriesLine,
} from "@/components/charts/string-series-chart";
import { ChartCardWrapper } from "./chart-card-wrapper";
import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

interface MultiGroupStringSeriesProps {
  logName: string;
  organizationId: string;
  projectName: string;
  runs: {
    runId: string;
    runName: string;
    color: string;
    /**
     * Run start, for the Relative Time baseline. Already present on
     * `formattedRuns` in multi-group.tsx — declared here so it is forwarded
     * rather than dropped at this boundary, which is what made a string
     * staircase baseline on its first SAMPLE while every numeric chart beside
     * it baselined on run start, so the two did not line up at zero.
     */
    createdAt?: string;
  }[];
  /** Section id, so per-chart settings persist alongside the numeric charts. */
  groupId: string;
  /** Global X-axis log scale from the settings drawer. */
  globalLogXAxis?: boolean;
  boundsResetKey?: number;
  className?: string;
}

/**
 * A string metric across runs — `log("phase", "warmup")`.
 *
 * The all-runs dispatch fell through to `() => null` for DATA, so a project
 * with string metrics rendered a section full of empty cards: header and card
 * shells present, nothing inside them.
 *
 * Drawn as a staircase beside the numeric charts rather than as a bespoke
 * widget, which is the point: one line per run on a shared step axis, so "run
 * A reached eval 200 steps before run B" is readable at a glance, and the
 * chart joins the same cursor sync as everything else.
 */
export const MultiGroupStringSeries = ({
  logName,
  organizationId,
  projectName,
  runs,
  groupId,
  globalLogXAxis,
  boundsResetKey,
  className,
}: MultiGroupStringSeriesProps) => {
  const queries = useQueries({
    queries: runs.map((r) =>
      trpc.runs.data.stringSeries.queryOptions({
        organizationId,
        projectName,
        runId: r.runId,
        logName,
      }),
    ),
  });

  // Same store the numeric charts read, so the X-axis choice (Step / Relative
  // Time / Absolute Time) applies here too.
  const { settings } = useLineSettings(organizationId, projectName, "full");

  const isLoading = queries.some((q) => q.isLoading);

  const lines = useMemo<StringSeriesLine[]>(() => {
    const out: StringSeriesLine[] = [];
    runs.forEach((run, i) => {
      const data = queries[i]?.data;
      // Runs that never logged this metric are simply absent, rather than
      // contributing an empty series to the legend.
      if (!data || data.steps.length === 0) return;
      out.push({
        runId: run.runId,
        runName: run.runName,
        color: run.color,
        steps: data.steps,
        times: data.times,
        values: data.values,
        canonicalLabels: data.canonicalLabels,
        // Same baseline the numeric charts use, so Relative Time lines both
        // up at zero. StringSeriesChart falls back to the first sample when
        // this is absent, which is what the run page never hit because it
        // always passed it.
        createdAt: run.createdAt,
      });
    });
    return out;
    // Spread, not a bare `.map()`: a fresh array literal in the dep list is
    // never Object.is-equal, so `lines` would be rebuilt on every render. That
    // is not cosmetic here — `StringSeriesChart` derives `categories` from
    // `lines`, passes it as `yCategories`, and that array sits in
    // `line-uplot`'s `options` memo, so a new identity makes `useChartLifecycle`
    // destroy and recreate the uPlot instance (killing drag-zoom mid-drag).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, ...queries.map((q) => q.data)]);

  // The proc stride-samples at `stepCap` and sets `truncated` when more rows
  // exist. Surface that so a long run doesn't look like a complete staircase
  // that happened to skip phases between unsampled steps.
  const truncation = useMemo(() => {
    let shown = 0;
    let total = 0;
    let any = false;
    for (const q of queries) {
      const data = q.data;
      if (!data?.truncated) continue;
      any = true;
      shown = Math.max(shown, data.steps.length);
      total = Math.max(total, data.totalSteps);
    }
    return any ? { shown, total } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...queries.map((q) => q.data)]);

  return (
    <ChartCardWrapper
      metricName={logName}
      groupId={groupId}
      globalLogXAxis={globalLogXAxis}
      boundsResetKey={boundsResetKey}
      // Y is a list of labels, so its log scale and bounds controls are hidden
      // rather than shown doing nothing.
      categoricalY
      renderChart={(_onResetBounds, logXAxis) =>
        isLoading ? (
          // Matches the numeric charts' loading state (see LineChartWithFetch).
          <Card className="h-full">
            <Skeleton className="h-full" />
          </Card>
        ) : lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No values recorded for the selected runs
          </div>
        ) : (
          <div className={cn("flex h-full w-full flex-col", className)}>
            <StringSeriesChart
              lines={lines}
              title={logName}
              logXAxis={logXAxis}
              xAxis={settings.selectedLog}
              className="min-h-0 flex-1"
            />
            {truncation && (
              <p className="text-center font-mono text-[10px] text-muted-foreground">
                showing {truncation.shown} of {truncation.total} steps
              </p>
            )}
          </div>
        )
      }
    />
  );
};
