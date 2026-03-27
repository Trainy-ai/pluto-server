import uPlot from "uplot";
import { toast } from "sonner";
import type { LineData } from "./types";

interface SetScaleHookParams {
  logYAxis: boolean;
  logXAxis: boolean;
  yMinProp: number | undefined | null;
  yMaxProp: number | undefined | null;
  isProgrammaticScaleRef: React.RefObject<boolean>;
  chartSyncContextRef: React.RefObject<any>;
  isZoomSourceChart: () => boolean;
  chartId: string;
  zoomGroup: string;
  userHasZoomedRef: React.MutableRefObject<boolean>;
  userHasZoomedYRef: React.MutableRefObject<boolean>;
  userYZoomRangeRef: React.MutableRefObject<[number, number] | null>;
  isXZoomAutoRangeRef: React.MutableRefObject<boolean>;
  onYZoomRangeChangeRef: React.RefObject<((range: [number, number] | null) => void) | undefined>;
  noDataToastShownRef: React.MutableRefObject<string | null>;
  processedLinesRef: React.RefObject<LineData[]>;
  spanGapsRef: React.RefObject<boolean>;
  zoomRangeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onZoomRangeChangeRef: React.RefObject<((range: [number, number] | null) => void) | undefined>;
}

/**
 * Build the uPlot setScale hook that handles:
 * - Zoom sync across charts via context
 * - Y-axis auto-rescaling on X zoom (or Y-zoom preservation via microtask)
 * - "No data in view" toast notification
 * - Zoom-aware re-downsampling
 * - Zoom range change callback for server re-fetch
 */
