import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { vegaConfig } from "@/lib/vega-theme";
import { cn } from "@/lib/utils";

interface SweepProgressProps {
  runs: {
    runId: string;
    name: string;
    createdAt: string | Date;
    metricValue: number | null;
  }[];
  metricName: string | null;
  goal: string;
  className?: string;
}

/** The named dataset the live view is updated through — see the embed effect. */
const DATASET = "sweepProgress";

/** Minimal surface of the Vega view we drive. */
interface VegaView {
  finalize: () => void;
  data: (name: string, values: unknown[]) => VegaView;
  run: () => void;
}

/**
 * Did the sweep keep improving, or has it plateaued?
 *
 * One dot per run at the time it started, plus a stepped line tracing the best
 * value found *so far*. The line is the point: a flat tail means later runs
 * stopped beating the incumbent, which is the signal to stop the sweep. The
 * dots alone would only show scatter.
 *
 * "Best so far" follows the sweep's goal, so a maximising sweep gets a
 * running maximum rather than a minimum.
 */
export function SweepProgress({ runs, metricName, goal, className }: SweepProgressProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<VegaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  const rows = useMemo(() => {
    const scored = runs
      .filter((run) => run.metricValue != null)
      .map((run) => ({
        name: run.name,
        created: new Date(run.createdAt).toISOString(),
        value: run.metricValue as number,
      }))
      // Chronological, because "so far" is only meaningful in run order. The
      // server already orders by createdAt; this is belt and braces, and plain
      // comparison beats localeCompare on ISO strings, which are pure ASCII.
      .sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));

    let best: number | null = null;
    return scored.map((row) => {
      best =
        best == null
          ? row.value
          : goal === "maximize"
            ? Math.max(best, row.value)
            : Math.min(best, row.value);
      return { ...row, best };
    });
  }, [runs, goal]);

  // Deliberately *not* keyed on `rows` — see the embed effect. A named, empty
  // dataset is filled from the live view instead, so a background refetch does
  // not tear the chart down and rebuild it.
  const spec = useMemo(
    () => ({
      $schema: "https://vega.github.io/schema/vega-lite/v6.json",
      datasets: { [DATASET]: [] as unknown[] },
      data: { name: DATASET },
      width: "container",
      height: 260,
      // `width: "container"` measures the parent, but the axis chrome was being
      // laid out OUTSIDE that box and clipped by the canvas: y labels lost their
      // "0." prefix to the left edge and x labels were cut off below it.
      //
      // "fit" makes width/height the OUTER box, and the explicit padding is what
      // reserves room for the chrome. Vega sizes padding from the axis extents
      // it measures at layout time — and this view lays out while its named
      // dataset is still empty (see the embed effect), so those extents are
      // near-zero and the labels have nowhere to go. Fixed padding sidesteps
      // that ordering entirely.
      autosize: { type: "fit", contains: "padding" },
      padding: { left: 54, right: 10, top: 6, bottom: 54 },
      encoding: {
        x: {
          field: "created",
          type: "temporal",
          title: null,
          axis: { format: "%H:%M:%S", labelAngle: -35 },
        },
      },
      layer: [
        {
          // Best-so-far, drawn first so the dots sit on top of it.
          mark: { type: "line", interpolate: "step-after", strokeWidth: 2, color: "#38bdf8" },
          encoding: {
            y: {
              field: "best",
              type: "quantitative",
              title: metricName ?? "metric",
              scale: { zero: false },
            },
            tooltip: [
              { field: "best", type: "quantitative", title: `best ${metricName ?? ""}` },
            ],
          },
        },
        {
          mark: { type: "point", filled: true, size: 70, opacity: 0.9 },
          encoding: {
            y: { field: "value", type: "quantitative", scale: { zero: false } },
            color: {
              field: "value",
              type: "quantitative",
              legend: null,
              // Same convention as the parallel-coords chart: bright is better.
              scale: { scheme: "viridis", reverse: goal === "minimize" },
            },
            tooltip: [
              { field: "name", type: "nominal", title: "run" },
              { field: "value", type: "quantitative", title: metricName ?? "metric" },
              { field: "created", type: "temporal", title: "started" },
            ],
          },
        },
      ],
      resolve: { scale: { y: "shared" } },
    }),
    [metricName, goal],
  );

  // Read by the embed effect so a freshly-created view starts populated without
  // the effect having to depend on the data.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Only whether there are any rows: the host div is unmounted by the empty
  // state below, so the embed must rerun when it returns.
  const hasRows = rows.length > 0;

  useEffect(() => {
    let disposed = false;
    let view: VegaView | null = null;
    let resizeObserver: ResizeObserver | null = null;
    // Otherwise one transient failure to load the Vega chunk latches the
    // component into its error state until it unmounts.
    setError(null);

    (async () => {
      try {
        const { default: embed } = await import("vega-embed");
        if (disposed || !hostRef.current) return;
        const result = await embed(hostRef.current, spec as never, {
          actions: false,
          renderer: "canvas",
          config: vegaConfig(resolvedTheme) as never,
        });
        if (disposed) {
          result.view.finalize();
          return;
        }
        view = result.view as unknown as VegaView;
        // `width: "container"` is measured once at embed time. Without this a
        // narrowed window leaves the canvas at its old width (the clamp above
        // then scales it down rather than re-laying it out).
        if (hostRef.current && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            try {
              (view as unknown as { resize: () => { run: () => void } })
                .resize()
                .run();
            } catch {
              // A finalized view throws; the cleanup below owns teardown.
            }
          });
          resizeObserver.observe(hostRef.current);
        }
        viewRef.current = view;
        view.data(DATASET, rowsRef.current);
        view.run();
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      viewRef.current = null;
      view?.finalize();
    };
  }, [spec, resolvedTheme, hasRows]);

  // New numbers into the existing view rather than a rebuild.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.data(DATASET, rows);
    view.run();
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div
        className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
        data-testid="sweep-progress-empty"
      >
        No runs have logged this metric yet.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[260px] items-center justify-center text-xs text-destructive">
        Could not render chart: {error}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} data-testid="sweep-progress">
      <h2 className="mb-1 text-xs font-medium text-muted-foreground">
        {metricName ?? "metric"} over time
        <span className="ml-2 font-normal">
          (line = best so far, {goal === "maximize" ? "highest" : "lowest"})
        </span>
      </h2>
      {/* [&_canvas]:!max-w-full — Vega sizes the canvas in pixels when the
          view is created and does not shrink it when the container does.
          Radix's scroll viewport wraps the page in a `display: table` box,
          which shrink-wraps to CONTENT, so one oversized canvas widens the
          whole page and the viewport's overflow-x:hidden then clips every
          row at the same edge — while document.scrollWidth still reports no
          overflow. Same guard the custom-chart viewer already uses. */}
      <div ref={hostRef} className="w-full [&_canvas]:!max-w-full" />
    </div>
  );
}
