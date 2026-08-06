import { useMemo } from "react";
import LineChartUPlot, { type LineData } from "./line-uplot";
import { cn } from "@/lib/utils";
import { parseChTimeMs } from "./lib/format";

/** One run's string history. */
export interface StringSeriesLine {
  runId: string;
  runName: string;
  color: string;
  steps: number[];
  /** ClickHouse DateTime64(3) text per sample, parallel to `steps`. */
  times?: string[];
  /** Run start, for the Relative Time baseline. Falls back to the first sample. */
  createdAt?: string;
  values: string[];
  /** Label order as the reader saw them, first-appearance first. */
  canonicalLabels: string[];
}

interface StringSeriesChartProps {
  lines: StringSeriesLine[];
  title: string;
  /** Log-scale the step axis. Y has no equivalent — it's a list of labels. */
  logXAxis?: boolean;
  /**
   * Which X axis to plot against, matching the numeric charts' setting.
   * "Absolute Time" uses wall clock, "Relative Time" seconds since the run
   * started, anything else the step number.
   */
  xAxis?: string;
  className?: string;
}

/**
 * A non-numeric (string) metric over steps — `log("phase", "warmup")` — drawn
 * as a staircase.
 *
 * This replaced a coloured band. The band's problem wasn't that it was ugly:
 * it had no x-axis, so the one question it should answer — *at which step did
 * this change?* — was the one thing it couldn't. A chart answers it directly,
 * and being a real chart it also inherits hover, drag-zoom and cross-chart
 * cursor sync, so hovering the loss chart shows which phase the run was in.
 *
 * Categories are mapped to y indices and rendered through the shared uPlot
 * chart with `yCategories` + `stepped`, rather than a bespoke canvas. Stepped
 * matters: a diagonal between "train" and "eval" would imply the run was
 * somewhere in between, and the corner is what puts the transition on a
 * readable step.
 *
 * Belongs in the charts/metrics section, not a separate tab — it is a metric,
 * just one whose values happen to be words.
 */
export function StringSeriesChart({ lines, title, logXAxis, xAxis, className }: StringSeriesChartProps) {

  // One shared category list across runs, in first-appearance order. Per-run
  // ordering would put "train" on a different row in each run and make the
  // comparison meaningless.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const line of lines) {
      for (const label of line.canonicalLabels) {
        if (!seen.includes(label)) seen.push(label);
      }
    }
    return seen;
  }, [lines]);

  const isAbsoluteTime = xAxis === "Absolute Time";
  const isRelativeTime = xAxis === "Relative Time";
  // Time modes need per-sample timestamps. A run migrated before the proc
  // returned them has none, so it stays on steps rather than plotting at epoch.
  const useTime = (isAbsoluteTime || isRelativeTime) && lines.every((l) => l.times?.length);

  const chartLines = useMemo<LineData[]>(() => {
    const index = new Map(categories.map((c, i) => [c, i]));
    return lines.map((line) => {
      let x = line.steps;
      if (useTime && line.times) {
        const ms = line.times.map((t) => parseChTimeMs(t));
        x = isAbsoluteTime
          ? ms
          : // Relative: seconds since the run began. Baselined on the run's
            // start where known, so two runs that started apart still line up
            // at zero — same rule the numeric charts use.
            (() => {
              const baseline = line.createdAt ? new Date(line.createdAt).getTime() : ms[0];
              return ms.map((t) => (t - baseline) / 1000);
            })();
      }
      return {
        label: line.runName,
        runId: line.runId,
        runName: line.runName,
        seriesId: line.runId,
        color: line.color,
        x,
        y: line.values.map((v) => index.get(v) ?? null),
      };
    }) as LineData[];
  }, [lines, categories, useTime, isAbsoluteTime]);

  if (categories.length === 0) {
    return (
      <div
        className={className}
        data-testid="string-series-chart"
      >
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No values recorded
        </div>
      </div>
    );
  }

  return (
    // The plain block wrapper is load-bearing, and mirrors what MultiLineChart
    // puts around the numeric charts.
    //
    // `.fullscreen-chart-area` is a flex container. Rendered as its direct
    // child, the chart root becomes a flex item that can be sized by its own
    // content, which closes a feedback loop: uPlot sizes the canvas from the
    // measured container, the oversized canvas widens the container, and the
    // next measurement agrees. In fullscreen it latched at 1613px inside a
    // 1305px area, so the plot ran on underneath the legend sidebar. A block
    // wrapper is always exactly 100% of its parent, so the measurement can't
    // run away.
    <div className={cn("relative", className)} data-testid="string-series-chart">
      <LineChartUPlot
      lines={chartLines}
      title={title}
      xlabel={useTime ? (isAbsoluteTime ? "time" : "relative time") : "step"}
      isDateTime={useTime && isAbsoluteTime}
      logXAxis={logXAxis}
      // Every numeric chart passes this. Without it the fullscreen view
      // rendered no legend sidebar at all, so a multi-run staircase gave no
      // way to tell which line was which run.
      showLegend
      yCategories={categories}
      stepped
      // A category axis has no meaningful zoom or log scale — the y values
      // are indices, so stretching them says nothing.
      yZoom={false}
      // Missing steps mean "unchanged", not "no data", so the line must carry
      // across them rather than break.
      spanGaps
      className="h-full w-full"
      />
    </div>
  );
}
