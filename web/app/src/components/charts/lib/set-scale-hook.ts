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

      // Auto-scale Y axis when X scale changes (zoom)
      // Skip if user has manually zoomed Y-axis (yZoom mode) to preserve their range.
      // For log scale without manual bounds, let uPlot handle it via distr:3
      // For log scale WITH manual bounds, apply them during zoom too
      // If user has manually zoomed Y, restore their range after uPlot's auto:true overwrites it.
      // queueMicrotask runs after uPlot finishes processing (including auto-range) but before paint.
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
        // Find Y min/max for data points within visible X range
        let visibleYMin = Infinity;
        let visibleYMax = -Infinity;

        const xData = u.data[0] as number[];
        for (let si = 1; si < u.data.length; si++) {
          const yData = u.data[si] as (number | null)[];
          for (let i = 0; i < xData.length; i++) {
            const x = xData[i];
            const y = yData[i];
            if (x >= xMin && x <= xMax && y != null && Number.isFinite(y)) {
              visibleYMin = Math.min(visibleYMin, y);
              visibleYMax = Math.max(visibleYMax, y);
            }
          }
        }

        // Only update if we found valid data
        if (visibleYMin !== Infinity && visibleYMax !== -Infinity) {
          let newYMin: number;
          let newYMax: number;

          if (logYAxis) {
            // For log scale, use data range directly (no linear padding)
            newYMin = visibleYMin;
            newYMax = visibleYMax;
          } else {
            const range = visibleYMax - visibleYMin;
            // Add 5% padding, with minimum padding for flat lines
            const padding = Math.max(range * 0.05, Math.abs(visibleYMax) * 0.02, 0.1);
            newYMin = visibleYMin >= 0 ? Math.max(0, visibleYMin - padding) : visibleYMin - padding;
            newYMax = visibleYMax + padding;
          }

          // Respect manual bounds if set
          if (yMinProp != null) newYMin = yMinProp;
          if (yMaxProp != null) newYMax = yMaxProp;

          // Only update if meaningfully different to avoid infinite loops
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
      }

      // Check if any series has visible data points in the zoom range
      // If not, show a notification to help the user
      const zoomKey = `${xMin.toFixed(2)}-${xMax.toFixed(2)}`;
      if (noDataToastShownRef.current !== zoomKey) {
        let hasVisibleData = false;
        const xData = u.data[0] as number[];

        for (let si = 1; si < u.data.length && !hasVisibleData; si++) {
          const yData = u.data[si] as (number | null)[];
          for (let i = 0; i < xData.length; i++) {
            const x = xData[i];
            const y = yData[i];
            if (x >= xMin && x <= xMax && y != null) {
              hasVisibleData = true;
              break;
            }
          }
        }

        if (!hasVisibleData && userHasZoomedRef.current) {
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
