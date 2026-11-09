import type uPlot from "uplot";

// ============================
// X-scale refitting
// ============================
//
// Extracted from use-chart-lifecycle.ts (Boy Scout: that file is past 500
// lines). These are pure with respect to React — they read the chart's series
// `show` flags and the aligned data, and drive `setScale("x", …)`.
//
// IMPORTANT for callers: `resetXScale` changes a scale, so the caller must run
// it through `withProgrammaticScale` (flag + batch). The chart's setScale hook
// treats an unflagged X change as a *user zoom* and fires `onZoomRangeChange`,
// which stores a new zoom range. That re-renders the chart component,
// `uplotData` gets a new identity, the chart is recreated, and whatever
// prompted the refit runs again on the new instance — a self-sustaining
// rebuild loop. See `withProgrammaticScale` below for why the batch is as
// load-bearing as the flag.

/**
 * Compute the X-axis range considering only visible (non-hidden) series.
 * Returns null if no visible series have data — caller should fall back to
 * the full range.
 */
export function getVisibleXRange(
  chart: uPlot,
  data: uPlot.AlignedData,
): [number, number] | null {
  const xVals = data[0] as number[];
  if (!xVals || xVals.length === 0) return null;

  let minIdx = -1;
  let maxIdx = -1;

  for (let xi = 0; xi < xVals.length; xi++) {
    for (let si = 1; si < data.length; si++) {
      if (!chart.series[si]?.show) continue;
      const v = (data[si] as (number | null)[])[xi];
      if (v !== null && v !== undefined) {
        if (minIdx === -1) minIdx = xi;
        maxIdx = xi;
        break; // Found a visible value at this x, no need to check more series
      }
    }
  }

  if (minIdx === -1) return null;
  return [xVals[minIdx], xVals[maxIdx]];
}

/**
 * Reset the X-axis scale, respecting globalXRange if set, otherwise fitting to
 * visible (non-hidden) series data with a full-range fallback.
 *
 * Callers must wrap this in the programmatic-scale flag — see the module note.
 */
export function resetXScale(
  chart: uPlot,
  data: uPlot.AlignedData,
  globalRange: [number, number] | null,
): void {
  const range = pickResetRange(chart, data, globalRange);
  if (!range) return;
  const [min, max] = padDegenerateXRange(range[0], range[1], xScaleKind(chart));
  chart.setScale("x", { min, max });
}

function pickResetRange(
  chart: uPlot,
  data: uPlot.AlignedData,
  globalRange: [number, number] | null,
): [number, number] | null {
  if (globalRange) return globalRange;
  const visibleRange = getVisibleXRange(chart, data);
  if (visibleRange) return visibleRange;
  const xVals = data[0] as number[];
  if (xVals && xVals.length > 0) return [xVals[0], xVals[xVals.length - 1]];
  return null;
}

/** How an X scale measures distance, which decides how to pad it. */
export type XScaleKind = "linear" | "log" | "time";

/** One minute in ms — datetime X values are epoch milliseconds. */
const TIME_PAD_MS = 60_000;

/**
 * Widen a zero-width X range around its point; pass any real range through.
 *
 * Every data-derived `setScale("x", …)` must go through this. uPlot assigns an
 * explicit min/max verbatim — the scale's `range` callback is skipped — so a
 * single-step series (every run logged the metric once) hands it min === max.
 * `findIncr` then sees a delta of 0, accepts its smallest increment (1e-16 for
 * a one-digit value), and `numAxisSplits` loops `val += incr` where
 * `6 + 1e-16 === 6`: `splits.push(6)` until V8's array cap at ~1 GB, which
 * throws "Invalid array length" or OOMs the renderer outright.
 *
 * The padding follows the axis, because the reset and double-click paths are
 * not gated on axis type:
 *   - linear: ±max(|x|·0.5, 1) — the framing the chart already gave a lone
 *     point on first render, so a reset lands where the initial view did.
 *   - log: [x/2, 2x]. Additive padding can reach 0 (x=1 → [0, 2]), and an
 *     explicit log min of 0 is uPlot's other infinite loop (scales-config).
 *   - time: ±1 minute. Half an epoch timestamp would span decades.
 */
export function padDegenerateXRange(
  min: number,
  max: number,
  kind: XScaleKind = "linear",
): [number, number] {
  if (min !== max) return [min, max];
  if (kind === "log") {
    return min > 0 ? [min / 2, min * 2] : [min, max];
  }
  if (kind === "time") {
    return [min - TIME_PAD_MS, max + TIME_PAD_MS];
  }
  const padding = Math.max(Math.abs(min) * 0.5, 1);
  return [min - padding, max + padding];
}

/** Read the X scale's kind off a live chart; linear until uPlot has built it. */
export function xScaleKind(chart: uPlot): XScaleKind {
  const x = chart.scales?.x;
  if (x?.distr === 3) return "log";
  if (x?.time) return "time";
  return "linear";
}

/**
 * Run `fn` with the programmatic-scale flag raised, restoring it afterwards
 * even if `fn` throws.
 *
 * Every scale change this app drives itself must go through here (or the
 * equivalent inline try/finally + `chart.batch`). An unflagged change is
 * indistinguishable from a user zoom to the setScale hook.
 *
 * `fn` runs inside `chart.batch()`, and that is load-bearing rather than an
 * optimisation. A bare `chart.setScale(...)` only queues uPlot's `_commit` on
 * a *microtask* (uPlot.esm.js `commit()`), so the `setScale` hooks fire long
 * after this function's `finally` has already lowered the flag — the guard
 * silently does nothing and the hook reads the change as a user zoom.
 * `batch()` calls `_commit()` synchronously, so the hooks fire while the flag
 * is still raised.
 */
export function withProgrammaticScale(
  chart: uPlot,
  flagRef: { current: boolean },
  fn: () => void,
): void {
  try {
    flagRef.current = true;
    chart.batch(fn);
  } finally {
    flagRef.current = false;
  }
}
