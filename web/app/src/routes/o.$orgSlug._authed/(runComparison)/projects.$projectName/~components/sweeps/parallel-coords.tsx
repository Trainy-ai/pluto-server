import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { vegaConfig } from "@/lib/vega-theme";
import { cn } from "@/lib/utils";

/** A dragged range on one axis, in normalised 0-1 space. */
interface Brush {
  key: string;
  from: number;
  to: number;
}

interface ParallelCoordsProps {
  runs: {
    runId: string;
    name: string;
    config: Record<string, unknown>;
    metricValue: number | null;
  }[];
  /** Config keys to draw as axes, left to right. */
  sweptKeys: string[];
  metricName: string | null;
  goal: string;
  /** Told the parent which runs survive the brush, so the table can follow. */
  onFilterChange?: (visibleRunIds: string[] | null) => void;
  className?: string;
}

/** One row per (run, axis) — Vega folds the wide run record into this. */
interface PlotRow {
  runId: string;
  name: string;
  key: string;
  /** Axis position as a number — see the note on the x encoding. */
  xIndex: number;
  /** Position on this axis, normalised to 0-1 (see below). */
  norm: number;
  /** The real value, for the tooltip. */
  raw: number | string;
  metric: number | null;
}

/** The named dataset the live view is updated through — see the embed effect. */
const DATASET = "sweepRuns";

/** Minimal surface of the Vega view we drive. */
interface VegaView {
  finalize: () => void;
  data: (name: string, values: unknown[]) => VegaView;
  run: () => void;
  addSignalListener: (name: string, cb: (n: string, v: unknown) => void) => void;
  signal: (name: string, value: unknown) => VegaView;
}

/**
 * Parallel-coordinates plot of a sweep: one line per run, crossing an axis per
 * swept hyperparameter and ending on the objective metric.
 *
 * Axes are normalised to 0-1 independently and drawn as a single line mark,
 * which is how Vega's own parallel-coordinates example works — the alternative
 * (a real multi-axis chart) is not something Vega-Lite expresses. The cost is
 * that the y-axis ticks are meaningless, so they are hidden and the actual
 * values live in the tooltip and the per-axis min/max labels.
 *
 * Categorical params (a string-valued knob like an optimizer name) are ranked
 * by sorted position rather than skipped, so `adam`/`sgd` still gets an axis.
 */