export function buildSetScaleHook({
  logYAxis,
  logXAxis,
  yMinProp,
  yMaxProp,
  isProgrammaticScaleRef,
  chartSyncContextRef,
  isZoomSourceChart,
  chartId,
  zoomGroup,
  userHasZoomedRef,
  userHasZoomedYRef,
  userYZoomRangeRef,
  isXZoomAutoRangeRef,
  onYZoomRangeChangeRef,
  noDataToastShownRef,
  processedLinesRef,
  spanGapsRef,
  zoomRangeTimerRef,
  onZoomRangeChangeRef,
}: SetScaleHookParams): (u: uPlot, scaleKey: string) => void {
  return (u: uPlot, scaleKey: string) => {
    // Handle X-axis scale changes (zoom)
    if (scaleKey === "x") {
      const xMin = u.scales.x.min;
      const xMax = u.scales.x.max;
      if (xMin == null || xMax == null) return;

      // Capture sync state BEFORE syncXScale modifies it.
      // syncXScale sets isSyncingZoomRef=true synchronously and resets it
      // via setTimeout(0), so later code in this same hook invocation would
      // see the flag as true and incorrectly skip. Snapshot it here.
      const isProgrammatic = isProgrammaticScaleRef.current;
      const isSyncing = chartSyncContextRef.current?.isSyncingZoomRef?.current ?? false;

      // ZOOM SYNC: Broadcast X scale to other charts via context
      // Only sync if this is a user-initiated zoom (drag), not a programmatic scale change.
      // Programmatic changes (chart init, zoom sync from context, syncXScale propagation)
      // must not broadcast back to context as that corrupts syncedZoomRange for other charts.
      // Also skip when syncXScale is propagating to this chart (isSyncingZoomRef) -
      // without this, target charts re-broadcast during scroll when isActiveChart() is true.
      if (!isProgrammatic && !isSyncing && isZoomSourceChart()) {
        chartSyncContextRef.current?.syncXScale(chartId, xMin, xMax);
        // Mark that user has manually zoomed (prevents global range from overwriting)
        userHasZoomedRef.current = true;
        // Store zoom in context so newly mounted charts use the same zoom
        // Include zoomGroup so only charts with compatible x-axis types apply it
        chartSyncContextRef.current?.setSyncedZoomRange([xMin, xMax], zoomGroup);
        // Debug: log when zoom is stored in context
        if (process.env.NODE_ENV === 'development') {
          console.log(`[uPlot ${chartId}] Zoom applied, storing in context: [${xMin}, ${xMax}] group=${zoomGroup}`);
        }
      }

      // Auto-scale Y axis when X scale changes (zoom).
      // Deferred to rAF to avoid blocking the mouseup handler — the Y range
      // computation scans all series×points and is expensive with 95+ series.
      if (userHasZoomedYRef.current && userYZoomRangeRef.current) {
        const [savedYMin, savedYMax] = userYZoomRangeRef.current;
        isXZoomAutoRangeRef.current = true;
        queueMicrotask(() => {
          isXZoomAutoRangeRef.current = false;
          try {
            isProgrammaticScaleRef.current = true;
            u.setScale("y", { min: savedYMin, max: savedYMax });
          } finally {
            isProgrammaticScaleRef.current = false;
          }
        });
      } else if (!userHasZoomedYRef.current && (!logYAxis || (logYAxis && (yMinProp != null || yMaxProp != null)))) {
        // Defer Y-range scan + no-data check to rAF so mouseup stays fast
        requestAnimationFrame(() => {
          // Combined single-pass scan: find visible Y range AND check for any data
          let visibleYMin = Infinity;
          let visibleYMax = -Infinity;
          let hasVisibleData = false;

          const xData = u.data[0] as number[];
          // Binary search for the start of the visible range (xData is sorted)
          let startIdx = 0;
          let lo = 0;
          let hi = xData.length - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (xData[mid] < xMin) { lo = mid + 1; } else { hi = mid - 1; }
          }
          startIdx = lo;

          for (let i = startIdx; i < xData.length; i++) {
            const x = xData[i];
            if (x > xMax) break; // Past visible range
            for (let si = 1; si < u.data.length; si++) {
              const y = (u.data[si] as (number | null)[])[i];
              if (y != null) {
                hasVisibleData = true;
                if (Number.isFinite(y)) {
                  if (y < visibleYMin) visibleYMin = y;
                  if (y > visibleYMax) visibleYMax = y;
                }
              }
            }
          }

          // Update Y scale if we found valid data
          if (visibleYMin !== Infinity && visibleYMax !== -Infinity) {
            let newYMin: number;
            let newYMax: number;

            if (logYAxis) {
              newYMin = visibleYMin;
              newYMax = visibleYMax;
            } else {
              const range = visibleYMax - visibleYMin;
              const padding = Math.max(range * 0.05, Math.abs(visibleYMax) * 0.02, 0.1);
              newYMin = visibleYMin >= 0 ? Math.max(0, visibleYMin - padding) : visibleYMin - padding;
              newYMax = visibleYMax + padding;
            }

            if (yMinProp != null) newYMin = yMinProp;
            if (yMaxProp != null) newYMax = yMaxProp;

            const currentYMin = u.scales.y.min ?? 0;
            const currentYMax = u.scales.y.max ?? 1;
            const threshold = (currentYMax - currentYMin) * 0.01;

            if (Math.abs(newYMin - currentYMin) > threshold ||
                Math.abs(newYMax - currentYMax) > threshold) {
              try {
                isProgrammaticScaleRef.current = true;
                u.setScale("y", { min: newYMin, max: newYMax });
              } finally {
                isProgrammaticScaleRef.current = false;
              }
            }
          }

          // "No data in view" toast
          const zoomKey = `${xMin.toFixed(2)}-${xMax.toFixed(2)}`;
          if (!hasVisibleData && userHasZoomedRef.current && noDataToastShownRef.current !== zoomKey) {
            noDataToastShownRef.current = zoomKey;
            toast.info("No data points in current view", {
              description: "Double-click the chart to reset zoom",
              duration: 4000,
            });
          }
        });
        return; // Skip the synchronous no-data check below
      }

      // No-data check for the userHasZoomedY path (already deferred above for auto-range)
      const zoomKey = `${xMin.toFixed(2)}-${xMax.toFixed(2)}`;
      if (noDataToastShownRef.current !== zoomKey && userHasZoomedRef.current) {
        // Quick check — only need one data point
        const xData = u.data[0] as number[];
        let lo2 = 0; let hi2 = xData.length - 1;
        while (lo2 <= hi2) { const m = (lo2 + hi2) >>> 1; if (xData[m] < xMin) lo2 = m + 1; else hi2 = m - 1; }
        let found = false;
        for (let i = lo2; i < xData.length && xData[i] <= xMax && !found; i++) {
          for (let si = 1; si < u.data.length && !found; si++) {
            if ((u.data[si] as (number | null)[])[i] != null) found = true;
          }
        }
        if (!found) {
          noDataToastShownRef.current = zoomKey;
          toast.info("No data points in current view", {
            description: "Double-click the chart to reset zoom",
            duration: 4000,
          });
        }
      }

      // ZOOM RANGE CHANGE: Notify parent of zoom range for server re-fetch.
      // Uses captured isProgrammatic/isSyncing from before syncXScale modified the ref.
      // Fire synchronously — drag.setScale:true only triggers on mouseup (not during drag),
      // so debouncing is unnecessary and causes timer scheduling issues.
      if (!isProgrammatic && !isSyncing) {
        // Cancel any pending timer from a previous zoom
        if (zoomRangeTimerRef.current) {
          clearTimeout(zoomRangeTimerRef.current);
          zoomRangeTimerRef.current = null;
        }
        onZoomRangeChangeRef.current?.([xMin, xMax]);
      }

    }

    // Y-axis zoom detection moved to setSelect hook
  };
}

/**
 * Build a setSelect hook that captures Y-axis drag-zoom from the selection rect.
 * setSelect fires during mouseUp BEFORE _setScale, so we can compute
 * the Y range from the selection box. This avoids relying on the setScale
 * hook for Y (which fires at unpredictable times due to deferred commits).
 */
export function buildSetSelectHook(
  userHasZoomedYRef: React.MutableRefObject<boolean>,
  userYZoomRangeRef: React.MutableRefObject<[number, number] | null>,
  onYZoomRangeChangeRef: React.RefObject<((range: [number, number] | null) => void) | undefined>,
): (u: uPlot) => void {
  return (u: uPlot) => {
    const sel = u.select;
    // Check for real Y drag: sel.height must be > 0 AND less than the
    // full plot height. uPlot sets sel.height = full height during X-only
    // drags (uni: Infinity mode), which is NOT a Y zoom.
    const plotHeight = u.bbox.height / devicePixelRatio;
    if (sel.height > 0 && sel.height < plotHeight - 1) {
      // Selection has Y component — compute Y range from pixel positions
      const yMin = u.posToVal(sel.top + sel.height, "y");
      const yMax = u.posToVal(sel.top, "y");
      if (yMin != null && yMax != null && Number.isFinite(yMin) && Number.isFinite(yMax)) {
        userHasZoomedYRef.current = true;
        userYZoomRangeRef.current = [yMin, yMax];
        onYZoomRangeChangeRef.current?.([yMin, yMax]);
      }
    }
  };
}
