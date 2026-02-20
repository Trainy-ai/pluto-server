import React, {
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useId,
} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";
import { useChartSyncContext, applySeriesHighlight } from "./context/chart-sync-context";
import { useChartLineWidth } from "@/lib/hooks/use-chart-line-width";
import { toast } from "sonner";
import type { TooltipInterpolation } from "@/lib/math/interpolation";
import { applyAlpha } from "@/lib/math/color-alpha";

// Extracted modules
import { formatAxisLabels, smartDateFormatter } from "./lib/format";
import { arrayMin, arrayMax, filterDataForLogScale, alignDataForUPlot } from "./lib/data-processing";
import { tooltipPlugin, type HoverState } from "./lib/tooltip-plugin";
import { buildSeriesConfig } from "./lib/series-config";
import { buildFocusDetectionHook, buildInterpolationDotsHook } from "./lib/cursor-hooks";
import { useContainerSize } from "./hooks/use-container-size";


// ============================
// Types
// ============================

export interface LineData {
  x: number[];
  y: number[];
  label: string;
  /** Unique identifier for this series (e.g. run ID). Used for highlighting when labels may not be unique. Falls back to label if not provided. */
  seriesId?: string;
  color?: string;
  /** uPlot dash pattern array, e.g. [10, 5] for dashed, [2, 4] for dotted. undefined = solid. */
  dash?: number[];
  hideFromLegend?: boolean;
  opacity?: number;
  /** If set, this series is an envelope boundary (min or max) for the named parent series */
  envelopeOf?: string;
  /** Whether this is the min or max boundary of an envelope */
  envelopeBound?: "min" | "max";
  /** Map from x-value to non-finite flag text ("NaN", "Inf", "-Inf") for tooltip display */
  valueFlags?: Map<number, string>;
}

/** Raw (pre-downsampled) data for a single series, used for zoom-aware re-downsampling */
export interface RawLineData {
  x: number[];
  y: number[];
  label: string;
  color: string;
  seriesId?: string;
  /** uPlot dash pattern, e.g. [10, 5]. undefined = solid. */
  dash?: number[];
}

interface LineChartProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: LineData[];
  isDateTime?: boolean;
  logXAxis?: boolean;
  logYAxis?: boolean;
  xlabel?: string;
  ylabel?: string;
  title?: string;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  /** Sync key for cross-chart cursor sync */
  syncKey?: string;
  /** Manual Y-axis minimum bound. When set, overrides auto-scaling for min. */
  yMin?: number;
  /** Manual Y-axis maximum bound. When set, overrides auto-scaling for max. */
  yMax?: number;
  /** Callback fired when the actual data range (min/max of all Y values) is computed */
  onDataRange?: (dataMin: number, dataMax: number) => void;
  /** Callback fired on double-click to reset Y-axis bounds for this chart */
  onResetBounds?: () => void;
  /** Tooltip interpolation mode for series with missing values at the hovered step */
  tooltipInterpolation?: TooltipInterpolation;
  /** Optional raw (pre-downsampled) data for zoom-aware re-downsampling.
   *  When provided, zooming will re-downsample the visible range for more detail. */
  rawLines?: RawLineData[];
  /** Target points for re-downsampling on zoom (defaults to 2000) */
  downsampleTarget?: number;
  /** Callback to reprocess raw data for a zoomed range. Called with the raw lines and
   *  visible x-range, should return the same number of LineData[] as the initial processing.
   *  This keeps all processing logic (downsampling + smoothing) in the parent. */
  reprocessForZoom?: (rawLines: RawLineData[], xMin: number, xMax: number) => LineData[];
  /** Callback fired when zoom range changes. The parent can use this to trigger
   *  server re-fetch for full-resolution data in the zoomed range.
   *  Called with [xMin, xMax] on zoom, or null on zoom reset. */
  onZoomRangeChange?: (range: [number, number] | null) => void;
  /** Enable IQR-based outlier detection for Y-axis scaling (default: false) */
  outlierDetection?: boolean;
}

/** Ref handle exposed to parent components */
export interface LineChartUPlotRef {
  getChart: () => uPlot | null;
  resetZoom: () => void;
}

/**
 * Default sync key for all uPlot charts on the same page.
 * This enables cursor synchronization across charts by default.
 */
const DEFAULT_SYNC_KEY = "uplot-global-sync";



// ============================
// Main Component
// ============================

