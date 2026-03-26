import uPlot from "uplot";
import { computeFallbackRange } from "./scales";

interface ScalesConfigParams {
  logXAxis: boolean;
  logYAxis: boolean;
  isDateTime: boolean;
  yMinProp: number | undefined | null;
  yMaxProp: number | undefined | null;
  yRange: [number, number, boolean];
}

/**
 * Build uPlot scales configuration for X and Y axes.
 *
 * X-axis always uses auto:true so zoom (drag-to-select) works.
 * Global X range is applied AFTER chart creation via setScale().
 *
 * Y-axis supports: auto-scale, manual bounds (yMinProp/yMaxProp),
 * outlier-aware range (yRange[2]), and log scale (distr: 3).
 */
export function buildScalesConfig({
  logXAxis,
  logYAxis,
  isDateTime,
  yMinProp,
  yMaxProp,
  yRange,
}: ScalesConfigParams): uPlot.Scales {
  return {
    x: logXAxis
      ? { distr: 3 }
      : isDateTime
        ? { time: true, auto: true }
        : { auto: true },
    y: logYAxis
      ? (yMinProp != null || yMaxProp != null)
        ? {
            distr: 3,
            auto: false,
            range: (u: uPlot, dataMin: number | null, dataMax: number | null): uPlot.Range.MinMax => {
              if (dataMin == null || dataMax == null) {
                const fallback = computeFallbackRange(u, true);
                if (!fallback) { return [yMinProp ?? 1, yMaxProp ?? 10]; }
                [dataMin, dataMax] = fallback;
              }
              let lo = yMinProp ?? dataMin;
              let hi = yMaxProp ?? dataMax;
              // Clamp to positive for log scale (log10(0) crashes tick generator)
              if (lo <= 0) { lo = dataMin > 0 ? dataMin : 1e-6; }
              if (hi <= 0) { hi = 10; }
              if (lo >= hi) { hi = lo * 10 || 10; }
              return [lo, hi];
            },
          }
        : { distr: 3 }
      : (yMinProp != null || yMaxProp != null)
        ? {
            auto: false,
            range: (u: uPlot, dataMin: number | null, dataMax: number | null): uPlot.Range.MinMax => {
              if (dataMin == null || dataMax == null) {
                const fallback = computeFallbackRange(u, false);
                if (!fallback) { return [yMinProp ?? 0, yMaxProp ?? 1]; }
                [dataMin, dataMax] = fallback;
              }
              const range = dataMax - dataMin;
              const padding = Math.max(range * 0.05, Math.abs(dataMax) * 0.02, 0.1);
              const autoMin = dataMin >= 0 ? Math.max(0, dataMin - padding) : dataMin - padding;
              const autoMax = dataMax + padding;
              let lo = yMinProp ?? autoMin;
              let hi = yMaxProp ?? autoMax;
              // Prevent axis flip when user-set min >= auto-computed max
              if (lo >= hi) { hi = lo + Math.max(Math.abs(lo) * 0.1, padding, 0.1); }
              return [lo, hi];
            },
          }
        : yRange[2]
          ? {
              auto: false,
              range: (): uPlot.Range.MinMax => [yRange[0], yRange[1]],
            }
          : { auto: true },
  };
}

/**
 * Build uPlot cursor configuration with sync and drag settings.
 */
export function buildCursorConfig(
  effectiveSyncKey: string,
  yZoom: boolean,
): uPlot.Cursor {
  return {
    sync: {
      key: effectiveSyncKey,
      // IMPORTANT: Do NOT sync scales via uPlot's built-in mechanism.
      // It syncs ALL charts with the same key regardless of zoom group,
      // causing Step zoom to leak to Relative Time charts. Our custom
      // syncXScale handles zoom sync with proper group filtering.
      scales: [null, null],
      setSeries: false, // DISABLED - was causing seriesIdx to always be null due to cross-chart sync
      // Prevent mousedown/mouseup from syncing to avoid uPlot crash:
      // synced mousedown sets `dragging = true` on receiving charts, which
      // causes `src.scales[xKeySrc].ori` to crash when xKeySrc is null
      // (from scales: [null, null] above). Blocking these events keeps
      // receiving charts' `dragging` flag false so the crash path is never
      // reached. Cursor position sync (mousemove) still works; drag/zoom
      // sync is handled by our custom syncXScale.
      filters: {
        pub: (type: string) => type !== "mousedown" && type !== "mouseup",
        sub: () => true,
      },
    },
    focus: {
      prox: -1, // Always highlight the closest series regardless of distance
    },
    drag: {
      x: true,
      y: yZoom,
      ...(yZoom && { uni: Infinity }),
      setScale: true,
    },
  };
}
