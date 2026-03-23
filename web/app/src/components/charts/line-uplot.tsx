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
import { formatAxisLabel, formatAxisLabels, formatRelativeTimeValue, formatRelativeTimeValues, smartDateFormatter } from "./lib/format";
import { arrayMin, arrayMax, filterDataForLogScale, alignDataForUPlot } from "./lib/data-processing";

/** Check if a zoom range [min, max] overlaps with the data in an x-axis array. */
function zoomOverlapsData(zoom: [number, number], xData: readonly number[]): boolean {
  if (xData.length === 0) return false;
  const dataMin = arrayMin(xData as number[]);
  const dataMax = arrayMax(xData as number[]);
  return zoom[0] < dataMax && zoom[1] > dataMin;
}
import { tooltipPlugin, type HoverState } from "./lib/tooltip-plugin";
import { buildSeriesConfig } from "./lib/series-config";
import { buildFocusDetectionHook, buildInterpolationDotsHook } from "./lib/cursor-hooks";
import { nonFiniteMarkersPlugin } from "./lib/non-finite-markers-plugin";
import { useContainerSize } from "./hooks/use-container-size";
import { createPortal } from "react-dom";


// ============================
// Chart title with hover tooltip (avoids Radix TooltipProvider per chart)
// ============================

const ChartTitle = React.memo(function ChartTitle({
  title,
  theme,
}: {
  title: string;
  theme: string;
}) {
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  const handlePointerEnter = React.useCallback(() => {
    const el = titleRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) { return; }
    const rect = el.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const handlePointerLeave = React.useCallback(() => {
    setTooltipPos(null);
  }, []);

  return (
    <>
      <div
        ref={titleRef}
        data-testid="chart-title"
        className="relative z-10 shrink-0 truncate text-center font-mono text-xs px-1"
        style={{ color: theme === "dark" ? "#fff" : "#000" }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {title}
      </div>
      {tooltipPos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 max-w-sm -translate-x-1/2 -translate-y-full rounded-md bg-muted px-3 py-1.5 text-xs break-all font-mono text-muted-foreground"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 4 }}
          >
            {title}
          </div>,
          document.body,
        )}
    </>
  );
});


// ============================
// Types
// ============================

export interface LineData {
  x: number[];
  y: (number | null)[];
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
  /** Map from x-value to set of non-finite flags found in the aggregation bucket.
   *  Used for rendering markers (△ for +Inf, ▽ for -Inf, ⊗ for NaN). */
  nonFiniteMarkers?: Map<number, Set<"NaN" | "Inf" | "-Inf">>;
  /** Human-readable run name (for tooltip column customization) */
  runName?: string;
  /** Run ID / external ID (for tooltip column customization) */
  runId?: string;
  /** Metric name this series is plotting (for tooltip column customization) */
  metricName?: string;
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
  /** Human-readable run name (for tooltip column customization) */
  runName?: string;
  /** Run ID / external ID (for tooltip column customization) */
  runId?: string;
  /** Metric name this series is plotting (for tooltip column customization) */
  metricName?: string;
}

interface LineChartProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: LineData[];
  isDateTime?: boolean;
  logXAxis?: boolean;
  logYAxis?: boolean;
  xlabel?: string;
  ylabel?: string;
  title?: string;
  /** Subtitle shown in tooltip header (e.g. chip/pattern names) */
  subtitle?: string;
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
  /** When false, lines break at null/missing values instead of connecting across gaps (default: true) */
  spanGaps?: boolean;
  /** Enable Y-axis drag-to-zoom. When enabled, drag direction determines axis:
   *  horizontal drag zooms X, vertical drag zooms Y (adaptive mode). */
  yZoom?: boolean;
  /** Externally-stored Y zoom range. When provided, the chart initializes with this
   *  Y range instead of auto-scaling. Used to persist Y zoom across mini/fullscreen. */
  yZoomRange?: [number, number] | null;
  /** Called when the user drags to zoom the Y axis, or null when Y zoom is reset. */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
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
// Helpers
// ============================

/**
 * Compute data min/max from uPlot series data when uPlot passes null bounds
 * (happens when auto:false is set, since uPlot skips data range accumulation).
 * For log scale, only positive values are considered.
 */
function computeFallbackRange(u: uPlot, isLog: boolean): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < u.data.length; i++) {
    const s = u.data[i] as (number | null | undefined)[];
    if (!s) { continue; }
    for (let j = 0; j < s.length; j++) {
      const v = s[j];
      if (v != null && Number.isFinite(v) && (!isLog || v > 0)) {
        if (v < min) { min = v; }
        if (v > max) { max = v; }
      }
    }
  }
  return min > max ? null : [min, max];
}


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
      subtitle,
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
      spanGaps = true,
      yZoom = true,
      yZoomRange,
      onYZoomRangeChange,
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
      isPinned: false,
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

    // Whether this chart uses relative time x-axis (values in seconds, formatted dynamically)
    const isRelativeTime = xlabel === "relative time";

    // Zoom group: charts with the same group sync zoom. Uses semantic type so that
    // e.g. Step charts don't sync with Relative Time charts (different x-axis semantics).
    // All relative time charts share one group regardless of display unit.
    const zoomGroup = isRelativeTime ? "relative-time" : (xlabel || "default");

    // Track last focused series for emphasis persistence (don't reset on seriesIdx=null)
    const lastFocusedSeriesRef = useRef<number | null>(null);

    // Track cross-chart highlighted run ID (from other charts in the sync group)
    const crossChartRunIdRef = useRef<string | null>(null);

    // Track table-driven highlighted series name (from runs table hover)
    // Prefer the context's imperative ref (updated by DOM event handler) over local ref.
    // The local ref fallback is for when there's no sync context.
    const localTableHighlightRef = useRef<string | null>(null);
    const tableHighlightRef = chartSyncContext?.tableHighlightedSeriesRef ?? localTableHighlightRef;

    // Ref for tooltip to access highlighted series name synchronously
    const highlightedSeriesRef = useRef<string | null>(null);

    // Ref for line width so event handlers can read the latest value
    const chartLineWidthRef = useRef(chartLineWidth);
    chartLineWidthRef.current = chartLineWidth;

    // Ref for spanGaps so zoom callbacks can read the latest value
    const spanGapsRef = useRef(spanGaps);
    spanGapsRef.current = spanGaps;

    // Track series manually hidden via legend clicks (seriesId → hidden).
    // Persists across chart recreations (e.g. zoom-triggered re-fetch) so toggled
    // series stay hidden. Separate from context's hiddenRunIdsRef (runs table toggle).
    const legendHiddenSeriesRef = useRef<Set<string>>(new Set());

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

    // Prune stale entries from legend-hidden set when series change (e.g. runs deselected)
    if (legendHiddenSeriesRef.current.size > 0) {
      const validIds = new Set(processedLines.map((l) => l.seriesId ?? l.label));
      legendHiddenSeriesRef.current.forEach((id) => {
        if (!validIds.has(id)) {
          legendHiddenSeriesRef.current.delete(id);
        }
      });
    }

    // Cross-chart highlight is handled fully by the imperative highlightUPlotSeries path
    // in chart-sync-context.tsx which directly sets _crossHighlightRunId on chart instances
    // and calls redraw(). No reactive useEffect needed — refs avoid re-render cascades.

    // Table highlight is now handled imperatively: the DOM event handler in
    // chart-sync-context updates tableHighlightedSeriesRef and calls
    // applySeriesHighlight + redraw on all registered charts directly.
    // The draw hook reads tableHighlightRef (aliased to context ref) for z-order.

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
    // Pass spanGaps so alignDataForUPlot can insert gap markers when lines should break
    const uplotData = useMemo<uPlot.AlignedData>(
      () => alignDataForUPlot(processedLines, { spanGaps }),
      [processedLines, spanGaps]
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

    // Track if user has manually zoomed Y-axis via drag (when yZoom enabled).
    // When set, auto Y-rescale on X zoom is skipped to preserve the user's Y range.
    const userHasZoomedYRef = useRef(yZoomRange != null);
    // Store the user's Y zoom range so we can restore it after uPlot's auto-range overwrites it
    const userYZoomRangeRef = useRef<[number, number] | null>(yZoomRange ?? null);
    // Flag to suppress Y handler from overwriting saved range during X zoom auto-range
    const isXZoomAutoRangeRef = useRef(false);
    // Ref for onYZoomRangeChange callback so we don't recreate the chart when it changes
    const onYZoomRangeChangeRef = useRef(onYZoomRangeChange);
    onYZoomRangeChangeRef.current = onYZoomRangeChange;

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

    // Sync Y zoom range from prop (e.g. fullscreen chart updated the shared range).
    // Updates refs and applies to the live chart so mini↔fullscreen stay in sync.
    useEffect(() => {
      // Update refs to match prop
      if (yZoomRange) {
        userHasZoomedYRef.current = true;
        userYZoomRangeRef.current = yZoomRange;
      } else {
        userHasZoomedYRef.current = false;
        userYZoomRangeRef.current = null;
      }
      // Apply to live chart
      const chart = chartRef.current;
      if (!chart) return;
      try {
        isProgrammaticScaleRef.current = true;
        if (yZoomRange) {
          chart.batch(() => {
            chart.setScale("y", { min: yZoomRange[0], max: yZoomRange[1] });
          });
        }
      } catch { /* disposed chart */ } finally {
        isProgrammaticScaleRef.current = false;
      }
    }, [yZoomRange]);

    // Update existing charts when zoom range changes (either global or synced)
    // Priority: syncedZoomRange > globalXRange
    useEffect(() => {
      const chart = chartRef.current;
      const syncedZoom = chartSyncContext?.syncedZoomRange;
      const syncedGroup = chartSyncContext?.syncedZoomGroupRef?.current ?? null;
      const globalRange = chartSyncContext?.globalXRange;

      // Debug: log when this effect runs
      if (process.env.NODE_ENV === 'development') {
        console.log(`[uPlot ${chartId}] Zoom sync effect - chart:`, !!chart, 'syncedZoom:', syncedZoom, 'syncedGroup:', syncedGroup, 'zoomGroup:', zoomGroup, 'globalRange:', globalRange);
      }

      // Skip if no chart or special axis types
      if (!chart || logXAxis || isDateTime) return;

      // Get chart's data range for validation
      const xData = chart.data[0] as number[];

      // Determine which range to use
      // Priority: syncedZoomRange (if group matches) > cross-group zoom > globalXRange
      const groupMatches = syncedGroup === zoomGroup;
      let rangeToApply = (syncedZoom && groupMatches) ? syncedZoom : null;

      // Check cross-group zoom (step↔relative-time translation)
      if (!rangeToApply) {
        const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
        if (crossZoom && crossZoom.group === zoomGroup) {
          rangeToApply = crossZoom.range;
        }
      }

      if (!rangeToApply) {
        rangeToApply = globalRange ?? null;
      }

      // Validate syncedZoom - if it doesn't overlap with THIS chart's data, fall back to globalRange
      // IMPORTANT: Do NOT clear syncedZoomRange in context here! Other charts may still have
      // overlapping data. Each chart should just locally fall back to globalRange.
      if (syncedZoom && groupMatches && !zoomOverlapsData(syncedZoom, xData)) {
        // Zoom is completely outside THIS chart's data range - fall back to global range locally
        rangeToApply = globalRange ?? null;
        // Don't clear syncedZoomRange - other charts may still use it
      }

      // When there's no range to apply but the chart was previously zoomed
      // (e.g. zoom group changed and syncedZoomRange was cleared), auto-scale
      // back to the full data range.
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
      // Update user zoom flag based on whether we're applying a synced zoom (same or cross-group)
      const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
      const isCrossGroupZoom = crossZoom && crossZoom.group === zoomGroup;
      userHasZoomedRef.current = !!(syncedZoom && groupMatches) || !!isCrossGroupZoom;
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
    }, [chartSyncContext?.syncedZoomRange, chartSyncContext?.globalXRange, logXAxis, isDateTime, zoomGroup]);

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
            // Clear instance-level overrides so stroke function falls back to refs
            delete (u as any)._lastFocusedSeriesIdx;
            (u as any)._crossHighlightRunId = null;
            applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', chartLineWidthRef.current);
            u.redraw(false); // Redraw without rebuildPaths to preserve Y-axis zoom
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

    // Tooltip row hover emphasis: mirrors focus-detection logic from cursor-hooks.ts
    const handleTooltipSeriesHover = useMemo(() => {
      return (seriesLabel: string | null, runId: string | null) => {
        const u = chartInstanceRef.current;
        const ctx = chartSyncContextRef.current;
        if (!u) return;

        if (seriesLabel) {
          // Find the series index by label — check both the uPlot label and the original
          // processedLines label (which may differ if the legend uses a short displayId)
          const seriesIdx = u.series.findIndex((s, i) => {
            if (i === 0) return false;
            if (typeof s.label === "string" && s.label === seriesLabel) return true;
            const origLabel = processedLinesRef.current[i - 1]?.label;
            return origLabel === seriesLabel;
          });
          if (seriesIdx > 0) {
            lastFocusedSeriesRef.current = seriesIdx;
            (u as any)._lastFocusedSeriesIdx = seriesIdx;
            (u as any)._crossHighlightRunId = null;
            // Apply width emphasis
            const lw = chartLineWidthRef.current;
            const highlightedWidth = Math.max(1, lw * 1.25);
            const dimmedWidth = Math.max(0.4, lw * 0.85);
            for (let si = 1; si < u.series.length; si++) {
              u.series[si].width = si === seriesIdx ? highlightedWidth : dimmedWidth;
            }
            u.redraw(false);
          }
          // Cross-chart highlighting
          highlightedSeriesRef.current = seriesLabel;
          ctx?.setHighlightedSeriesName(seriesLabel);
          if (runId) {
            ctx?.highlightUPlotSeries(chartId, runId);
            ctx?.setHighlightedRunId(runId);
          }
        } else {
          // Clear emphasis
          lastFocusedSeriesRef.current = null;
          delete (u as any)._lastFocusedSeriesIdx;
          (u as any)._crossHighlightRunId = null;
          const lw = chartLineWidthRef.current;
          applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', lw);
          u.redraw(false);
          ctx?.highlightUPlotSeries(chartId, null);
        }
      };
    }, [chartId]);

    // Strict check: is this chart the one the user is actively interacting with?
    // Unlike isActiveChart (which returns true when no chart is hovered), this returns
    // true ONLY when the user is hovering this specific chart. Used for zoom broadcast
    // to prevent spurious broadcasts when no chart is hovered (e.g. resize, scroll).
    const isZoomSourceChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return true; // standalone chart
        const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
        return currentHovered === chartId;
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
        crossChartRunIdRef,
        tableHighlightRef,
      }, {
        spanGaps,
        theme,
        // Legend x-axis value formatter — matches the axis tick formatter
        xLegendValue: isDateTime
          ? (_u, val) => val == null ? "--" : smartDateFormatter(val, timeRange)
          : isRelativeTime
            ? (_u, val) => val == null ? "--" : formatRelativeTimeValue(val)
            : (_u, val) => val == null ? "--" : formatAxisLabel(val),
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
            : isRelativeTime
              ? (u, vals) => formatRelativeTimeValues(vals)
              : (u, vals) => formatAxisLabels(vals, logXAxis),
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
          values: (u, vals) => formatAxisLabels(vals, logYAxis),
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
          // IMPORTANT: Do NOT sync scales via uPlot's built-in mechanism.
          // It syncs ALL charts with the same key regardless of zoom group,
          // causing Step zoom to leak to Relative Time charts. Our custom
          // syncXScale handles zoom sync with proper group filtering.
          scales: [null, null],
          setSeries: false, // DISABLED - was causing seriesIdx to always be null due to cross-chart sync
          // Filter out drag events on the receiving side to avoid uPlot bug:
          // src.scales[xKeySrc].ori crashes when xKeySrc is null (from scales above).
          // Cursor position sync still works; drag/zoom sync is handled by our syncXScale.
          filters: {
            pub: () => true,
            sub: (_type: string, src: uPlot) => !(src?.cursor?.drag as any)?._x && !(src?.cursor?.drag as any)?._y,
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
        spanGaps,
        isActiveChart,
        lastFocusedSeriesRef,
        highlightedSeriesRef,
        chartLineWidthRef,
        chartId,
        chartSyncContextRef: chartSyncContextRef as any,
      });

      const interpolationDotsHook = buildInterpolationDotsHook({
        processedLines,
        tooltipInterpolation,
        spanGaps,
        isActiveChart,
      });

      // Build bands for min/max envelope rendering
      // Detects envelope companion series and creates fill between min/max pairs.
      // Dashed series get a more prominent envelope fill (Neptune-style: the
      // auto-smoothed trend line sits on top of a visible data-range band).
      const bands: uPlot.Band[] = [];
      const envelopePairs = new Map<string, { minIdx?: number; maxIdx?: number; color?: string; parentLabel?: string }>();
      for (let i = 0; i < processedLines.length; i++) {
        const line = processedLines[i];
        if (line.envelopeOf && line.envelopeBound) {
          const key = line.envelopeOf;
          if (!envelopePairs.has(key)) {
            envelopePairs.set(key, { parentLabel: key });
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
      for (const [, pair] of envelopePairs) {
        if (pair.minIdx != null && pair.maxIdx != null) {
          // Check if the parent series is dashed — use higher fill opacity
          // so the data range band is clearly visible behind the smooth trend line
          const parentLine = processedLines.find(
            (l) => l.label === pair.parentLabel && !l.envelopeOf,
          );
          const isDashedParent = !!parentLine?.dash;
          const baseAlpha = isDashedParent ? 0.22 : 0.15;
          // Use the parent line's color for the band fill so it matches the curve
          const bandColor = parentLine?.color || pair.color || "#888";
          // Get the run ID from the envelope's seriesId (for emphasis matching)
          const envSeriesId = processedLines[pair.minIdx - 1]?.seriesId;
          const envRunId = envSeriesId ? envSeriesId.split(':')[0] : null;

          bands.push({
            series: [pair.maxIdx, pair.minIdx],
            // Dynamic fill: dim bands for non-highlighted runs during emphasis
            fill: (u: uPlot) => {
              const localFocus = (u as any)._lastFocusedSeriesIdx !== undefined
                ? (u as any)._lastFocusedSeriesIdx
                : lastFocusedSeriesRef.current;
              const crossId = crossChartRunIdRef.current ?? (u as any)._crossHighlightRunId ?? null;
              const tableId = tableHighlightRef.current;
              const activeId = crossId ?? tableId;

              // No emphasis active — show bands at default alpha
              if (localFocus === null && activeId === null) {
                return applyAlpha(bandColor, baseAlpha);
              }

              // For local focus, check if the focused series belongs to this run
              if (localFocus !== null) {
                const focusedId = (u.series[localFocus] as any)?._seriesId;
                const focusedRunId = focusedId ? focusedId.split(':')[0] : null;
                if (focusedRunId === envRunId) {
                  return applyAlpha(bandColor, baseAlpha);
                }
                return applyAlpha(bandColor, baseAlpha * 0.15);
              }

              // For cross-chart / table emphasis, match by run ID
              if (activeId === envRunId) {
                return applyAlpha(bandColor, baseAlpha);
              }
              return applyAlpha(bandColor, baseAlpha * 0.15);
            },
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
        // Disable uPlot's built-in focus dimming — our custom stroke function
        // in series-config.ts handles all emphasis/dimming via dynamic rgba() colors.
        // Setting alpha: 1 prevents double-dimming (uPlot globalAlpha * stroke alpha).
        focus: {
          alpha: 1,
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
            spanGaps, // When false, don't interpolate across data gaps in tooltip
            xlabel,
            title,
            subtitle,
            onSeriesHover: handleTooltipSeriesHover, // Emphasis on tooltip row hover
          }),
          nonFiniteMarkersPlugin({
            lines: processedLines,
            theme: theme,
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
              // When a user clicks a legend entry to toggle visibility, also toggle
              // companion series (smoothing originals + min/max envelope bands)
              // so they stay in sync with the primary series.
              if (seriesIdx == null || seriesIdx < 1) return;

              const toggled = processedLinesRef.current[seriesIdx - 1];
              if (!toggled) return;
              // Only handle primary series toggles (not companions themselves)
              if (toggled.envelopeOf || toggled.hideFromLegend) return;

              const shouldShow = u.series[seriesIdx].show;
              const seriesId = (u.series[seriesIdx] as any)?._seriesId as string | undefined;
              // Use the original label from processedLines (not the potentially-shortened series label)
              const originalLabel = toggled.label;

              // Track legend-toggled visibility so it persists across chart recreations
              // (e.g. zoom-triggered data refetch that rebuilds the chart).
              if (seriesId) {
                if (shouldShow) {
                  legendHiddenSeriesRef.current.delete(seriesId);
                } else {
                  legendHiddenSeriesRef.current.add(seriesId);
                }
              }

              // Find and sync companion series
              for (let i = 1; i < u.series.length; i++) {
                if (i === seriesIdx) continue;
                const companion = processedLinesRef.current[i - 1];
                if (!companion) continue;

                const isCompanion =
                  // Envelope boundaries reference the parent's original label
                  (companion.envelopeOf && companion.envelopeOf === originalLabel) ||
                  // Hidden-from-legend companions share the same seriesId
                  (companion.hideFromLegend && seriesId && (companion.seriesId === seriesId));

                if (isCompanion && u.series[i].show !== shouldShow) {
                  u.setSeries(i, { show: shouldShow }, false);
                }
              }
            },
          ],
          draw: [
            (u) => {
              // Re-stroke highlighted series on top so it isn't obscured by later-indexed series.
              // uPlot draws series in array order; this hook fires after ALL series are drawn.
              // Read from both refs and chart instance (imperative path sets instance values first)
              const localFocusIdx = (u as any)._lastFocusedSeriesIdx !== undefined
                ? (u as any)._lastFocusedSeriesIdx
                : lastFocusedSeriesRef.current;
              const crossChartRunId = crossChartRunIdRef.current ?? (u as any)._crossHighlightRunId ?? null;
              const tableId = tableHighlightRef.current;

              if (localFocusIdx === null && crossChartRunId === null && tableId === null) return;

              // Collect highlighted series indices — only primary visible curves
              // (skip envelope boundaries and raw/original companions)
              const highlightedIndices: number[] = [];
              for (let si = 1; si < u.series.length; si++) {
                if (!u.series[si].show) continue;
                const lineData = processedLinesRef.current[si - 1];
                if (lineData?.envelopeOf || lineData?.hideFromLegend) continue;
                if (localFocusIdx !== null) {
                  if (si === localFocusIdx) highlightedIndices.push(si);
                } else {
                  const seriesId = (u.series[si] as any)?._seriesId;
                  const matchId = crossChartRunId ?? tableId;
                  if (seriesId === matchId || (seriesId && seriesId.startsWith(matchId + ':'))) {
                    highlightedIndices.push(si);
                  }
                }
              }
              if (highlightedIndices.length === 0) return;

              const ctx = u.ctx;
              const { left, top, width: bboxW, height: bboxH } = u.bbox;

              // Unified outline for all emphasis types (local, cross-chart, table hover)
              // Outline width scales with the user's line width setting
              const outlineColor = theme === "dark" ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.45)";
              const lw = chartLineWidthRef.current;
              const outlineExtra = Math.max(2, lw * 1.5) * devicePixelRatio;

              for (const si of highlightedIndices) {
                const s = u.series[si];
                const paths = (s as any)._paths;
                if (!paths?.stroke) continue;

                const lineWidth = Math.round((s.width ?? 1.5) * devicePixelRatio * 1000) / 1000;
                const outlineWidth = lineWidth + outlineExtra;
                const offset = (lineWidth % 2) / 2;

                // --- Pass 1: Dark outline (wider, behind) ---
                ctx.save();
                const outClip = new Path2D();
                outClip.rect(left - outlineWidth / 2, top - outlineWidth / 2, bboxW + outlineWidth, bboxH + outlineWidth);
                ctx.clip(outClip);
                if (paths.clip) ctx.clip(paths.clip);
                if (offset > 0) ctx.translate(offset, offset);
                ctx.lineWidth = outlineWidth;
                ctx.strokeStyle = outlineColor;
                ctx.lineJoin = 'round';
                ctx.lineCap = ((s as any).cap ?? 'butt') as CanvasLineCap;
                if (s.dash) ctx.setLineDash(s.dash.map((v: number) => v * devicePixelRatio));
                ctx.stroke(paths.stroke);
                if (offset > 0) ctx.translate(-offset, -offset);
                ctx.restore();

                // --- Pass 2: Colored stroke on top ---
                ctx.save();
                const boundsClip = new Path2D();
                boundsClip.rect(left - lineWidth / 2, top - lineWidth / 2, bboxW + lineWidth, bboxH + lineWidth);
                ctx.clip(boundsClip);
                if (paths.clip) ctx.clip(paths.clip);
                if (offset > 0) ctx.translate(offset, offset);
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = typeof s.stroke === 'function' ? s.stroke(u, si) : (s.stroke as string);
                ctx.lineJoin = 'round';
                ctx.lineCap = ((s as any).cap ?? 'butt') as CanvasLineCap;
                if (s.dash) ctx.setLineDash(s.dash.map((v: number) => v * devicePixelRatio));
                ctx.stroke(paths.stroke);
                if (offset > 0) ctx.translate(-offset, -offset);
                ctx.restore();
              }
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
                      const newAligned = alignDataForUPlot(newLines, { spanGaps: spanGapsRef.current });
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

              // Y-axis zoom detection moved to setSelect hook below
            },
          ],
          // Capture Y-axis drag-zoom directly from the selection rect.
          // setSelect fires during mouseUp BEFORE _setScale, so we can compute
          // the Y range from the selection box. This avoids relying on the setScale
          // hook for Y (which fires at unpredictable times due to deferred commits).
          ...(yZoom ? { setSelect: [
            (u: uPlot) => {
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
            },
          ] } : {}),
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
      isZoomSourceChart,
      chartLineWidth,
      spanGaps,
      yMinProp,
      yMaxProp,
      tooltipInterpolation,
      yRange,
      yZoom,
    ]);

    // Store cleanup function ref for proper cleanup on unmount
    const cleanupRef = useRef<(() => void) | null>(null);

    // Track if chart has been created - used to decide between create vs resize
    const chartCreatedRef = useRef(false);

    // Track zoom state to preserve across chart recreations
    const zoomStateRef = useRef<{ xMin: number; xMax: number } | null>(null);

    // Track previous data structure to detect if setData() can be used
    const prevDataStructureRef = useRef<{ seriesCount: number } | null>(null);

    // Track previous data reference to avoid unnecessary setData calls on resize
    const prevDataRef = useRef<uPlot.AlignedData | null>(null);

    // Track previous options reference to detect options-only changes (e.g. Y bounds)
    const prevOptionsRef = useRef<uPlot.Options | null>(null);

    // Create chart when container has dimensions and data is ready
    // Note: We intentionally recreate the chart when options change because
    // uPlot doesn't support updating options after creation. The yRangeFn
    // for auto-scaling is baked into the options at creation time.
    useEffect(() => {
      // Always use current dimensions from ResizeObserver
      const dims = { width, height };

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
          // Structure and options are the same - use setData() for efficiency, then restore zoom
          try {
            isProgrammaticScaleRef.current = true;
            chartRef.current.batch(() => {
              chartRef.current!.setData(uplotData);
            });

            // Re-apply synced zoom after setData (which resets scales to auto).
            // Without this, data refreshes (standard query replacing preview,
            // stale-time refetch) reset the X scale to full data range, losing zoom.
            // Mirrors the pattern in the zoom re-downsample path (~line 1039-1041).
            if (!logXAxis && !isDateTime) {
              const syncedZoom = chartSyncContextRef.current?.syncedZoomRange;
              const syncedGroup = chartSyncContextRef.current?.syncedZoomGroupRef?.current;
              const xData = uplotData[0] as number[];
              if (syncedZoom && syncedGroup === zoomGroup && zoomOverlapsData(syncedZoom, xData)) {
                chartRef.current.batch(() => {
                  chartRef.current!.setScale("x", { min: syncedZoom[0], max: syncedZoom[1] });
                });
              } else {
                // Check cross-group zoom (step↔relative-time translation)
                const crossZoom = chartSyncContextRef.current?.crossGroupZoomRef?.current;
                if (crossZoom && crossZoom.group === zoomGroup && zoomOverlapsData(crossZoom.range, xData)) {
                  chartRef.current.batch(() => {
                    chartRef.current!.setScale("x", { min: crossZoom.range[0], max: crossZoom.range[1] });
                  });
                }
              }
            }
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

      // Expose uPlot instance on root DOM element for E2E test access
      (chart.root as any)._uplot = chart;

      // Hide legend rows for "(original)" smoothing companion series
      // so the legend matches the tooltip format (combined values per run)
      // legendRows[0] is the x-axis, so data series start at index 1
      const legendRows = chart.root.querySelectorAll(".u-series");
      processedLines.forEach((line, idx) => {
        if (line.hideFromLegend && legendRows[idx + 1]) {
          (legendRows[idx + 1] as HTMLElement).style.display = "none";
        }
      });

      // Apply hidden run state from context (series that should be invisible)
      const hiddenIds = chartSyncContextRef.current?.hiddenRunIdsRef?.current;
      // Apply legend-toggled visibility (series hidden via legend click, persists across recreations)
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
        const syncedGroup = chartSyncContext?.syncedZoomGroupRef?.current ?? chartSyncContextRef.current?.syncedZoomGroupRef?.current;
        const globalRange = chartSyncContext?.globalXRange ?? chartSyncContextRef.current?.globalXRange;

        // Debug: log what we're reading from context on chart creation
        if (process.env.NODE_ENV === 'development') {
          console.log(`[uPlot ${chartId}] Chart creation - syncedZoom:`, syncedZoom, 'syncedGroup:', syncedGroup, 'zoomGroup:', zoomGroup, 'globalRange:', globalRange);
        }

        if (syncedZoom && syncedGroup === zoomGroup) {
          // Validate synced zoom overlaps with data
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
          } else if (process.env.NODE_ENV === 'development' && xData.length === 0) {
            console.log(`[uPlot ${chartId}] No xData to validate zoom against`);
          }
        }

        // Check cross-group zoom (step↔relative-time translation for single-run view)
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
          // Step 3: Use globalXRange for X scale so all charts reset to the same range.
          // Falls back to per-chart data range if globalXRange is unavailable.
          const globalRange = chartSyncContextRef.current?.globalXRange;
          if (globalRange) {
            chart.setScale("x", { min: globalRange[0], max: globalRange[1] });
          } else {
            const xVals = fullData[0] as number[];
            if (xVals && xVals.length > 0) {
              chart.setScale("x", { min: xVals[0], max: xVals[xVals.length - 1] });
            }
          }
          // Force commit for the scale change
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

      // Register a zoom callback that wraps setScale in isProgrammaticScaleRef guard.
      // This is called by context.syncXScale() on OTHER charts when one chart zooms.
      // The guard prevents the setScale hook from broadcasting back to context.
      // Skip for log X-axis and datetime charts — their X scale is incompatible
      // with linear zoom ranges, and applying linear values would corrupt the axis.
      // The zoomGroup ensures only charts with the same x-axis type sync (e.g. Step ↔ Step).
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
      // This handles race conditions where context wasn't yet updated during chart creation
      if (!rangeToApply && !logXAxis && !isDateTime) {
        requestAnimationFrame(() => {
          const ctx = chartSyncContextRef.current;
          const lateSyncedZoom = ctx?.syncedZoomRange;
          const lateZoomGroup = ctx?.syncedZoomGroupRef?.current;
          let lateRange: [number, number] | null = null;

          if (lateSyncedZoom && lateZoomGroup === zoomGroup) {
            lateRange = lateSyncedZoom;
          } else {
            // Check cross-group zoom
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
        // Cancel any pending zoom timers so they don't overwrite the reset
        if (zoomResampleTimerRef.current) {
          clearTimeout(zoomResampleTimerRef.current);
          zoomResampleTimerRef.current = null;
        }
        if (zoomRangeTimerRef.current) {
          clearTimeout(zoomRangeTimerRef.current);
          zoomRangeTimerRef.current = null;
        }
        // Restore data and apply globalXRange synchronously (not in RAF).
        // Using RAF caused source chart to show a different range than target charts
        // because resetZoom callbacks fire synchronously while source chart's range
        // was deferred to the next frame.
        // Reset logic mirrors registerResetCallback for consistency:
        // restore data, flush, apply globalXRange (or fallback to data range).
        const globalRange = chartSyncContextRef.current?.globalXRange;
        try {
          isProgrammaticScaleRef.current = true;
          // Restore the original full-range data
          chart.setData(uplotData);
          // Force synchronous commit
          chart.batch(() => {});
          // Apply globalXRange or fallback to data range
          if (globalRange) {
            chart.setScale("x", { min: globalRange[0], max: globalRange[1] });
          } else {
            const xVals = uplotData[0] as number[];
            if (xVals && xVals.length > 0) {
              chart.setScale("x", { min: xVals[0], max: xVals[xVals.length - 1] });
            }
          }
          // Force commit for the scale change
          chart.batch(() => {});
        } catch {
          // Ignore errors from destroyed charts
        } finally {
          isProgrammaticScaleRef.current = false;
        }
        // Reset Y-axis bounds for this chart
        onResetBoundsRef.current?.();
        // Clear saved zoom state so it doesn't get restored on next data update
        zoomStateRef.current = null;
        // Clear user zoom flag so global range can be applied again
        userHasZoomedRef.current = false;
        // Clear user Y-zoom flag so auto Y-rescale resumes
        userHasZoomedYRef.current = false;
        userYZoomRangeRef.current = null;
        lastAppliedGlobalRangeRef.current = globalRange ?? null;
        // Reset toast tracking so it can show again if needed
        noDataToastShownRef.current = null;
        // Notify parent that zoom was reset (clear server re-fetch)
        onZoomRangeChangeRef.current?.(null);
        onYZoomRangeChangeRef.current?.(null);
        // Clear synced zoom in context so all charts reset
        chartSyncContextRef.current?.setSyncedZoomRange(null);
        // Clear cross-group zoom
        const crossRef = chartSyncContextRef.current?.crossGroupZoomRef;
        if (crossRef) crossRef.current = null;
        // Force-clear the sync guard before calling resetZoom.
        // Microtask commits from zoom re-downsampling can leave isSyncingZoomRef stuck
        // at true, which would cause resetZoom to bail out. Since dblclick is always a
        // deliberate user action, it's safe to override the guard here.
        const syncRef = chartSyncContextRef.current?.isSyncingZoomRef;
        if (syncRef) syncRef.current = false;
        // Reset all other charts to full range (their reset callbacks use globalXRange too)
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
        {title && <ChartTitle title={title} theme={theme} />}
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