const LineChartUPlotInner = forwardRef<LineChartUPlotRef, LineChartProps>(
  (
    {
      lines,
      isDateTime = false,
      logXAxis = false,
      logYAxis = false,
      xlabel,
      ylabel,
      title,
      showXAxis = true,
      showYAxis = true,
      showLegend = false,
      syncKey,
      yMin: yMinProp,
      yMax: yMaxProp,
      onDataRange,
      onResetBounds,
      tooltipInterpolation = "none",
      rawLines,
      downsampleTarget = 2000,
      reprocessForZoom,
      onZoomRangeChange,
      outlierDetection = false,
      className,
      ...rest
    },
    ref
  ) => {
    const { resolvedTheme: theme } = useTheme();
    const { lineWidth: chartLineWidth } = useChartLineWidth();
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<uPlot | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    // External hover state that survives chart recreation
    // This fixes tooltip disappearing when chart is recreated while mouse is hovering
    const hoverStateRef = useRef<HoverState>({
      isHovering: false,
      lastIdx: null,
      lastLeft: null,
      lastTop: null,
    });
    // Measure the chart container directly (not outer container) for accurate sizing
    const { width, height } = useContainerSize(chartContainerRef);
    const chartId = useId();

    // Get chart sync context for cross-chart coordination
    const chartSyncContext = useChartSyncContext();

    // Store context in ref for stable access in callbacks (avoids chart recreation on hover changes)
    const chartSyncContextRef = useRef(chartSyncContext);
    useEffect(() => {
      chartSyncContextRef.current = chartSyncContext;
    }, [chartSyncContext]);

    // Track last focused series for emphasis persistence (don't reset on seriesIdx=null)
    const lastFocusedSeriesRef = useRef<number | null>(null);

    // Track cross-chart highlighted series name (from other charts in the sync group)
    const crossChartHighlightRef = useRef<string | null>(null);

    // Track table-driven highlighted series name (from runs table hover)
    const tableHighlightRef = useRef<string | null>(null);

    // Ref for tooltip to access highlighted series name synchronously
    const highlightedSeriesRef = useRef<string | null>(null);

    // Ref for line width so event handlers can read the latest value
    const chartLineWidthRef = useRef(chartLineWidth);
    chartLineWidthRef.current = chartLineWidth;

    // Ref to access processedLines in callbacks without causing dependency issues
    const processedLinesRef = useRef<typeof lines>([]);

    // Store chart instance ref for resetting alpha on mouseleave
    const chartInstanceRef = useRef<uPlot | null>(null);

    // Store raw (pre-downsampled) data for zoom-aware re-downsampling
    const rawLinesRef = useRef(rawLines);
    rawLinesRef.current = rawLines;
    const downsampleTargetRef = useRef(downsampleTarget);
    downsampleTargetRef.current = downsampleTarget;

    // Reprocess callback for zoom re-downsampling (stored in ref to avoid chart recreation)
    const reprocessForZoomRef = useRef(reprocessForZoom);
    reprocessForZoomRef.current = reprocessForZoom;
    // Zoom range change callback for server re-fetch
    const onZoomRangeChangeRef = useRef(onZoomRangeChange);
    onZoomRangeChangeRef.current = onZoomRangeChange;

    // Debounce timer for zoom re-downsampling
    const zoomResampleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Separate debounce timer for zoom range change callback (server re-fetch)
    const zoomRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Use context's syncKey, then prop, then default (in that priority order)
    const effectiveSyncKey = chartSyncContext?.syncKey ?? syncKey ?? DEFAULT_SYNC_KEY;

    // Process data for log scales
    const processedLines = useMemo(
      () => filterDataForLogScale(lines, logXAxis, logYAxis),
      [lines, logXAxis, logYAxis]
    );

    // Keep ref in sync for callbacks
    processedLinesRef.current = processedLines;

    // Subscribe to cross-chart highlight changes from context
    // When another chart highlights a series, we need to redraw to show emphasis
    useEffect(() => {
      const highlightedName = chartSyncContext?.highlightedSeriesName ?? null;

      // Always keep highlightedSeriesRef in sync for tooltip access
      highlightedSeriesRef.current = highlightedName;

      // Only process if this chart is NOT the actively hovered one
      // (the hovered chart handles its own emphasis via setCursor)
      const isActive = chartSyncContext?.hoveredChartIdRef?.current === chartId;

      if (isActive) {
        // We're the source - don't apply cross-chart highlight to ourselves
        crossChartHighlightRef.current = null;
        return;
      }

      // CRITICAL: Clear local focus when another chart is active
      // Otherwise localFocusIdx takes priority over crossChartLabel in stroke function
      if (highlightedName !== null) {
        lastFocusedSeriesRef.current = null;
      }

      // Update cross-chart highlight ref and trigger redraw if changed
      // The stroke function reads from crossChartHighlightRef during redraw
      if (crossChartHighlightRef.current !== highlightedName) {
        crossChartHighlightRef.current = highlightedName;

        const chart = chartInstanceRef.current;
        if (chart) {
          // Trigger redraw - stroke functions will re-evaluate with new ref value
          chart.redraw();
        }
      }
    }, [chartSyncContext?.highlightedSeriesName, chartSyncContext?.hoveredChartIdRef, chartId]);

    // Subscribe to table highlight changes (from runs table row hover)
    // This is separate from cross-chart highlighting to avoid conflicts
    useEffect(() => {
      const tableHighlightName = chartSyncContext?.tableHighlightedSeries ?? null;
      const prevValue = tableHighlightRef.current;
      tableHighlightRef.current = tableHighlightName;

      // Skip if unchanged
      if (prevValue === tableHighlightName) return;

      // Clear stale local focus so table highlight can take effect in stroke function.
      // Without this, a leftover lastFocusedSeriesRef from a previous chart hover
      // takes priority over tableId in the stroke function's 3-tier priority chain.
      if (tableHighlightName !== null) {
        lastFocusedSeriesRef.current = null;
      }

      // Only trigger redraw if no chart hover is active (table highlight is lowest priority)
      const isActive = chartSyncContext?.hoveredChartIdRef?.current === chartId;
      const crossChartActive = chartSyncContext?.highlightedSeriesName !== null &&
        chartSyncContext?.highlightedSeriesName !== tableHighlightName;

      if (!isActive && !crossChartActive) {
        const chart = chartInstanceRef.current;
        if (chart) {
          chart.redraw();
        }
      }
    }, [chartSyncContext?.tableHighlightedSeries, chartSyncContext?.hoveredChartIdRef, chartSyncContext?.highlightedSeriesName, chartId]);

    // Calculate time range for datetime formatting
    const timeRange = useMemo(() => {
      if (!isDateTime || processedLines.length === 0) return 1;
      const allX = processedLines.flatMap((l) => l.x);
      if (allX.length === 0) return 1;
      const min = arrayMin(allX);
      const max = arrayMax(allX);
      return max - min || 1;
    }, [isDateTime, processedLines]);

    // Convert LineData[] to uPlot data format
    const uplotData = useMemo<uPlot.AlignedData>(
      () => alignDataForUPlot(processedLines),
      [processedLines]
    );
    // Ref for imperative access to the full-range aligned data (e.g. resetZoom)
    const uplotDataRef = useRef(uplotData);
    uplotDataRef.current = uplotData;

    // Pre-calculate y-axis range from actual data, with IQR-based outlier detection.
    // Returns [min, max, isOutlierAware] where isOutlierAware indicates the range
    // was narrowed to exclude statistical outliers.
    const yRange = useMemo<[number, number, boolean]>(() => {
      // Skip for log scale (handled by distr: 3)
      if (logYAxis) return [0, 1, false];

      // Collect all y values from uplotData
      const allYValues: number[] = [];
      for (let i = 1; i < uplotData.length; i++) {
        const series = uplotData[i] as (number | null)[];
        for (const v of series) {
          if (v !== null && Number.isFinite(v)) {
            allYValues.push(v);
          }
        }
      }

      // Default range if no valid data
      if (allYValues.length === 0) {
        return [0, 1, false];
      }

      const dataMin = arrayMin(allYValues);
      const dataMax = arrayMax(allYValues);
      const fullRange = dataMax - dataMin;

      // IQR-based outlier detection: focus Y-axis on normal data range
      // when extreme outliers (rare spikes) would otherwise squish the main data.
      // Only active when outlierDetection prop is enabled.
      let effectiveMin = dataMin;
      let effectiveMax = dataMax;

      if (outlierDetection && allYValues.length >= 20) {
        const sorted = [...allYValues].sort((a, b) => a - b);
        const n = sorted.length;
        const q1 = sorted[Math.floor(n * 0.25)];
        const q3 = sorted[Math.floor(n * 0.75)];
        const iqr = q3 - q1;

        if (iqr > 0) {
          const lowerFence = q1 - 1.5 * iqr;
          const upperFence = q3 + 1.5 * iqr;
          const fencedRange = upperFence - lowerFence;

          // Count outliers outside fences
          let outlierCount = 0;
          for (const v of allYValues) {
            if (v < lowerFence || v > upperFence) {
              outlierCount++;
            }
          }

          const outlierRatio = outlierCount / allYValues.length;

          // Activate outlier-aware range only when:
          // - Full range is >3x the fenced range (spikes dominate the axis)
          // - Outliers are <5% of data (truly rare spikes, not bimodal data)
          if (fullRange > 3 * fencedRange && outlierRatio < 0.05) {
            effectiveMin = lowerFence;
            effectiveMax = upperFence;
          }
        }
      }

      const range = effectiveMax - effectiveMin;
      const dataMagnitude = Math.max(Math.abs(effectiveMax), Math.abs(effectiveMin), 0.1);

      // Ensure minimum visible range of 10% of data magnitude
      // This prevents "super zoomed in" views for metrics with tiny variations
      const minRange = dataMagnitude * 0.1;

      let yMin: number, yMax: number;

      // If actual range is less than minimum, expand symmetrically
      if (range < minRange) {
        const center = (effectiveMin + effectiveMax) / 2;
        const halfRange = minRange / 2;
        yMin = center - halfRange;
        yMax = center + halfRange;

        // Don't show negative values if all data is non-negative
        if (effectiveMin >= 0 && yMin < 0) {
          yMin = 0;
          yMax = minRange;
        }
      } else {
        // Add 10% padding for outlier-aware range, 5% for normal range
        const isOutlierAware = effectiveMin !== dataMin || effectiveMax !== dataMax;
        const paddingFactor = isOutlierAware ? 0.10 : 0.05;
        const padding = range * paddingFactor;
        yMin = effectiveMin - padding;
        yMax = effectiveMax + padding;

        // Don't show negative values if all data is non-negative
        if (dataMin >= 0 && yMin < 0) {
          yMin = 0;
        }
      }

      const isOutlierAwareResult = effectiveMin !== dataMin || effectiveMax !== dataMax;
      return [yMin, yMax, isOutlierAwareResult];
    }, [uplotData, logYAxis, outlierDetection]);

    // Ref for onResetBounds so dblclick handler always has latest callback
    const onResetBoundsRef = useRef(onResetBounds);
    onResetBoundsRef.current = onResetBounds;

    // Fire onDataRange callback when data range changes
    // This reports the actual data min/max (before any user-set bounds are applied)
    const onDataRangeRef = useRef(onDataRange);
    onDataRangeRef.current = onDataRange;
    useEffect(() => {
      if (!logYAxis && onDataRangeRef.current) {
        // Compute raw data min/max from uplotData (same logic as yRange but without padding)
        const allYValues: number[] = [];
        for (let i = 1; i < uplotData.length; i++) {
          const series = uplotData[i] as (number | null)[];
          for (const v of series) {
            if (v !== null && Number.isFinite(v)) {
              allYValues.push(v);
            }
          }
        }
        if (allYValues.length > 0) {
          const dataMin = arrayMin(allYValues);
          const dataMax = arrayMax(allYValues);
          onDataRangeRef.current(dataMin, dataMax);
        }
      }
    }, [uplotData, logYAxis]);

    // Note: xRange calculation was removed - global X range is now computed server-side
    // and passed via ChartSyncContext. Single-point centering is handled by uPlot auto-scale.

    // Track if user has manually zoomed - if so, don't overwrite with global range
    const userHasZoomedRef = useRef(false);

    // Track the last applied global range to avoid redundant setScale calls
    const lastAppliedGlobalRangeRef = useRef<[number, number] | null>(null);

    // Guard flag to prevent setScale hook from broadcasting during programmatic scale changes
    // (chart creation, zoom sync from context, reset zoom). Without this, programmatic setScale
    // calls during scroll (when isActiveChart() returns true because no chart is hovered) would
    // corrupt syncedZoomRange in context, breaking zoom for charts that unmount/remount via
    // VirtualizedChart.
    const isProgrammaticScaleRef = useRef(false);

    // Track if we've shown the "no visible data" toast for current zoom
    // Reset when zoom changes to allow showing again
    const noDataToastShownRef = useRef<string | null>(null);

    // Update existing charts when zoom range changes (either global or synced)
    // Priority: syncedZoomRange > globalXRange
    useEffect(() => {
      const chart = chartRef.current;
      const syncedZoom = chartSyncContext?.syncedZoomRange;
      const globalRange = chartSyncContext?.globalXRange;

      // Debug: log when this effect runs
      if (process.env.NODE_ENV === 'development') {
        console.log(`[uPlot ${chartId}] Zoom sync effect - chart:`, !!chart, 'syncedZoom:', syncedZoom, 'globalRange:', globalRange);
      }

      // Skip if no chart or special axis types
      if (!chart || logXAxis || isDateTime) return;

      // Get chart's data range for validation
      const xData = chart.data[0] as number[];
      const dataMin = xData.length > 0 ? arrayMin(xData) : null;
      const dataMax = xData.length > 0 ? arrayMax(xData) : null;

      // Determine which range to use
      // Priority: syncedZoomRange (user zoom) > globalXRange (default)
      let rangeToApply = syncedZoom ?? globalRange;

      // Validate syncedZoom - if it doesn't overlap with THIS chart's data, fall back to globalRange
      // IMPORTANT: Do NOT clear syncedZoomRange in context here! Other charts may still have
      // overlapping data. Each chart should just locally fall back to globalRange.
      if (syncedZoom && dataMin !== null && dataMax !== null) {
        const [zoomMin, zoomMax] = syncedZoom;
        // Check if zoom range has any overlap with data range
        const hasOverlap = zoomMin < dataMax && zoomMax > dataMin;
        if (!hasOverlap) {
          // Zoom is completely outside THIS chart's data range - fall back to global range locally
          rangeToApply = globalRange;
          // Don't clear syncedZoomRange - other charts may still use it
        }
      }

      if (!rangeToApply) return;

      const [rangeMin, rangeMax] = rangeToApply;

      // Skip if we already applied this exact range
      const lastApplied = lastAppliedGlobalRangeRef.current;
      if (lastApplied && lastApplied[0] === rangeMin && lastApplied[1] === rangeMax) return;

      // Apply the range
      lastAppliedGlobalRangeRef.current = [rangeMin, rangeMax];
      // Update user zoom flag based on whether we're applying a synced zoom
      userHasZoomedRef.current = !!syncedZoom;
      try {
        isProgrammaticScaleRef.current = true;
        // Use batch() to force synchronous commit - uPlot's commit() uses microtask,
        // so without batch() the setScale hook fires AFTER isProgrammaticScaleRef is reset.
        chart.batch(() => {
          chart.setScale("x", { min: rangeMin, max: rangeMax });
        });
      } catch {
        // Ignore errors from disposed charts
      } finally {
        isProgrammaticScaleRef.current = false;
      }
    }, [chartSyncContext?.syncedZoomRange, chartSyncContext?.globalXRange, logXAxis, isDateTime]);

    // Callback for when hover state changes - notifies context to track active chart
    // Uses ref to avoid recreating chart on hover changes
    const handleHoverChange = useMemo(() => {
      return (isHovering: boolean) => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return;

        if (isHovering) {
          ctx.setHoveredChart(chartId);
        } else {
          // Only clear if this chart was the hovered one
          // Prevents race conditions when quickly moving between charts
          // (e.g., A's mouseleave fires after B's mouseenter)
          // Use ref for synchronous check to avoid stale state
          const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
          if (currentHovered === chartId) {
            ctx.setHoveredChart(null);
          }

          // Clear local emphasis tracking
          lastFocusedSeriesRef.current = null;

          // Reset widths on THIS chart, falling back to table highlight if active
          const u = chartInstanceRef.current;
          if (u) {
            applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', chartLineWidthRef.current);
            u.redraw(); // Full redraw to reset stroke colors and widths
          }

          // Clear cross-chart emphasis for OTHER charts (falls back to table highlight internally)
          ctx.highlightUPlotSeries(chartId, null);
        }
      };
    }, [chartId]);

    // Function to check if this chart is currently the active (hovered) chart
    // Used by tooltipPlugin to only show tooltip on the directly-hovered chart
    // CRITICAL: Uses hoveredChartIdRef for SYNCHRONOUS access during cursor sync events
    // The ref is updated immediately when setHoveredChart is called, while React state is async
    // This prevents race conditions where tooltips appear on multiple charts
    const isActiveChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        // If no context, default to active (standalone chart)
        if (!ctx) return true;
        // Use ref for synchronous read (falls back to state for backwards compatibility)
        const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
        // Active if no chart is hovered or this chart is the hovered one
        return currentHovered === null || currentHovered === chartId;
      };
    }, [chartId]);

    // Build uPlot options
    const options = useMemo<uPlot.Options>(() => {
      const isDark = theme === "dark";
      const axisColor = isDark ? "#fff" : "#000";
      const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

      // Series configuration (extracted to lib/series-config.ts)
      const series = buildSeriesConfig(processedLines, xlabel, chartLineWidth, {
        lastFocusedSeriesRef,
        crossChartHighlightRef,
        tableHighlightRef,
      });

      // Scales configuration
      // IMPORTANT: Always use auto:true for X-axis to allow zoom to work.
      // Global X range is applied AFTER chart creation via setScale(), not via range function.
      // Using a range function breaks zoom because uPlot calls it after zoom completes.
      const scales: uPlot.Scales = {
        x: logXAxis
          ? { distr: 3 }
          : isDateTime
            ? { time: true, auto: true }
            : { auto: true },
        // For Y-axis: use auto:true to enable dynamic rescaling via setScale()
        // When yMin/yMax props are set, use a fixed range function to enforce bounds
        // When outlier-aware range is active, constrain Y to exclude statistical outliers
        y: logYAxis
          ? { distr: 3 }
          : (yMinProp != null || yMaxProp != null)
            ? {
                auto: false,
                range: (u: uPlot, dataMin: number, dataMax: number): uPlot.Range.MinMax => {
                  const range = dataMax - dataMin;
                  const padding = Math.max(range * 0.05, Math.abs(dataMax) * 0.02, 0.1);
                  const autoMin = dataMin >= 0 ? Math.max(0, dataMin - padding) : dataMin - padding;
                  const autoMax = dataMax + padding;
                  return [yMinProp ?? autoMin, yMaxProp ?? autoMax];
                },
              }
            : yRange[2]
              ? {
                  auto: false,
                  range: (): uPlot.Range.MinMax => [yRange[0], yRange[1]],
                }
              : { auto: true },
      };

      // Axes configuration - compact sizes to fit within container
      const axes: uPlot.Axis[] = [
        {
          // X axis
          show: showXAxis !== false,
          stroke: axisColor,
          grid: { stroke: gridColor, dash: [2, 2] },
          ticks: { stroke: gridColor, size: 3 },
          values: isDateTime
            ? (u, vals) => vals.map((v) => smartDateFormatter(v, timeRange))
            : (u, vals) => formatAxisLabels(vals),
          label: xlabel,
          labelSize: xlabel ? 14 : 0,
          labelFont: "10px ui-monospace, monospace",
          font: "9px ui-monospace, monospace",
          size: xlabel ? 32 : 24, // Compact height for x-axis
          gap: 2,
        },
        {
          // Y axis
          show: showYAxis !== false,
          stroke: axisColor,
          grid: { stroke: gridColor, dash: [2, 2] },
          ticks: { stroke: gridColor, size: 3 },
          values: (u, vals) => formatAxisLabels(vals),
          label: ylabel,
          labelSize: ylabel ? 14 : 0,
          labelFont: "10px ui-monospace, monospace",
          font: "9px ui-monospace, monospace",
          size: ylabel ? 50 : 40, // Compact width for y-axis
          gap: 2,
        },
      ];

      // Cursor configuration
      const cursor: uPlot.Cursor = {
        sync: {
          key: effectiveSyncKey,
          scales: ["x", null], // Sync X-axis zoom across charts (Y-axis independent)
          setSeries: false, // DISABLED - was causing seriesIdx to always be null due to cross-chart sync
        },
        focus: {
          prox: -1, // Always highlight the closest series regardless of distance
        },
        drag: {
          x: true,
          y: false,
          setScale: true,
        },
      };

      // Legend configuration
      const legend: uPlot.Legend = {
        show: showLegend,
      };

      // Selection box - CSS styling is applied in global styles (index.css)
      // BBox properties are initial values - uPlot updates them during drag
      const select: uPlot.Select = {
        show: true,
        over: true, // Place selection in .u-over (above chart)
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      };

      // Build setCursor hooks (extracted to lib/cursor-hooks.ts)
      const focusDetectionHook = buildFocusDetectionHook({
        processedLines,
        tooltipInterpolation,
        isActiveChart,
        lastFocusedSeriesRef,
        highlightedSeriesRef,
        chartId,
        chartSyncContextRef: chartSyncContextRef as any,
      });

      const interpolationDotsHook = buildInterpolationDotsHook({
        processedLines,
        tooltipInterpolation,
        isActiveChart,
      });

      // Build bands for min/max envelope rendering
      // Detects envelope companion series and creates fill between min/max pairs
      const bands: uPlot.Band[] = [];
      const envelopePairs = new Map<string, { minIdx?: number; maxIdx?: number; color?: string }>();
      for (let i = 0; i < processedLines.length; i++) {
        const line = processedLines[i];
        if (line.envelopeOf && line.envelopeBound) {
          const key = line.envelopeOf;
          if (!envelopePairs.has(key)) {
            envelopePairs.set(key, {});
          }
          const pair = envelopePairs.get(key)!;
          // uPlot series index = line index + 1 (index 0 is x-axis)
          if (line.envelopeBound === "min") {
            pair.minIdx = i + 1;
          } else {
            pair.maxIdx = i + 1;
          }
          pair.color = line.color;
        }
      }
      for (const pair of envelopePairs.values()) {
        if (pair.minIdx != null && pair.maxIdx != null) {
          bands.push({
            series: [pair.maxIdx, pair.minIdx],
            fill: applyAlpha(pair.color || "#888", 0.12),
          });
        }
      }

      return {
        // Initial size - will be updated via setSize() on resize
        width: 400,
        height: 300,
        series,
        scales,
        axes,
        cursor,
        legend,
        select,
        bands: bands.length > 0 ? bands : undefined,
        // Top-level focus configuration (required for series highlighting)
        // alpha < 1 dims unfocused series when one is focused
        focus: {
          alpha: 0.3, // Dim unfocused series to 30% opacity
        },
        plugins: [
          tooltipPlugin({
            theme: theme,
            isDateTime,
            timeRange,
            lines: processedLines,
            hoverStateRef, // Survives chart recreation
            onHoverChange: handleHoverChange, // Notifies context of hover state
            isActiveChart, // Checks if this chart is the one being hovered
            highlightedSeriesRef, // For showing highlighted series at top of tooltip
            tooltipInterpolation, // Interpolation mode for missing tooltip values
          }),
        ],
        hooks: {
          ready: [
            (u) => {
              // Store chart instance for resetting emphasis on mouseleave
              chartInstanceRef.current = u;

              // Create interpolation dot overlay elements (one per series)
              if (tooltipInterpolation !== "none") {
                const dots: HTMLDivElement[] = [];
                for (let i = 1; i < u.series.length; i++) {
                  const dot = document.createElement("div");
                  dot.style.cssText =
                    "position:absolute;width:8px;height:8px;border-radius:50%;border:2px solid;transform:translate(-50%,-50%);pointer-events:none;display:none;z-index:100;background:transparent;";
                  u.over.appendChild(dot);
                  dots.push(dot);
                }
                (u as any)._interpDots = dots;
              }
            },
          ],
          setCursor: [
            focusDetectionHook,
            interpolationDotsHook,
          ],
          setSeries: [
            (u, seriesIdx, opts) => {
              // This hook fires when uPlot's built-in focus changes (rarely works with sync)
              // Manual focus detection in setCursor handles emphasis instead
            },
          ],
          setScale: [
            (u, scaleKey) => {
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
                if (!isProgrammatic && !isSyncing && isActiveChart()) {
                  chartSyncContextRef.current?.syncXScale(chartId, xMin, xMax);
                  // Mark that user has manually zoomed (prevents global range from overwriting)
                  userHasZoomedRef.current = true;
                  // Store zoom in context so newly mounted charts use the same zoom
                  chartSyncContextRef.current?.setSyncedZoomRange([xMin, xMax]);
                  // Debug: log when zoom is stored in context
                  if (process.env.NODE_ENV === 'development') {
                    console.log(`[uPlot ${chartId}] Zoom applied, storing in context: [${xMin}, ${xMax}]`);
                  }
                }

                // Auto-scale Y axis when X scale changes (zoom)
                if (!logYAxis) {
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
                    const range = visibleYMax - visibleYMin;
                    // Add 5% padding, with minimum padding for flat lines
                    const padding = Math.max(range * 0.05, Math.abs(visibleYMax) * 0.02, 0.1);
                    let newYMin = visibleYMin >= 0 ? Math.max(0, visibleYMin - padding) : visibleYMin - padding;
                    let newYMax = visibleYMax + padding;

                    // Respect manual bounds if set
                    if (yMinProp != null) newYMin = yMinProp;
                    if (yMaxProp != null) newYMax = yMaxProp;

                    // Only update if meaningfully different to avoid infinite loops
                    const currentYMin = u.scales.y.min ?? 0;
                    const currentYMax = u.scales.y.max ?? 1;
                    const threshold = (currentYMax - currentYMin) * 0.01;

                    if (Math.abs(newYMin - currentYMin) > threshold ||
                        Math.abs(newYMax - currentYMax) > threshold) {
                      u.setScale("y", { min: newYMin, max: newYMax });
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
                // This fires on any user zoom, independent of rawLines/reprocessForZoom.
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

                // ZOOM-AWARE RE-DOWNSAMPLING: When raw data and reprocess callback
                // are available, re-downsample the visible range for more detail
                const raw = rawLinesRef.current;
                const reprocessFn = reprocessForZoomRef.current;
                if (raw && raw.length > 0 && reprocessFn && !isProgrammatic && !isSyncing) {
                  // Debounce to avoid frame-by-frame recomputation during drag
                  if (zoomResampleTimerRef.current) {
                    clearTimeout(zoomResampleTimerRef.current);
                  }
                  zoomResampleTimerRef.current = setTimeout(() => {
                    zoomResampleTimerRef.current = null;
                    const chart = u;
                    const currentXMin = chart.scales.x.min;
                    const currentXMax = chart.scales.x.max;
                    if (currentXMin == null || currentXMax == null) return;

                    const currentLines = processedLinesRef.current;
                    // Delegate all processing (slicing + downsampling + smoothing) to parent
                    const newLines = reprocessForZoomRef.current?.(raw, currentXMin, currentXMax);
                    if (!newLines) return;

                    // Only update if series count matches (setData can't change series count)
                    if (newLines.length === currentLines.length) {
                      const newAligned = alignDataForUPlot(newLines);
                      try {
                        isProgrammaticScaleRef.current = true;
                        chart.batch(() => {
                          chart.setData(newAligned);
                          // Restore the zoom range since setData may reset it
                          chart.setScale("x", { min: currentXMin, max: currentXMax });
                        });
                        // Flush any lingering microtask commits from setData while
                        // isProgrammaticScaleRef is still true. Without this, deferred
                        // commits fire after the guard is lowered and can trigger spurious
                        // syncXScale calls that leave isSyncingZoomRef stuck at true.
                        chart.batch(() => {});
                      } finally {
                        isProgrammaticScaleRef.current = false;
                      }
                    }
                  }, 150); // 150ms debounce
                }
              }
            },
          ],
          // Note: setSelect hook removed - zoom is handled by cursor.drag.setScale: true
          // The setScale hook above handles Y-axis auto-scaling when X scale changes
        },
      };
      // Note: width/height excluded from deps - size changes handled by separate setSize() effect
      // Note: xRange removed - global range is set via setScale() after chart creation, not in options
      // Note: yRange included when outlier-aware (yRange[2]) to apply IQR-based Y constraints
    }, [
      processedLines,
      theme,
      isDateTime,
      logXAxis,
      logYAxis,
      xlabel,
      ylabel,
      showXAxis,
      showYAxis,
      showLegend,
      effectiveSyncKey,
      timeRange,
      chartId,
      handleHoverChange,
      isActiveChart,
      chartLineWidth,
      yMinProp,
      yMaxProp,
      tooltipInterpolation,
      yRange,
    ]);

    // Store cleanup function ref for proper cleanup on unmount
    const cleanupRef = useRef<(() => void) | null>(null);

    // Track if chart has been created - used to decide between create vs resize
    const chartCreatedRef = useRef(false);

    // Track initial dimensions for chart creation
    const initialDimensionsRef = useRef<{ width: number; height: number } | null>(null);

    // Track zoom state to preserve across chart recreations
    const zoomStateRef = useRef<{ xMin: number; xMax: number } | null>(null);

    // Track previous data structure to detect if setData() can be used
    const prevDataStructureRef = useRef<{ seriesCount: number } | null>(null);

    // Track previous data reference to avoid unnecessary setData calls on resize
    const prevDataRef = useRef<uPlot.AlignedData | null>(null);

    // Track previous options reference to detect options-only changes (e.g. Y bounds)
    const prevOptionsRef = useRef<uPlot.Options | null>(null);

    // Store dimensions when first valid
    useEffect(() => {
      if (width > 0 && height > 0 && !initialDimensionsRef.current) {
        initialDimensionsRef.current = { width, height };
      }
    }, [width, height]);

    // Create chart when container has dimensions and data is ready
    // Note: We intentionally recreate the chart when options change because
    // uPlot doesn't support updating options after creation. The yRangeFn
    // for auto-scaling is baked into the options at creation time.
    useEffect(() => {
      // Use stored initial dimensions or current dimensions
      const dims = initialDimensionsRef.current || { width, height };

      if (!chartContainerRef.current || dims.width === 0 || dims.height === 0) {
        return;
      }

      const currentSeriesCount = uplotData.length;

      // If chart already exists and only dimensions changed (not data/options),
      // skip recreation - the separate setSize effect handles resize
      if (chartRef.current && chartCreatedRef.current) {
        // Check if data AND options actually changed (avoid unnecessary recreation on resize)
        if (prevDataRef.current === uplotData && prevOptionsRef.current === options) {
          // Neither data nor options changed - this is just a resize, skip
          return;
        }

        // Check if we can use setData() instead of full recreation
        // setData() preserves zoom state and is more efficient
        // But only if options haven't changed - uPlot bakes scale range functions
        // into options at creation time, so options changes require full recreation
        if (
          prevOptionsRef.current === options &&
          prevDataStructureRef.current &&
          prevDataStructureRef.current.seriesCount === currentSeriesCount
        ) {
          // Structure and options are the same - use setData() to preserve zoom
          try {
            isProgrammaticScaleRef.current = true;
            chartRef.current.batch(() => {
              chartRef.current!.setData(uplotData);
            });
          } finally {
            isProgrammaticScaleRef.current = false;
          }
          prevDataRef.current = uplotData;
          return;
        }
        // If series count changed, we need to recreate (handled below)
      }

      // Save zoom state before destroying chart (if user has zoomed)
      if (chartRef.current) {
        const xScale = chartRef.current.scales.x;
        // Only save if user has explicitly zoomed (min/max are set)
        if (xScale.min != null && xScale.max != null) {
          zoomStateRef.current = { xMin: xScale.min, xMax: xScale.max };
        }
        chartRef.current.destroy();
        chartRef.current = null;
      }

      // Clear container using safe DOM method
      while (chartContainerRef.current.firstChild) {
        chartContainerRef.current.removeChild(chartContainerRef.current.firstChild);
      }

      // Create new chart with stored dimensions
      const chartOptions = { ...options, width: dims.width, height: dims.height };
      let chart: uPlot;
      try {
        isProgrammaticScaleRef.current = true;
        chart = new uPlot(chartOptions, uplotData, chartContainerRef.current);
        // Flush uPlot's pending microtask commit synchronously so setScale hooks
        // fire while isProgrammaticScaleRef is still true. Without this, commit()
        // defers to a microtask which fires AFTER the finally block resets the guard.
        chart.batch(() => {});
      } finally {
        isProgrammaticScaleRef.current = false;
      }
      chartRef.current = chart;
      chartCreatedRef.current = true;

      // Hide legend rows for "(original)" smoothing companion series
      // so the legend matches the tooltip format (combined values per run)
      // legendRows[0] is the x-axis, so data series start at index 1
      const legendRows = chart.root.querySelectorAll(".u-series");
      processedLines.forEach((line, idx) => {
        if (line.hideFromLegend && legendRows[idx + 1]) {
          (legendRows[idx + 1] as HTMLElement).style.display = "none";
        }
      });

      // Track data structure, data reference, and options for future optimization
      prevDataStructureRef.current = { seriesCount: currentSeriesCount };
      prevDataRef.current = uplotData;
      prevOptionsRef.current = options;

      // Set initial X-axis range based on priority:
      // 1. User's previous zoom state (if they had zoomed before chart recreation)
      // 2. Global X range from context (unified range across all selected runs)
      // 3. Auto-scale (let uPlot figure it out from data)
      // Determine which zoom to apply:
      // 1. Local zoom state (from zoomStateRef - this chart's previous zoom)
      // 2. Synced zoom from context (user zoomed on another chart)
      // 3. Global range from context (default)
      let rangeToApply: [number, number] | null = null;
      let isUserZoom = false;

      if (zoomStateRef.current) {
        const { xMin, xMax } = zoomStateRef.current;
        // Validate that the saved zoom overlaps with current data
        const xData = uplotData[0] as number[];
        if (xData.length > 0) {
          const dataMin = arrayMin(xData);
          const dataMax = arrayMax(xData);
          if (xMin < dataMax && xMax > dataMin) {
            rangeToApply = [xMin, xMax];
            isUserZoom = true;
          }
        }
        // Clear local zoom state after checking
        zoomStateRef.current = null;
      }

      if (!rangeToApply && !logXAxis && !isDateTime) {
        // Check context for synced zoom or global range
        const syncedZoom = chartSyncContext?.syncedZoomRange ?? chartSyncContextRef.current?.syncedZoomRange;
        const globalRange = chartSyncContext?.globalXRange ?? chartSyncContextRef.current?.globalXRange;

        // Debug: log what we're reading from context on chart creation
        if (process.env.NODE_ENV === 'development') {
          console.log(`[uPlot ${chartId}] Chart creation - syncedZoom:`, syncedZoom, 'globalRange:', globalRange);
        }

        if (syncedZoom) {
          // Validate synced zoom overlaps with data
          const xData = uplotData[0] as number[];
          if (xData.length > 0) {
            const dataMin = arrayMin(xData);
            const dataMax = arrayMax(xData);
            const hasOverlap = syncedZoom[0] < dataMax && syncedZoom[1] > dataMin;
            if (process.env.NODE_ENV === 'development') {
              console.log(`[uPlot ${chartId}] Zoom validation - syncedZoom: [${syncedZoom[0]}, ${syncedZoom[1]}], dataRange: [${dataMin}, ${dataMax}], hasOverlap: ${hasOverlap}`);
            }
            if (hasOverlap) {
              rangeToApply = syncedZoom;
              isUserZoom = true;
            }
          } else if (process.env.NODE_ENV === 'development') {
            console.log(`[uPlot ${chartId}] No xData to validate zoom against`);
          }
        }

        if (!rangeToApply && globalRange) {
          rangeToApply = globalRange;
        }
      }

      // Apply the determined range immediately (no requestAnimationFrame for faster visual update)
      if (rangeToApply) {
        const [rangeMin, rangeMax] = rangeToApply;
        lastAppliedGlobalRangeRef.current = [rangeMin, rangeMax];
        userHasZoomedRef.current = isUserZoom;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[uPlot ${chartId}] Applying range: [${rangeMin}, ${rangeMax}], isUserZoom: ${isUserZoom}`);
        }
        // Set scale immediately - uPlot supports this right after creation
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
        // No external range to apply - check if data needs single-point centering.
        // When all data shares one x-value, uPlot auto-scale puts the point at the edge.
        // Center it instead by adding symmetric padding around the value.
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

      // Style the selection box for zoom visibility (uPlot's default is nearly invisible)
      // Use requestAnimationFrame to ensure uPlot has created the DOM elements
      const containerEl = chartContainerRef.current;
      requestAnimationFrame(() => {
        const selectEl = containerEl?.querySelector('.u-select') as HTMLElement | null;
        if (selectEl) {
          const isDark = theme === 'dark';
          selectEl.style.background = isDark ? 'rgba(100, 150, 255, 0.2)' : 'rgba(100, 150, 255, 0.15)';
          selectEl.style.border = isDark ? '1px solid rgba(100, 150, 255, 0.9)' : '1px solid rgba(100, 150, 255, 0.8)';
        }
      });

      // Register with context for cross-chart coordination
      // Use ref to avoid depending on context object (which changes on hover)
      chartSyncContextRef.current?.registerUPlot(chartId, chart);

      // Register a reset callback that restores the original full-range data.
      // This is called by context.resetZoom() on OTHER charts when one chart resets.
      // Using uplotDataRef ensures we always have the latest full-range data.
      // IMPORTANT: The callback must be completely self-contained — it restores data,
      // resets the X scale, and clears all zoom state. The context's resetZoom() simply
      // calls this callback without any additional scale manipulation.
      chartSyncContextRef.current?.registerResetCallback(chartId, () => {
        if (zoomResampleTimerRef.current) {
          clearTimeout(zoomResampleTimerRef.current);
          zoomResampleTimerRef.current = null;
        }
        if (zoomRangeTimerRef.current) {
          clearTimeout(zoomRangeTimerRef.current);
          zoomRangeTimerRef.current = null;
        }
        const fullData = uplotDataRef.current;
        isProgrammaticScaleRef.current = true;
        try {
          // Step 1: Restore full-range data. setData() schedules a microtask commit.
          chart.setData(fullData);
          // Step 2: Force synchronous commit so scales are recalculated immediately
          // while isProgrammaticScaleRef is still true (prevents hook side effects).
          chart.batch(() => {});
          // Step 3: Explicitly set X scale to full data range. setData's auto-scale
          // may not reset the X range when cursor sync is active.
          const xVals = fullData[0] as number[];
          if (xVals && xVals.length > 0) {
            chart.setScale("x", { min: xVals[0], max: xVals[xVals.length - 1] });
            // Force commit for the scale change
            chart.batch(() => {});
          }
        } finally {
          isProgrammaticScaleRef.current = false;
        }
        userHasZoomedRef.current = false;
        zoomStateRef.current = null;
        lastAppliedGlobalRangeRef.current = null;
        onZoomRangeChangeRef.current?.(null);
      });

      // Safety: Re-check synced zoom from context in next frame
      // This handles race conditions where context wasn't yet updated during chart creation
      if (!rangeToApply && !logXAxis && !isDateTime) {
        requestAnimationFrame(() => {
          const ctx = chartSyncContextRef.current;
          const lateSyncedZoom = ctx?.syncedZoomRange;
          if (lateSyncedZoom && chart) {
            const xData = chart.data[0] as number[];
            if (xData && xData.length > 0) {
              const dataMin = arrayMin(xData);
              const dataMax = arrayMax(xData);
              const hasOverlap = lateSyncedZoom[0] < dataMax && lateSyncedZoom[1] > dataMin;
              if (hasOverlap && !lastAppliedGlobalRangeRef.current) {
                if (process.env.NODE_ENV === 'development') {
                  console.log(`[uPlot ${chartId}] Late sync - applying zoom: [${lateSyncedZoom[0]}, ${lateSyncedZoom[1]}]`);
                }
                lastAppliedGlobalRangeRef.current = lateSyncedZoom;
                userHasZoomedRef.current = true;
                try {
                  isProgrammaticScaleRef.current = true;
                  chart.batch(() => {
                    chart.setScale("x", { min: lateSyncedZoom[0], max: lateSyncedZoom[1] });
                  });
                } catch {
                  // Chart may have been destroyed
                } finally {
                  isProgrammaticScaleRef.current = false;
                }
              }
            }
          }
        });
      }

      // Double-click to reset zoom
      const handleDblClick = () => {
        // Cancel any pending zoom timers so they don't overwrite the reset
        if (zoomResampleTimerRef.current) {
          clearTimeout(zoomResampleTimerRef.current);
          zoomResampleTimerRef.current = null;
        }
        if (zoomRangeTimerRef.current) {
          clearTimeout(zoomRangeTimerRef.current);
          zoomRangeTimerRef.current = null;
        }
        try {
          isProgrammaticScaleRef.current = true;
          chart.batch(() => {
            // Restore the original full-range data (not chart.data which may be
            // zoomed re-downsampled data)
            chart.setData(uplotData);
          });
        } finally {
          isProgrammaticScaleRef.current = false;
        }
        // Reset Y-axis bounds for this chart
        onResetBoundsRef.current?.();
        // Clear saved zoom state so it doesn't get restored on next data update
        zoomStateRef.current = null;
        // Clear user zoom flag so global range can be applied again
        userHasZoomedRef.current = false;
        lastAppliedGlobalRangeRef.current = null;
        // Reset toast tracking so it can show again if needed
        noDataToastShownRef.current = null;
        // Notify parent that zoom was reset (clear server re-fetch)
        onZoomRangeChangeRef.current?.(null);
        // Clear synced zoom in context so all charts reset
        chartSyncContextRef.current?.setSyncedZoomRange(null);
        // Force-clear the sync guard before calling resetZoom.
        // Microtask commits from zoom re-downsampling can leave isSyncingZoomRef stuck
        // at true, which would cause resetZoom to bail out. Since dblclick is always a
        // deliberate user action, it's safe to override the guard here.
        const syncRef = chartSyncContextRef.current?.isSyncingZoomRef;
        if (syncRef) syncRef.current = false;
        // Reset all other charts to full range
        chartSyncContextRef.current?.resetZoom(chartId);
        // Re-apply global range if available (use ref since this is an event handler)
        const globalRange = chartSyncContextRef.current?.globalXRange;
        if (globalRange && !logXAxis && !isDateTime) {
          const [globalMin, globalMax] = globalRange;
          lastAppliedGlobalRangeRef.current = [globalMin, globalMax];
          requestAnimationFrame(() => {
            try {
              isProgrammaticScaleRef.current = true;
              chart.batch(() => {
                chart.setScale("x", { min: globalMin, max: globalMax });
              });
            } catch {
              // Ignore errors
            } finally {
              isProgrammaticScaleRef.current = false;
            }
          });
        }
      };
      const container = chartContainerRef.current;
      container.addEventListener("dblclick", handleDblClick);

      // Store cleanup function
      cleanupRef.current = () => {
        chartSyncContextRef.current?.unregisterUPlot(chartId);
        chartSyncContextRef.current?.unregisterResetCallback(chartId);
        container?.removeEventListener("dblclick", handleDblClick);
      };

      return () => {
        cleanupRef.current?.();
        if (chartRef.current) {
          chartRef.current.destroy();
          chartRef.current = null;
        }
        chartCreatedRef.current = false;
      };
      // Note: width/height are included but effect checks chartCreatedRef to avoid recreation
      // on resize - recreation only happens when options/data change, not on dimension changes.
      // This fixes the issue where chart never gets created if initial dimensions are 0.
      // IMPORTANT: chartSyncContext excluded - accessing via ref to prevent recreation on hover changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options, uplotData, chartId, width, height]);

    // Handle resize separately - uses setSize() instead of recreating chart
    // Guard with isProgrammaticScaleRef because setSize() triggers uPlot's auto-scale
    // (via commit()), which fires the setScale hook. Without the guard, a resize during
    // scroll (when no chart is hovered) would broadcast the auto-scaled range to context,
    // corrupting syncedZoomRange - especially problematic for single-point charts whose
    // auto-scaled range (e.g. [0, 1]) overwrites other charts' ranges.
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

    // NOTE: Data updates are handled by the chart creation effect above,
    // which already depends on uplotData. A separate setData effect was
    // removed because it caused issues with scale calculation when both
    // effects ran simultaneously.

    // NOTE: Cross-chart highlighting is now handled directly in the setSeries hook
    // via chartSyncContextRef.current?.highlightUPlotSeries() which directly
    // manipulates other uPlot instances. This avoids React state timing issues.

    // Expose imperative handle
    useImperativeHandle(
      ref,
      () => ({
        getChart: () => chartRef.current,
        resetZoom: () => {
          // Reset by restoring the original full-range data (not chart.data
          // which may be zoomed re-downsampled data)
          if (chartRef.current) {
            if (zoomResampleTimerRef.current) {
              clearTimeout(zoomResampleTimerRef.current);
              zoomResampleTimerRef.current = null;
            }
            try {
              isProgrammaticScaleRef.current = true;
              chartRef.current.setData(uplotDataRef.current);
            } finally {
              isProgrammaticScaleRef.current = false;
            }
          }
        },
      }),
      []
    );

    return (
      <div
        ref={containerRef}
        data-testid="line-chart-container"
        className={cn("p-1", className)}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        {...rest}
      >
        {title && (
          <div
            data-testid="chart-title"
            className="shrink-0 truncate text-center font-mono text-xs px-1"
            style={{ color: theme === "dark" ? "#fff" : "#000" }}
          >
            {title}
          </div>
        )}
        <div
          ref={chartContainerRef}
          data-testid="uplot-render-target"
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            // overflow visible to allow selection box to render
            overflow: "visible",
          }}
        />
      </div>
    );
  }
);

LineChartUPlotInner.displayName = "LineChartUPlot";

// Memoize the component to prevent unnecessary re-renders
const LineChartUPlot = React.memo(LineChartUPlotInner);

export default LineChartUPlot;
