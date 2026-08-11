import { useMemo } from "react";
import { MultiLineChart } from "../multi-group/line-chart-multi";
import { cn } from "@/lib/utils";
import { selectSweepChartMetrics } from "./sweep-chart-metrics";
import { MAX_RUNS_PER_BATCH } from "@/lib/batch-limits";

interface SweepMetricChartsProps {
  runs: { runId: string; name: string }[];
  runColors: Map<string, string>;
  /** Metrics the sweep's runs logged, from the sweep proc. */
  availableMetrics: string[];
  /** The objective — pinned first so it's never the one the cap drops.
   *  Null when the sweep declares no metric; the curves still render. */
  metricName: string | null;
  organizationId: string;
  projectName: string;
  className?: string;
}

/**
 * Per-run metric curves for a sweep, the equivalent of the workspace charts a
 * sweep shows elsewhere: one line per run, coloured to match the runs table
 * above it.
 */
export function SweepMetricCharts({
  runs,
  runColors,
  availableMetrics,
  metricName,
  organizationId,
  projectName,
  className,
}: SweepMetricChartsProps) {
  const metrics = useMemo(
    () => selectSweepChartMetrics(availableMetrics, metricName),
    [availableMetrics, metricName],
  );

  const lines = useMemo(
    () =>
      runs.map((run) => ({
        runId: run.runId,
        runName: run.name,
        color: runColors.get(run.runId) ?? "#60a5fa",
      })),
    [runs, runColors],
  );

  if (metrics.length === 0 || lines.length === 0) return null;

  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h2 className="text-xs font-medium text-muted-foreground">
        Metrics across this sweep&apos;s runs
      </h2>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {metrics.map((metric) => (
          <div
            key={metric}
            className="h-[260px] rounded-lg border p-3"
            data-testid={`sweep-metric-chart-${metric}`}
          >
            <MultiLineChart
              lines={lines}
              title={metric}
              xlabel="step"
              organizationId={organizationId}
              projectName={projectName}
              // Sweep pages are read after the fact; the summary bar already
              // states whether anything is still running.
              allRunsCompleted
              // A sweep's run set is its tag membership — there is no selection
              // to reduce, so the notice's default remedy would send the user
              // hunting for a control that doesn't exist here. Say what is
              // actually true instead.
              limitHint={
                lines.length > MAX_RUNS_PER_BATCH
                  ? `This sweep has ${lines.length} runs; charts cover at most ${MAX_RUNS_PER_BATCH}.`
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
