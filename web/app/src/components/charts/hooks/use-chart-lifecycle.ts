import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { arrayMin, arrayMax } from "../lib/data-processing";
import { zoomOverlapsData } from "../lib/scales";
import type { LineData } from "../lib/types";

/**
 * Compute the X-axis range considering only visible (non-hidden) series.
 * Returns null if no visible series have data — caller should fall back to full range.
 */
function getVisibleXRange(chart: uPlot, data: uPlot.AlignedData): [number, number] | null {
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
 * Reset the X-axis scale, respecting globalXRange if set, otherwise
 * fitting to visible (non-hidden) series data with a full-range fallback.
 */
function resetXScale(chart: uPlot, data: uPlot.AlignedData, globalRange: [number, number] | null): void {
  if (globalRange) {
    chart.setScale("x", { min: globalRange[0], max: globalRange[1] });
  } else {
    const visibleRange = getVisibleXRange(chart, data);
    if (visibleRange) {
      chart.setScale("x", { min: visibleRange[0], max: visibleRange[1] });
    } else {
      const xVals = data[0] as number[];
      if (xVals && xVals.length > 0) {
        chart.setScale("x", { min: xVals[0], max: xVals[xVals.length - 1] });
      }
    }
  }
}

interface UseChartLifecycleParams {
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.MutableRefObject<uPlot | null>;
  chartInstanceRef: React.MutableRefObject<uPlot | null>;
  options: uPlot.Options;
  uplotData: uPlot.AlignedData;
  uplotDataRef: React.RefObject<uPlot.AlignedData>;
  processedLines: LineData[];
  chartId: string;
  width: number;
  height: number;
  logXAxis: boolean;
  isDateTime: boolean;
  zoomGroup: string;
  theme: string | undefined;
  chartSyncContext: any;
  chartSyncContextRef: React.RefObject<any>;
  isProgrammaticScaleRef: React.MutableRefObject<boolean>;
  userHasZoomedRef: React.MutableRefObject<boolean>;
  userHasZoomedYRef: React.MutableRefObject<boolean>;
  userYZoomRangeRef: React.MutableRefObject<[number, number] | null>;
  lastAppliedGlobalRangeRef: React.MutableRefObject<[number, number] | null>;
  zoomRangeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onResetBoundsRef: React.RefObject<(() => void) | undefined>;
  onZoomRangeChangeRef: React.RefObject<((range: [number, number] | null) => void) | undefined>;
  onYZoomRangeChangeRef: React.RefObject<((range: [number, number] | null) => void) | undefined>;
  legendHiddenSeriesRef: React.MutableRefObject<Set<string>>;
}

/**
 * Manages the uPlot chart lifecycle: creation, data updates, zoom restoration,
 * context registration, double-click reset, and cleanup.
 *
 * Uses setData() for efficient updates when only data changes (same series count
 * and same options). Falls back to full chart recreation when options or series
 * structure change.
 */
export function useChartLifecycle({
  chartContainerRef,
  chartRef,
  chartInstanceRef,
  options,
  uplotData,
  uplotDataRef,
  processedLines,
  chartId,
  width,
  height,
  logXAxis,
  isDateTime,
  zoomGroup,
  theme,
  chartSyncContext,
  chartSyncContextRef,
  isProgrammaticScaleRef,
  userHasZoomedRef,
  userHasZoomedYRef,
  userYZoomRangeRef,
  lastAppliedGlobalRangeRef,
  zoomRangeTimerRef,
  onResetBoundsRef,
  onZoomRangeChangeRef,
  onYZoomRangeChangeRef,
  legendHiddenSeriesRef,
}: UseChartLifecycleParams) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const chartCreatedRef = useRef(false);
  const zoomStateRef = useRef<{ xMin: number; xMax: number; zoomGroup?: string } | null>(null);
  const prevDataStructureRef = useRef<{ seriesCount: number } | null>(null);
  const prevDataRef = useRef<uPlot.AlignedData | null>(null);
  const prevOptionsRef = useRef<uPlot.Options | null>(null);
  const noDataToastShownRef = useRef<string | null>(null);

  // Create chart when container has dimensions and data is ready
  useEffect(() => {
    const dims = { width, height };

    if (!chartContainerRef.current || dims.width === 0 || dims.height === 0) {
      return;
    }

    const currentSeriesCount = uplotData.length;

    // If chart already exists and only dimensions changed, skip recreation
    if (chartRef.current && chartCreatedRef.current) {
      if (prevDataRef.current === uplotData && prevOptionsRef.current === options) {
        return;
      }

      // Use setData() instead of full recreation when possible
      if (
        prevOptionsRef.current === options &&
        prevDataStructureRef.current &&
        prevDataStructureRef.current.seriesCount === currentSeriesCount
      ) {
        try {
          isProgrammaticScaleRef.current = true;
          chartRef.current.batch(() => {
            chartRef.current!.setData(uplotData);
          });

          // Re-apply synced zoom after setData
          if (!logXAxis && !isDateTime) {
            const syncedZoom = chartSyncContextRef.current?.syncedZoomRange;
            const syncedGroup = chartSyncContextRef.current?.syncedZoomGroupRef?.current;
            const xData = uplotData[0] as number[];
            if (syncedZoom && syncedGroup === zoomGroup && zoomOverlapsData(syncedZoom, xData)) {
              chartRef.current.batch(() => {
                chartRef.current!.setScale("x", { min: syncedZoom[0], max: syncedZoom[1] });
              });
            } else {
              const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
              if (crossZoom && crossZoom.group === zoomGroup && zoomOverlapsData(crossZoom.range, xData)) {
                chartRef.current.batch(() => {
                  chartRef.current!.setScale("x", { min: crossZoom.range[0], max: crossZoom.range[1] });
                });
              } else if (!userHasZoomedRef.current) {
                // No active zoom — correct X scale to visible data only.
                // setData() with auto:true uses the full data[0] range which
                // includes hidden runs' data, so we override it here.
                resetXScale(chartRef.current, uplotData, chartSyncContextRef.current?.globalXRange ?? null);
              }
            }
          }
        } finally {
          isProgrammaticScaleRef.current = false;
        }
        prevDataRef.current = uplotData;
        return;
      }
    }

    // Save zoom state before destroying chart
    // Include zoomGroup so we don't apply stale coordinates after an axis switch
    // (e.g. relative-time seconds applied to a step chart would be wrong)
    if (chartRef.current) {
      const xScale = chartRef.current.scales.x;
      if (xScale.min != null && xScale.max != null) {
        zoomStateRef.current = { xMin: xScale.min, xMax: xScale.max, zoomGroup };
      }
      // Clean up mouseleave handler before destroying
      const lh = (chartRef.current as any)._leaveHandler;
      if (lh) {
        lh.el.removeEventListener("mouseleave", lh.fn);
        lh.el.removeEventListener("pointerdown", lh.pointerDownFn);
        document.removeEventListener("pointerup", lh.docPointerUpFn);
      }
      chartRef.current.destroy();
      chartRef.current = null;
    }

    // Clear container
    while (chartContainerRef.current.firstChild) {
      chartContainerRef.current.removeChild(chartContainerRef.current.firstChild);
    }

    // Create new chart
    const chartOptions = { ...options, width: dims.width, height: dims.height };
    let chart: uPlot;
    try {
      isProgrammaticScaleRef.current = true;
      chart = new uPlot(chartOptions, uplotData, chartContainerRef.current);
      chart.batch(() => {});
    } finally {
      isProgrammaticScaleRef.current = false;
    }
    chartRef.current = chart;
    chartInstanceRef.current = chart;
    chartCreatedRef.current = true;

    // Expose uPlot instance on root DOM element for E2E test access
    (chart.root as any)._uplot = chart;

    // Hide legend rows for "(original)" smoothing companion series
    const legendRows = chart.root.querySelectorAll(".u-series");
    processedLines.forEach((line, idx) => {
      if (line.hideFromLegend && legendRows[idx + 1]) {
        (legendRows[idx + 1] as HTMLElement).style.display = "none";
      }
    });

    // Apply hidden run state from context
    // Apply legend-toggled visibility (series hidden via legend click, persists across recreations)
    const hiddenIds = chartSyncContextRef.current?.hiddenRunIdsRef?.current;
    const legendHidden = legendHiddenSeriesRef.current;
    if ((hiddenIds && hiddenIds.size > 0) || legendHidden.size > 0) {
      chart.batch(() => {
        for (let i = 1; i < chart.series.length; i++) {
          const seriesId = (chart.series[i] as any)?._seriesId as string | undefined;
          if (!seriesId) continue;
          const runId = seriesId.includes(':') ? seriesId.split(':')[0] : seriesId;
          if ((hiddenIds && hiddenIds.has(runId)) || legendHidden.has(seriesId)) {
            chart.setSeries(i, { show: false });
          }
        }
      });
      // Correct X scale after hiding series — uPlot's auto-range used the full
      // data extent (including hidden runs) during chart creation.
      if (!logXAxis && !isDateTime) {
        resetXScale(chart, uplotData, chartSyncContextRef.current?.globalXRange ?? null);
      }
    }

    // Fix: when mouse leaves the chart during an active chart drag, dispatch a
    // synthetic mouseup so uPlot finalizes the zoom BEFORE its mouseLeave handler
    // resets internal drag state. Only fires when the mousedown originated on the
    // chart overlay (not e.g. sidebar resize handle that happens to cross the chart).
    const overEl = chart.root.querySelector(".u-over") as HTMLElement | null;
    if (overEl) {
      let isDraggingInChart = false;
      const handleOverPointerDown = () => { isDraggingInChart = true; };
      const handleDocPointerUp = () => { isDraggingInChart = false; };
      const handleLeaveWhileDragging = (e: MouseEvent) => {
        if (isDraggingInChart && e.buttons > 0) {
          isDraggingInChart = false;
          document.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            clientX: e.clientX,
            clientY: e.clientY,
          }));
        }
      };
      overEl.addEventListener("pointerdown", handleOverPointerDown);
      document.addEventListener("pointerup", handleDocPointerUp);
      overEl.addEventListener("mouseleave", handleLeaveWhileDragging);
      (chart as any)._leaveHandler = {
        el: overEl,
        fn: handleLeaveWhileDragging,
        pointerDownFn: handleOverPointerDown,
        docPointerUpFn: handleDocPointerUp,
      };
    }

    // Track data structure for future optimization
    prevDataStructureRef.current = { seriesCount: currentSeriesCount };
    prevDataRef.current = uplotData;
    prevOptionsRef.current = options;

    // Determine initial X-axis range
    let rangeToApply: [number, number] | null = null;
    let isUserZoom = false;

    if (zoomStateRef.current) {
      const { xMin, xMax, zoomGroup: savedGroup } = zoomStateRef.current;
      // Only apply saved zoom if the axis type hasn't changed.
      // After an axis switch (step↔relative-time), the saved coordinates are
      // in the wrong unit system and would produce a bogus zoom range.
      // Cross-group zoom is handled below via crossGroupZoomRef instead.
      const groupMatches = !savedGroup || savedGroup === zoomGroup;
      if (groupMatches) {
        const xData = uplotData[0] as number[];
        if (xData.length > 0) {
          const dataMin = arrayMin(xData);
          const dataMax = arrayMax(xData);
          if (xMin < dataMax && xMax > dataMin) {
            rangeToApply = [xMin, xMax];
            isUserZoom = true;
          }
        }
      }
      zoomStateRef.current = null;
    }

    if (!rangeToApply && !logXAxis && !isDateTime) {
      const syncedZoom = chartSyncContext?.syncedZoomRange ?? chartSyncContextRef.current?.syncedZoomRange;
      const syncedGroup = chartSyncContext?.syncedZoomGroupRef?.current ?? chartSyncContextRef.current?.syncedZoomGroupRef?.current;
      const globalRange = chartSyncContext?.globalXRange ?? chartSyncContextRef.current?.globalXRange;

      if (process.env.NODE_ENV === 'development') {
        console.log(`[uPlot ${chartId}] Chart creation - syncedZoom:`, syncedZoom, 'syncedGroup:', syncedGroup, 'zoomGroup:', zoomGroup, 'globalRange:', globalRange);
      }

      if (syncedZoom && syncedGroup === zoomGroup) {
        const xData = uplotData[0] as number[];
        const hasOverlap = zoomOverlapsData(syncedZoom, xData);
        if (process.env.NODE_ENV === 'development') {
          const dataMin = xData.length > 0 ? arrayMin(xData) : null;
          const dataMax = xData.length > 0 ? arrayMax(xData) : null;
          console.log(`[uPlot ${chartId}] Zoom validation - syncedZoom: [${syncedZoom[0]}, ${syncedZoom[1]}], dataRange: [${dataMin}, ${dataMax}], hasOverlap: ${hasOverlap}`);
        }
        if (hasOverlap) {
          rangeToApply = syncedZoom;
          isUserZoom = true;
        } else if (process.env.NODE_ENV === 'development' && (uplotData[0] as number[]).length === 0) {
          console.log(`[uPlot ${chartId}] No xData to validate zoom against`);
        }
      }

      // Check cross-group zoom
      if (!rangeToApply) {
        const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
        if (crossZoom && crossZoom.group === zoomGroup) {
          const xData = uplotData[0] as number[];
          if (zoomOverlapsData(crossZoom.range, xData)) {
            rangeToApply = crossZoom.range;
            isUserZoom = true;
          }
        }
      }

      if (!rangeToApply && globalRange) {
        rangeToApply = globalRange;
      }
    }

    // Apply range
    if (rangeToApply) {
      const [rangeMin, rangeMax] = rangeToApply;
      lastAppliedGlobalRangeRef.current = [rangeMin, rangeMax];
      userHasZoomedRef.current = isUserZoom;
      if (process.env.NODE_ENV === 'development') {
        console.log(`[uPlot ${chartId}] Applying range: [${rangeMin}, ${rangeMax}], isUserZoom: ${isUserZoom}`);
      }
      try {
        isProgrammaticScaleRef.current = true;
        chart.batch(() => {
          chart.setScale("x", { min: rangeMin, max: rangeMax });
        });
      } catch {
        // Ignore errors if chart was already destroyed
      } finally {
        isProgrammaticScaleRef.current = false;
      }
    } else {
      // Single-point centering
      if (!logXAxis && !isDateTime) {
        const xData = uplotData[0] as number[];
        if (xData.length === 1) {
          const xVal = xData[0];
          const padding = Math.max(Math.abs(xVal) * 0.5, 1);
          try {
            isProgrammaticScaleRef.current = true;
            chart.batch(() => {
              chart.setScale("x", { min: xVal - padding, max: xVal + padding });
            });
          } catch {
            // Ignore errors if chart was already destroyed
          } finally {
            isProgrammaticScaleRef.current = false;
          }
        }
      }
    }

    // Apply externally-stored Y zoom range (persisted across mini/fullscreen)
    if (userYZoomRangeRef.current && userHasZoomedYRef.current) {
      const [savedYMin, savedYMax] = userYZoomRangeRef.current;
      try {
        isProgrammaticScaleRef.current = true;
        chart.batch(() => {
          chart.setScale("y", { min: savedYMin, max: savedYMax });
        });
      } catch {
        // Ignore errors if chart was already destroyed
      } finally {
        isProgrammaticScaleRef.current = false;
      }
    }

    // Style selection box
    const containerEl = chartContainerRef.current;
    requestAnimationFrame(() => {
      const selectEl = containerEl?.querySelector('.u-select') as HTMLElement | null;
      if (selectEl) {
        const isDark = theme === 'dark';
        selectEl.style.background = isDark ? 'rgba(100, 150, 255, 0.2)' : 'rgba(100, 150, 255, 0.15)';
        selectEl.style.border = isDark ? '1px solid rgba(100, 150, 255, 0.9)' : '1px solid rgba(100, 150, 255, 0.8)';
      }
    });

    // Register with context
    chartSyncContextRef.current?.registerUPlot(chartId, chart);

    // Register reset callback
    chartSyncContextRef.current?.registerResetCallback(chartId, () => {
      if (zoomRangeTimerRef.current) {
        clearTimeout(zoomRangeTimerRef.current);
        zoomRangeTimerRef.current = null;
      }
      const fullData = uplotDataRef.current;
      isProgrammaticScaleRef.current = true;
      try {
        chart.setData(fullData);
        chart.batch(() => {});
        resetXScale(chart, fullData, chartSyncContextRef.current?.globalXRange ?? null);
        chart.batch(() => {});
      } finally {
        isProgrammaticScaleRef.current = false;
      }
      userHasZoomedRef.current = false;
      userHasZoomedYRef.current = false;
      userYZoomRangeRef.current = null;
      zoomStateRef.current = null;
      lastAppliedGlobalRangeRef.current = null;
      onZoomRangeChangeRef.current?.(null);
      onYZoomRangeChangeRef.current?.(null);
    });

    // Register zoom callback
    if (!logXAxis && !isDateTime) {
      chartSyncContextRef.current?.registerZoomCallback(chartId, (xMin: number, xMax: number) => {
        isProgrammaticScaleRef.current = true;
        try {
          chart.batch(() => {
            chart.setScale("x", { min: xMin, max: xMax });
          });
        } catch {
          // Ignore errors from destroyed charts
        } finally {
          isProgrammaticScaleRef.current = false;
        }
      }, zoomGroup);
    }

    // Safety: Re-check synced zoom from context in next frame
    if (!rangeToApply && !logXAxis && !isDateTime) {
      requestAnimationFrame(() => {
        const ctx = chartSyncContextRef.current;
        const lateSyncedZoom = ctx?.syncedZoomRange;
        const lateZoomGroup = ctx?.syncedZoomGroupRef?.current;
        let lateRange: [number, number] | null = null;

        if (lateSyncedZoom && lateZoomGroup === zoomGroup) {
          lateRange = lateSyncedZoom;
        } else {
          const crossZoom = ctx?.crossGroupZoomRef?.current;
          if (crossZoom && crossZoom.group === zoomGroup) {
            lateRange = crossZoom.range;
          }
        }

        if (lateRange && chart) {
          const xData = chart.data[0] as number[];
          if (xData && zoomOverlapsData(lateRange, xData) && !lastAppliedGlobalRangeRef.current) {
            if (process.env.NODE_ENV === 'development') {
              console.log(`[uPlot ${chartId}] Late sync - applying zoom: [${lateRange[0]}, ${lateRange[1]}]`);
            }
            lastAppliedGlobalRangeRef.current = lateRange;
            userHasZoomedRef.current = true;
            try {
              isProgrammaticScaleRef.current = true;
              chart.batch(() => {
                chart.setScale("x", { min: lateRange![0], max: lateRange![1] });
              });
            } catch {
              // Chart may have been destroyed
            } finally {
              isProgrammaticScaleRef.current = false;
            }
          }
        }
      });
    }

    // Double-click to reset zoom
    const handleDblClick = () => {
      if (zoomRangeTimerRef.current) {
        clearTimeout(zoomRangeTimerRef.current);
        zoomRangeTimerRef.current = null;
      }
      const globalRange = chartSyncContextRef.current?.globalXRange;
      const currentData = uplotDataRef.current;
      try {
        isProgrammaticScaleRef.current = true;
        chart.setData(currentData);
        chart.batch(() => {});
        resetXScale(chart, currentData, globalRange);
        chart.batch(() => {});
      } catch {
        // Ignore errors from destroyed charts
      } finally {
        isProgrammaticScaleRef.current = false;
      }
      onResetBoundsRef.current?.();
      zoomStateRef.current = null;
      userHasZoomedRef.current = false;
      userHasZoomedYRef.current = false;
      userYZoomRangeRef.current = null;
      lastAppliedGlobalRangeRef.current = globalRange ?? null;
      noDataToastShownRef.current = null;
      onZoomRangeChangeRef.current?.(null);
      onYZoomRangeChangeRef.current?.(null);
      chartSyncContextRef.current?.setSyncedZoomRange(null);
      const crossRef = chartSyncContextRef.current?.crossGroupZoomRef;
      if (crossRef) crossRef.current = null;
      const syncRef = chartSyncContextRef.current?.isSyncingZoomRef;
      if (syncRef) syncRef.current = false;
      chartSyncContextRef.current?.resetZoom(chartId);
    };
    const container = chartContainerRef.current;
    container.addEventListener("dblclick", handleDblClick);

    // Store cleanup function
    cleanupRef.current = () => {
      chartSyncContextRef.current?.unregisterUPlot(chartId);
      chartSyncContextRef.current?.unregisterResetCallback(chartId);
      chartSyncContextRef.current?.unregisterZoomCallback(chartId);
      container?.removeEventListener("dblclick", handleDblClick);
    };

    return () => {
      cleanupRef.current?.();
      if (chartRef.current) {
        const lh = (chartRef.current as any)._leaveHandler;
        if (lh) {
          lh.el.removeEventListener("mouseleave", lh.fn);
        }
        chartRef.current.destroy();
        chartRef.current = null;
      }
      chartCreatedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, uplotData, chartId, width, height]);

  // Handle resize separately - uses setSize() instead of recreating chart
  useEffect(() => {
    if (chartRef.current && width > 0 && height > 0) {
      try {
        isProgrammaticScaleRef.current = true;
        chartRef.current.batch(() => {
          chartRef.current!.setSize({ width, height });
        });
      } finally {
        isProgrammaticScaleRef.current = false;
      }
    }
  }, [width, height]);
}