export function ParallelCoords({
  runs,
  sweptKeys,
  metricName,
  goal,
  onFilterChange,
  className,
}: ParallelCoordsProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<VegaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brushes, setBrushes] = useState<Brush[]>([]);
  // Vega fires the brush signal on every pointer move. Coalescing to one
  // update per frame keeps a drag from queueing ~30 React renders.
  const brushFrame = useRef<number | null>(null);
  const { resolvedTheme } = useTheme();

  // Every axis: the swept params, then the objective on the right, which is the
  // convention that makes the chart readable — you follow a line rightwards to
  // see what its settings produced.
  const axes = useMemo(
    () => (metricName ? [...sweptKeys, metricName] : sweptKeys),
    [sweptKeys, metricName],
  );

  const { rows, ranges, runIds, positions } = useMemo(() => {
    const ranges = new Map<string, { min: number; max: number; labels?: string[] }>();

    // Per-axis scale first: normalisation needs the whole column before any
    // single point can be placed.
    for (const key of axes) {
      const values = runs.map((run) =>
        key === metricName ? run.metricValue : run.config[key],
      );
      let present = 0;
      const numeric: number[] = [];
      for (const value of values) {
        if (value == null) {
          continue;
        }
        present++;
        if (typeof value === "number") {
          numeric.push(value);
        }
      }

      if (numeric.length === present && numeric.length > 0) {
        ranges.set(key, { min: Math.min(...numeric), max: Math.max(...numeric) });
      } else {
        // Categorical: rank the distinct values so the axis still means
        // something. A single label leaves min === max, which the span check
        // below centres — the same treatment a constant numeric axis gets.
        const labels = [...new Set(values.filter((v) => v != null).map(String))].sort();
        ranges.set(key, { min: 0, max: Math.max(labels.length - 1, 0), labels });
      }
    }

    const rows: PlotRow[] = [];
    const runIds: string[] = [];
    // `runId → axis key → norm`, so the brush filter is a pair of map lookups
    // rather than a linear scan of `rows` per (run, brush) — that scan made
    // filtering O(runs^2 x axes) on a path that reruns every animation frame.
    const positions = new Map<string, Map<string, number>>();

    for (const run of runs) {
      runIds.push(run.runId);
      const byKey = new Map<string, number>();
      positions.set(run.runId, byKey);

      for (let xIndex = 0; xIndex < axes.length; xIndex++) {
        const key = axes[xIndex];
        const value = key === metricName ? run.metricValue : run.config[key];
        if (value == null) {
          continue;
        }
        const range = ranges.get(key)!;
        const position = range.labels
          ? range.labels.indexOf(String(value))
          : (value as number);
        const span = range.max - range.min;
        // A constant axis (span 0) sits in the middle rather than dividing by
        // zero — happens whenever a declared param wasn't actually varied.
        const norm = span === 0 ? 0.5 : (position - range.min) / span;
        byKey.set(key, norm);
        rows.push({
          runId: run.runId,
          name: run.name,
          key,
          xIndex,
          norm,
          raw: range.labels ? String(value) : (value as number),
          metric: run.metricValue,
        });
      }
    }
    return { rows, ranges, runIds, positions };
  }, [runs, axes, metricName]);

  // Deliberately *not* keyed on `rows`. The view is rebuilt whenever this
  // changes, and a rebuild destroys the brush; keeping data out of it means a
  // background refetch (react-query refetches on window focus after 30s) pushes
  // new numbers into the live view instead of wiping the user's selection.
  const spec = useMemo(() => {
    return {
      $schema: "https://vega.github.io/schema/vega-lite/v6.json",
      // Named, so `view.data(DATASET, ...)` can address it. With an inline
      // `data: {values}` the compiled dataset name is an implementation detail
      // of the Vega-Lite compiler (`source_0`) and not safe to depend on.
      datasets: { [DATASET]: [] as PlotRow[] },
      data: { name: DATASET },
      width: "container",
      height: 300,
      layer: [
        {
          // Selection params must live on a unit spec, not the top of a layered
          // one — Vega-Lite rejects the spec outright otherwise.
          params: [
            {
              name: "brush",
              select: { type: "interval", encodings: ["x", "y"] },
            },
          ],
          mark: { type: "line", strokeWidth: 2, opacity: 0.8, point: true },
          encoding: {
            // Quantitative rather than ordinal, with the axis names supplied as
            // tick labels. An interval brush cannot select over a band scale, so
            // an ordinal x renders correctly but silently refuses to brush —
            // which is how Vega's own parallel-coordinates example does it too.
            x: {
              field: "xIndex",
              type: "quantitative",
              title: null,
              scale: { domain: [-0.08, axes.length - 0.92], nice: false },
              axis: {
                values: axes.map((_, index) => index),
                labelExpr: `${JSON.stringify(axes)}[datum.value]`,
                labelAngle: 0,
                labelFontWeight: "bold",
                grid: true,
                tickCount: axes.length,
              },
            },
            y: {
              field: "norm",
              type: "quantitative",
              title: null,
              // Ticks would read 0-1 on every axis, which is a lie about the
              // underlying values; the tooltip carries the real numbers.
              axis: null,
              scale: { domain: [0, 1] },
            },
            detail: { field: "runId", type: "nominal" },
            color: metricName
              ? {
                  field: "metric",
                  type: "quantitative",
                  title: metricName,
                  scale: {
                    scheme: "viridis",
                    // Low = good when minimising, so flip the ramp to keep
                    // "bright means better" true either way.
                    reverse: goal === "minimize",
                  },
                }
              : { value: "#60a5fa" },
            tooltip: [
              { field: "name", type: "nominal", title: "run" },
              { field: "key", type: "nominal", title: "param" },
              { field: "raw", type: "nominal", title: "value" },
              ...(metricName
                ? [{ field: "metric", type: "quantitative", title: metricName }]
                : []),
            ],
          },
        },
      ],
    };
  }, [axes, metricName, goal]);

  // Which runs pass every active brush. Null means "no brush, show all".
  const visibleRunIds = useMemo(() => {
    if (brushes.length === 0) {
      return null;
    }
    return runIds.filter((runId) => {
      const byKey = positions.get(runId);
      if (!byKey) {
        return false;
      }
      return brushes.every((brush) => {
        const norm = byKey.get(brush.key);
        // A run with no value on a brushed axis cannot satisfy that constraint.
        return norm != null && norm >= brush.from && norm <= brush.to;
      });
    });
  }, [brushes, runIds, positions]);

  useEffect(() => {
    onFilterChange?.(visibleRunIds);
  }, [visibleRunIds, onFilterChange]);

  // The rows the view should be showing. Read from a ref by the embed effect so
  // a freshly-created view starts populated without re-running on data change.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Not `rows` itself — only whether there are any. The host div is unmounted
  // by the empty state below, so the embed has to rerun when it comes back,
  // but a *change* to the rows must not rebuild the view.
  const hasRows = rows.length > 0;

  useEffect(() => {
    let disposed = false;
    let view: VegaView | null = null;
    setError(null);
    // A rebuild wipes Vega's selection rectangle. Drop the mirrored brush with
    // it, or the table below stays dimmed by a filter with nothing on screen
    // to explain or undo it.
    setBrushes((prev) => (prev.length === 0 ? prev : []));

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
        viewRef.current = view;
        view.data(DATASET, rowsRef.current);
        view.run();

        // Read the brush out of Vega rather than filtering the chart's data:
        // Vega draws the selection rectangle itself, and this only mirrors it
        // into React so the run table can follow.
        view.addSignalListener("brush", (_name, value) => {
          if (brushFrame.current != null) {
            cancelAnimationFrame(brushFrame.current);
          }
          brushFrame.current = requestAnimationFrame(() => applyBrush(value));
        });

        const applyBrush = (value: unknown) => {
          const selection = value as
            | { xIndex?: number[]; norm?: number[] }
            | undefined;
          const xs = selection?.xIndex;
          const extent = selection?.norm;
          if (!xs || xs.length !== 2 || !extent || extent.length !== 2) {
            setBrushes((prev) => (prev.length === 0 ? prev : []));
            return;
          }
          const [from, to] = [Math.min(...extent), Math.max(...extent)];
          const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
          // Every axis whose tick falls inside the horizontal extent. Dragging
          // across two axes constrains both, which is how you narrow to a
          // corner of the space.
          let keys = axes.filter((_, index) => index >= lo && index <= hi);
          if (keys.length === 0) {
            // A drag that covers no tick — a near-vertical one on an axis, or a
            // small one in the gutter between two. Snap to the nearest axis
            // rather than doing nothing (unusable) or constraining every axis
            // within half a tick (which used to select *both* neighbours from
            // one flick in the gutter).
            const centre = (lo + hi) / 2;
            const nearest = Math.round(centre);
            if (nearest >= 0 && nearest < axes.length) {
              keys = [axes[nearest]];
            }
          }
          // Vega re-emits the signal on every pointer move; without this a
          // stationary drag allocates a fresh brush array 60 times a second and
          // re-renders the whole sweep page with each one.
          setBrushes((prev) =>
            prev.length === keys.length &&
            prev.every(
              (brush, i) =>
                brush.key === keys[i] && brush.from === from && brush.to === to,
            )
              ? prev
              : keys.map((key) => ({ key, from, to })),
          );
        };
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      viewRef.current = null;
      if (brushFrame.current != null) {
        cancelAnimationFrame(brushFrame.current);
      }
      view?.finalize();
    };
    // Theme rebuilds the view: the config is baked in at embed time.
  }, [spec, resolvedTheme, hasRows]);

  // New numbers go into the existing view. No rebuild, so an active brush and
  // its selection rectangle both survive a background refetch.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.data(DATASET, rows);
    view.run();
  }, [rows]);

  const clearBrush = useCallback(() => {
    setBrushes([]);
    const view = viewRef.current;
    if (!view) {
      return;
    }
    // React state alone left Vega's interval rectangle drawn with nothing
    // selected — the table undimmed but the chart still showed a brush.
    view.data("brush_store", []);
    view.signal("brush", null);
    view.run();
  }, []);

  if (rows.length === 0) {
    return (
      <div
        className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
        data-testid="sweep-parallel-coords-empty"
      >
        No swept parameters to plot — every run in this sweep used the same
        configuration.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[300px] items-center justify-center text-xs text-destructive">
        Could not render chart: {error}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} data-testid="sweep-parallel-coords">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        {visibleRunIds ? (
          <>
            <span data-testid="sweep-brush-count">
              <span className="font-medium text-foreground">
                {visibleRunIds.length}
              </span>{" "}
              of {runIds.length} runs in selection
            </span>
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={clearBrush}
              data-testid="sweep-brush-clear"
            >
              clear
            </button>
          </>
        ) : (
          <span>Drag across an axis to filter the runs below.</span>
        )}
      </div>
      <div ref={hostRef} className="w-full" />
      {/* One equal column per axis, centred — `justify-between` pinned the
          first and last to the container edges instead of under their axis,
          which made it unclear which range belonged to which. */}
      <div
        className="mt-1 grid px-1 text-center text-[10px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${axes.length}, minmax(0, 1fr))` }}
      >
        {axes.map((key) => {
          const range = ranges.get(key);
          return (
            <span key={key} className="font-mono">
              {range?.labels
                ? `${range.labels.length} values`
                : `${fmt(range?.min)}–${fmt(range?.max)}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function fmt(value: number | undefined) {
  if (value == null) return "—";
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(3)).toString();
}
