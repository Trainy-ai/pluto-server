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
import { createPortal } from "react-dom";

// Extracted modules
import { formatAxisLabel, formatRelativeTimeValue, smartDateFormatter } from "./lib/format";
import { arrayMin, arrayMax, filterDataForLogScale, alignDataForUPlot } from "./lib/data-processing";
import { tooltipPlugin, type HoverState } from "./lib/tooltip-plugin";
import { buildSeriesConfig } from "./lib/series-config";
import { buildFocusDetectionHook, buildInterpolationDotsHook } from "./lib/cursor-hooks";
import { buildScalesConfig, buildCursorConfig } from "./lib/scales-config";
import { buildAxesConfig } from "./lib/axes-config";
import { buildBandsConfig } from "./lib/bands-config";
import { buildDrawHook } from "./lib/draw-hook";
import { buildSetScaleHook, buildSetSelectHook } from "./lib/set-scale-hook";
import { nonFiniteMarkersPlugin } from "./lib/non-finite-markers-plugin";
import { useContainerSize } from "./hooks/use-container-size";
import { useChartLifecycle } from "./hooks/use-chart-lifecycle";
import { useZoomSync } from "./hooks/use-zoom-sync";
import { useYRange } from "./hooks/use-y-range";

// Re-export types from lib/types
export type { LineData, LineChartUPlotRef } from "./lib/types";
import type { LineChartUPlotRef, LineChartProps } from "./lib/types";
import { DEFAULT_SYNC_KEY } from "./lib/types";


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
      tooltipInterpolation = "none",
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
    const hoverStateRef = useRef<HoverState>({
      isHovering: false, isPinned: false,
      lastIdx: null, lastLeft: null, lastTop: null,
    });
    const { width, height } = useContainerSize(chartContainerRef);
    const chartId = useId();

    // Chart sync context
    const chartSyncContext = useChartSyncContext();
    const chartSyncContextRef = useRef(chartSyncContext);
    useEffect(() => { chartSyncContextRef.current = chartSyncContext; }, [chartSyncContext]);

    const isRelativeTime = xlabel === "relative time";
    const zoomGroup = isRelativeTime ? "relative-time" : (xlabel || "default");

    // Emphasis tracking refs
    const lastFocusedSeriesRef = useRef<number | null>(null);
    const crossChartRunIdRef = useRef<string | null>(null);
    const localTableHighlightRef = useRef<string | null>(null);
    const tableHighlightRef = chartSyncContext?.tableHighlightedSeriesRef ?? localTableHighlightRef;
    const highlightedSeriesRef = useRef<string | null>(null);
    // Ref for tooltip to access highlighted run ID for row matching
    const highlightedRunIdRef = useRef<string | null>(null);
    // Ref for tooltip to access highlighted series ID for exact series matching
    const highlightedSeriesIdRef = useRef<string | null>(null);

    // Stable refs for callbacks
    const chartLineWidthRef = useRef(chartLineWidth);
    chartLineWidthRef.current = chartLineWidth;
    const spanGapsRef = useRef(spanGaps);
    spanGapsRef.current = spanGaps;

    // Legend-hidden series persistence across chart recreations
    const legendHiddenSeriesRef = useRef<Set<string>>(new Set());
    const processedLinesRef = useRef<typeof lines>([]);
    const chartInstanceRef = useRef<uPlot | null>(null);

    const onZoomRangeChangeRef = useRef(onZoomRangeChange);
    onZoomRangeChangeRef.current = onZoomRangeChange;
    const zoomRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const effectiveSyncKey = chartSyncContext?.syncKey ?? syncKey ?? DEFAULT_SYNC_KEY;

    // Process data for log scales
    const processedLines = useMemo(
      () => filterDataForLogScale(lines, logXAxis, logYAxis),
      [lines, logXAxis, logYAxis]
    );
    processedLinesRef.current = processedLines;

    // Prune stale entries from legend-hidden set
    if (legendHiddenSeriesRef.current.size > 0) {
      const validIds = new Set(processedLines.map((l) => l.seriesId ?? l.label));
      legendHiddenSeriesRef.current.forEach((id) => {
        if (!validIds.has(id)) legendHiddenSeriesRef.current.delete(id);
      });
    }

    // Calculate time range for datetime formatting
    const timeRange = useMemo(() => {
      if (!isDateTime || processedLines.length === 0) return 1;
      const allX = processedLines.flatMap((l) => l.x);
      if (allX.length === 0) return 1;
      return (arrayMax(allX) - arrayMin(allX)) || 1;
    }, [isDateTime, processedLines]);

    // Convert LineData[] to uPlot data format
    const uplotData = useMemo<uPlot.AlignedData>(
      () => alignDataForUPlot(processedLines, { spanGaps }),
      [processedLines, spanGaps]
    );
    const uplotDataRef = useRef(uplotData);
    uplotDataRef.current = uplotData;

    // Pre-calculate y-axis range with IQR-based outlier detection (extracted hook)
    const yRange = useYRange(uplotData, logYAxis, outlierDetection);

    // Callback ref for reset bounds (used by chart lifecycle)
    const onResetBoundsRef = useRef<(() => void) | undefined>(undefined);

    // Zoom state refs
    const userHasZoomedRef = useRef(false);
    const userHasZoomedYRef = useRef(yZoomRange != null);
    const userYZoomRangeRef = useRef<[number, number] | null>(yZoomRange ?? null);
    const isXZoomAutoRangeRef = useRef(false);
    const onYZoomRangeChangeRef = useRef(onYZoomRangeChange);
    onYZoomRangeChangeRef.current = onYZoomRangeChange;
    const lastAppliedGlobalRangeRef = useRef<[number, number] | null>(null);
    const isProgrammaticScaleRef = useRef(false);
    const noDataToastShownRef = useRef<string | null>(null);

    // Sync Y zoom range from prop (e.g. fullscreen chart updated the shared range)
    useEffect(() => {
      if (yZoomRange) {
        userHasZoomedYRef.current = true;
        userYZoomRangeRef.current = yZoomRange;
      } else {
        userHasZoomedYRef.current = false;
        userYZoomRangeRef.current = null;
      }
      const chart = chartRef.current;
      if (!chart) return;
      try {
        isProgrammaticScaleRef.current = true;
        if (yZoomRange) {
          chart.batch(() => { chart.setScale("y", { min: yZoomRange[0], max: yZoomRange[1] }); });
        }
      } catch { /* disposed chart */ } finally {
        isProgrammaticScaleRef.current = false;
      }
    }, [yZoomRange]);

    // Zoom sync effect (extracted hook)
    useZoomSync({
      chartRef, chartId, chartSyncContext, chartSyncContextRef,
      logXAxis, isDateTime, zoomGroup,
      userHasZoomedRef, lastAppliedGlobalRangeRef, isProgrammaticScaleRef,
    });

    // Hover change callback
    const handleHoverChange = useMemo(() => {
      return (isHovering: boolean) => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return;
        if (isHovering) {
          ctx.setHoveredChart(chartId);
        } else {
          const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
          if (currentHovered === chartId) ctx.setHoveredChart(null);
          lastFocusedSeriesRef.current = null;
          const u = chartInstanceRef.current;
          if (u) {
            delete (u as any)._lastFocusedSeriesIdx;
            (u as any)._crossHighlightRunId = null;
            applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', chartLineWidthRef.current);
            u.redraw(false);
          }
          ctx.highlightUPlotSeries(chartId, null);
        }
      };
    }, [chartId]);

    const isActiveChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return true;
        const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
        return currentHovered === null || currentHovered === chartId;
      };
    }, [chartId]);

    // Tooltip row hover emphasis
    const handleTooltipSeriesHover = useMemo(() => {
      return (seriesLabel: string | null, runId: string | null, directSeriesIdx?: number) => {
        const u = chartInstanceRef.current;
        const ctx = chartSyncContextRef.current;
        if (!u) return;
        if (seriesLabel) {
          // Use direct series index when available (avoids ambiguity when multiple series share a label)
          const seriesIdx = directSeriesIdx ?? u.series.findIndex((s, i) => {
            if (i === 0) return false;
            if (typeof s.label === "string" && s.label === seriesLabel) return true;
            return processedLinesRef.current[i - 1]?.label === seriesLabel;
          });
          if (seriesIdx > 0) {
            lastFocusedSeriesRef.current = seriesIdx;
            (u as any)._lastFocusedSeriesIdx = seriesIdx;
            (u as any)._crossHighlightRunId = null;
            const lw = chartLineWidthRef.current;
            for (let si = 1; si < u.series.length; si++) {
              u.series[si].width = si === seriesIdx ? Math.max(1, lw * 1.25) : Math.max(0.4, lw * 0.85);
            }
            u.redraw(false);
          }
          highlightedSeriesRef.current = seriesLabel;
          ctx?.setHighlightedSeriesName(seriesLabel);
          if (runId) { ctx?.highlightUPlotSeries(chartId, runId); ctx?.setHighlightedRunId(runId); }
        } else {
          lastFocusedSeriesRef.current = null;
          delete (u as any)._lastFocusedSeriesIdx;
          (u as any)._crossHighlightRunId = null;
          applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', chartLineWidthRef.current);
          u.redraw(false);
          ctx?.highlightUPlotSeries(chartId, null);
        }
      };
    }, [chartId]);

    const isZoomSourceChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return true;
        const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
        return currentHovered === chartId;
      };
    }, [chartId]);

    // Build uPlot options (memoized)
    const options = useMemo<uPlot.Options>(() => {
      const isDark = theme === "dark";
      const axisColor = isDark ? "#fff" : "#000";
      const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

      const series = buildSeriesConfig(processedLines, xlabel, chartLineWidth, {
        lastFocusedSeriesRef, crossChartRunIdRef, tableHighlightRef,
      }, {
        spanGaps, theme,
        xLegendValue: isDateTime
          ? (_u, val) => val == null ? "--" : smartDateFormatter(val, timeRange)
          : isRelativeTime
            ? (_u, val) => val == null ? "--" : formatRelativeTimeValue(val)
            : (_u, val) => val == null ? "--" : formatAxisLabel(val),
      });

      const scales = buildScalesConfig({ logXAxis, logYAxis, isDateTime, yRange, yZoom });
      const axes = buildAxesConfig({ showXAxis, showYAxis, axisColor, gridColor, isDateTime, isRelativeTime, logXAxis, logYAxis, xlabel, ylabel, timeRange });
      const cursor = buildCursorConfig(effectiveSyncKey, yZoom);
      const bands = buildBandsConfig(processedLines, lastFocusedSeriesRef, crossChartRunIdRef, tableHighlightRef);
      const drawHook = buildDrawHook(processedLinesRef, lastFocusedSeriesRef, crossChartRunIdRef, tableHighlightRef, chartLineWidthRef, theme);
      const focusDetectionHook = buildFocusDetectionHook({
        processedLines, tooltipInterpolation, spanGaps, isActiveChart,
        lastFocusedSeriesRef, highlightedSeriesRef, highlightedRunIdRef,
        highlightedSeriesIdRef, chartLineWidthRef,
        chartId, chartSyncContextRef: chartSyncContextRef as any,
      });
      const interpolationDotsHook = buildInterpolationDotsHook({ processedLines, tooltipInterpolation, spanGaps, isActiveChart });
      const setScaleHook = buildSetScaleHook({
        logYAxis, logXAxis,
        isProgrammaticScaleRef, chartSyncContextRef, isZoomSourceChart,
        chartId, zoomGroup, userHasZoomedRef, userHasZoomedYRef,
        userYZoomRangeRef, isXZoomAutoRangeRef, onYZoomRangeChangeRef,
        noDataToastShownRef, processedLinesRef,
        spanGapsRef, zoomRangeTimerRef, onZoomRangeChangeRef,
      });

      return {
        width: 400, height: 300,
        series, scales, axes, cursor,
        legend: { show: showLegend },
        select: { show: true, over: true, left: 0, top: 0, width: 0, height: 0 },
        bands: bands.length > 0 ? bands : undefined,
        focus: { alpha: 1 },
        plugins: [
          // Focus detection must run BEFORE tooltip so highlightedSeriesRef is set
          // when the tooltip reads it to sort/highlight the hovered series
          { hooks: { setCursor: [focusDetectionHook] } },
          tooltipPlugin({
            theme, isDateTime, timeRange, lines: processedLines,
            hoverStateRef, onHoverChange: handleHoverChange,
            isActiveChart, highlightedSeriesRef, highlightedRunIdRef,
            highlightedSeriesIdRef, tooltipInterpolation,
            spanGaps, xlabel, title, subtitle,
            onSeriesHover: handleTooltipSeriesHover,
          }),
          nonFiniteMarkersPlugin({
            lines: processedLines,
            theme: theme,
          }),
        ],
        hooks: {
          ready: [(u) => {
            chartInstanceRef.current = u;
            if (tooltipInterpolation !== "none") {
              const dots: HTMLDivElement[] = [];
              for (let i = 1; i < u.series.length; i++) {
                const dot = document.createElement("div");
                dot.style.cssText = "position:absolute;width:8px;height:8px;border-radius:50%;border:2px solid;transform:translate(-50%,-50%);pointer-events:none;display:none;z-index:100;background:transparent;";
                u.over.appendChild(dot);
                dots.push(dot);
              }
              (u as any)._interpDots = dots;
            }
          }],
          setCursor: [interpolationDotsHook],
          setSeries: [(u, seriesIdx) => {
            if (seriesIdx == null || seriesIdx < 1) return;
            const toggled = processedLinesRef.current[seriesIdx - 1];
            if (!toggled || toggled.envelopeOf || toggled.hideFromLegend) return;
            const shouldShow = u.series[seriesIdx].show;
            const seriesId = (u.series[seriesIdx] as any)?._seriesId as string | undefined;
            const originalLabel = toggled.label;
            if (seriesId) {
              if (shouldShow) legendHiddenSeriesRef.current.delete(seriesId);
              else legendHiddenSeriesRef.current.add(seriesId);
            }
            for (let i = 1; i < u.series.length; i++) {
              if (i === seriesIdx) continue;
              const companion = processedLinesRef.current[i - 1];
              if (!companion) continue;
              const isCompanion =
                (companion.envelopeOf && companion.envelopeOf === originalLabel) ||
                (companion.hideFromLegend && seriesId && (companion.seriesId === seriesId));
              if (isCompanion && u.series[i].show !== shouldShow) u.setSeries(i, { show: shouldShow }, false);
            }
          }],
          draw: [drawHook],
          setScale: [setScaleHook],
          ...(yZoom ? { setSelect: [buildSetSelectHook(userHasZoomedYRef, userYZoomRangeRef, onYZoomRangeChangeRef)] } : {}),
        },
      };
    }, [
      processedLines, theme, isDateTime, logXAxis, logYAxis,
      xlabel, ylabel, showXAxis, showYAxis, showLegend,
      effectiveSyncKey, timeRange, chartId,
      handleHoverChange, isActiveChart, isZoomSourceChart,
      chartLineWidth, spanGaps,
      tooltipInterpolation, yRange, yZoom,
    ]);

    // Chart lifecycle management (extracted hook)
    useChartLifecycle({
      chartContainerRef, chartRef, chartInstanceRef,
      options, uplotData, uplotDataRef,
      processedLines, chartId, width, height,
      logXAxis, isDateTime, zoomGroup, theme,
      chartSyncContext, chartSyncContextRef,
      isProgrammaticScaleRef, userHasZoomedRef,
      userHasZoomedYRef, userYZoomRangeRef,
      lastAppliedGlobalRangeRef,
      zoomRangeTimerRef,
      onResetBoundsRef, onZoomRangeChangeRef,
      onYZoomRangeChangeRef, legendHiddenSeriesRef,
    });

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      getChart: () => chartRef.current,
      resetZoom: () => {
        if (chartRef.current) {
          try {
            isProgrammaticScaleRef.current = true;
            chartRef.current.setData(uplotDataRef.current);
          } finally {
            isProgrammaticScaleRef.current = false;
          }
        }
      },
    }), []);

    return (
      <div
        ref={containerRef}
        data-testid="line-chart-container"
        className={cn("p-1", className)}
        style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        {...rest}
      >
        {title && <ChartTitle title={title} theme={theme} />}
        <div
          ref={chartContainerRef}
          data-testid="uplot-render-target"
          style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "visible" }}
        />
      </div>
    );
  }
);

LineChartUPlotInner.displayName = "LineChartUPlot";

const LineChartUPlot = React.memo(LineChartUPlotInner);

export default LineChartUPlot;
