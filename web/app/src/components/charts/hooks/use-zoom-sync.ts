import { useEffect } from "react";
import uPlot from "uplot";
import { zoomOverlapsData } from "../lib/scales";

interface UseZoomSyncParams {
  chartRef: React.RefObject<uPlot | null>;
  chartId: string;
  chartSyncContext: any;
  chartSyncContextRef: React.RefObject<any>;
  logXAxis: boolean;
  isDateTime: boolean;
  zoomGroup: string;
  userHasZoomedRef: React.MutableRefObject<boolean>;
  lastAppliedGlobalRangeRef: React.MutableRefObject<[number, number] | null>;
  isProgrammaticScaleRef: React.MutableRefObject<boolean>;
}

/**
 * Synchronize zoom state across charts via context.
 *
 * Priority: syncedZoomRange (if group matches) > cross-group zoom > globalXRange.
 * Validates that the zoom range overlaps with this chart's data before applying.
 * Falls back to globalXRange when zoom is outside this chart's data range.
 */
export function useZoomSync({
  chartRef,
  chartId,
  chartSyncContext,
  chartSyncContextRef,
  logXAxis,
  isDateTime,
  zoomGroup,
  userHasZoomedRef,
  lastAppliedGlobalRangeRef,
  isProgrammaticScaleRef,
}: UseZoomSyncParams) {
  useEffect(() => {
    const chart = chartRef.current;
    const syncedZoom = chartSyncContext?.syncedZoomRange;
    const syncedGroup = chartSyncContext?.syncedZoomGroupRef?.current ?? null;
    const globalRange = chartSyncContext?.globalXRange;

    if (process.env.NODE_ENV === 'development') {
      console.log(`[uPlot ${chartId}] Zoom sync effect - chart:`, !!chart, 'syncedZoom:', syncedZoom, 'syncedGroup:', syncedGroup, 'zoomGroup:', zoomGroup, 'globalRange:', globalRange);
    }

    if (!chart || logXAxis || isDateTime) return;

    const xData = chart.data[0] as number[];

    // Determine which range to use
    const groupMatches = syncedGroup === zoomGroup;
    let rangeToApply = (syncedZoom && groupMatches) ? syncedZoom : null;

    // Check cross-group zoom (step<->relative-time translation)
    if (!rangeToApply) {
      const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
      if (crossZoom && crossZoom.group === zoomGroup) {
        rangeToApply = crossZoom.range;
      }
    }

    if (!rangeToApply) {
      rangeToApply = globalRange ?? null;
    }

    // Validate syncedZoom - fall back to globalRange if it doesn't overlap with data
    if (syncedZoom && groupMatches && !zoomOverlapsData(syncedZoom, xData)) {
      rangeToApply = globalRange ?? null;
    }

    // When there's no range but chart was previously zoomed, auto-scale back
    if (!rangeToApply) {
      if (userHasZoomedRef.current && chart) {
        userHasZoomedRef.current = false;
        lastAppliedGlobalRangeRef.current = null;
        try {
          isProgrammaticScaleRef.current = true;
          const xData = chart.data[0] as number[];
          if (xData.length > 0) {
            const dataMin = xData[0];
            const dataMax = xData[xData.length - 1];
            chart.batch(() => {
              chart.setScale("x", { min: dataMin, max: dataMax });
            });
          }
        } catch { /* disposed chart */ } finally {
          isProgrammaticScaleRef.current = false;
        }
      }
      return;
    }

    const [rangeMin, rangeMax] = rangeToApply;

    // Skip if we already applied this exact range
    const lastApplied = lastAppliedGlobalRangeRef.current;
    if (lastApplied && lastApplied[0] === rangeMin && lastApplied[1] === rangeMax) return;

    // Apply the range
    lastAppliedGlobalRangeRef.current = [rangeMin, rangeMax];
    const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
    const isCrossGroupZoom = crossZoom && crossZoom.group === zoomGroup;
    userHasZoomedRef.current = !!(syncedZoom && groupMatches) || !!isCrossGroupZoom;
    try {
      isProgrammaticScaleRef.current = true;
      chart.batch(() => {
        chart.setScale("x", { min: rangeMin, max: rangeMax });
      });
    } catch {
      // Ignore errors from disposed charts
    } finally {
      isProgrammaticScaleRef.current = false;
    }
  }, [chartSyncContext?.syncedZoomRange, chartSyncContext?.globalXRange, logXAxis, isDateTime, zoomGroup]);
}
