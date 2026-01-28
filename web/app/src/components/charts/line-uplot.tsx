import React, {
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useId,
  useState,
} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";

// ============================
// Types
// ============================

export interface LineData {
  x: number[];
  y: number[];
  label: string;
  color?: string;
  dashed?: boolean;
  hideFromLegend?: boolean;
  opacity?: number;
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
}

/** Ref handle exposed to parent components */
export interface LineChartUPlotRef {
  getChart: () => uPlot | null;
  resetZoom: () => void;
}

// ============================
// Module-level Registry for Cross-Chart Highlighting
// ============================

/**
 * Module-level registry for uPlot instances to enable cross-chart highlighting.
 * This replaces window globals with a contained module scope.
 * Charts register/unregister themselves on mount/unmount.
 */
const chartRegistry = new Map<string, uPlot>();

/**
 * Highlight or unhighlight a series across all registered charts.
 * @param sourceChartId - The ID of the chart triggering the highlight
 * @param seriesName - The series label to highlight, or null to reset all
 */
function highlightSeriesAcrossCharts(sourceChartId: string, seriesName: string | null): void {
  chartRegistry.forEach((chart, chartId) => {
    if (chartId === sourceChartId) return;

    for (let i = 1; i < chart.series.length; i++) {
      const series = chart.series[i];
      const seriesLabel = typeof series.label === "string" ? series.label : null;
      if (seriesName === null) {
        // Reset all series
        chart.setSeries(i, { focus: false });
      } else if (seriesLabel === seriesName) {
        // Highlight matching series
        chart.setSeries(i, { focus: true });
      } else {
        // Keep non-matching series unfocused
        chart.setSeries(i, { focus: false });
      }
    }
  });
}

// ============================
// Utility Functions
// ============================

const RESIZE_THROTTLE_MS = 200;

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!ref?.current) return;

    const element = ref.current;
    const measureElement = () => {
      const rect = element.getBoundingClientRect();
      const computedStyle = getComputedStyle(element);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
      const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const width = rect.width - paddingLeft - paddingRight;
      const height = rect.height - paddingTop - paddingBottom;
      return { width, height };
    };

    const { width: initialWidth, height: initialHeight } = measureElement();
    if (initialWidth > 0 && initialHeight > 0) {
      setSize({ width: initialWidth, height: initialHeight });
    } else {
      requestAnimationFrame(() => {
        const { width, height } = measureElement();
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      });
    }

    const observer = new ResizeObserver((entries) => {
      const now = Date.now();
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;

      if (now - lastUpdateRef.current >= RESIZE_THROTTLE_MS) {
        lastUpdateRef.current = now;
        setSize({ width, height });
      } else {
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
        }
        pendingUpdateRef.current = setTimeout(() => {
          lastUpdateRef.current = Date.now();
          setSize({ width, height });
          pendingUpdateRef.current = null;
        }, RESIZE_THROTTLE_MS - (now - lastUpdateRef.current));
      }
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, [ref]);

  return size;
}

// Format axis labels with SI units
function formatAxisLabel(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001) {
    return value.toExponential(2).replace(/\.?0+e/, "e");
  }
  const units = [
    { limit: 1e18, suffix: "E" },
    { limit: 1e15, suffix: "P" },
    { limit: 1e12, suffix: "T" },
    { limit: 1e9, suffix: "G" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "k" },
  ];
  for (const { limit, suffix } of units) {
    if (Math.abs(value) >= limit) {
      return `${(value / limit).toPrecision(4).replace(/\.?0+$/, "")}${suffix}`;
    }
  }
  return Number(value).toPrecision(4).replace(/\.?0+$/, "");
}

// Smart date formatter based on range
function smartDateFormatter(value: number, range: number): string {
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = new Date(value);

  const oneMinute = 60000;
  const oneHour = 3600000;
  const oneDay = 86400000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;
  const oneYear = 365 * oneDay;

  if (range < 10 * oneMinute) {
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimezone,
    });
  } else if (range < 2 * oneHour) {
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimezone,
      hour12: false,
    });
  } else if (range < oneDay) {
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: userTimezone,
      hour12: false,
    });
  } else if (range < oneWeek) {
    return localDate.toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < oneMonth) {
    return localDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < oneYear) {
    return localDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < 5 * oneYear) {
    return localDate.toLocaleDateString([], {
      month: "short",
      year: "numeric",
      timeZone: userTimezone,
    });
  } else {
    return localDate.toLocaleDateString([], {
      year: "numeric",
      timeZone: userTimezone,
    });
  }
}

// Filter data for log scale (remove non-positive values)
// Optimized to use single loop instead of multiple map/filter calls
function filterDataForLogScale(
  lines: LineData[],
  logXAxis: boolean,
  logYAxis: boolean
): LineData[] {
  if (!logXAxis && !logYAxis) return lines;

  return lines
    .map((line) => {
      const x: number[] = [];
      const y: number[] = [];
      for (let i = 0; i < line.x.length; i++) {
        const xVal = line.x[i];
        const yVal = line.y[i];
        if (logXAxis && xVal <= 0) continue;
        if (logYAxis && yVal <= 0) continue;
        x.push(xVal);
        y.push(yVal);
      }
      return { ...line, x, y };
    })
    .filter((line) => line.x.length > 0);
}

// ============================
// Tooltip Plugin
// ============================

// Helper to safely create tooltip row using DOM APIs (prevents XSS)
function createTooltipRow(
  name: string,
  value: number,
  color: string,
  textColor: string
): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = "padding: 1px 4px; display: flex; align-items: center; gap: 4px; white-space: nowrap";

  const colorDot = document.createElement("span");
  colorDot.style.cssText = `flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: ${color}`;
  row.appendChild(colorDot);

  const nameSpan = document.createElement("span");
  nameSpan.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0`;
  nameSpan.textContent = name;
  row.appendChild(nameSpan);

  const valueSpan = document.createElement("span");
  valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0`;
  valueSpan.textContent = formatAxisLabel(value);
  row.appendChild(valueSpan);

  return row;
}

function tooltipPlugin(opts: {
  theme: string;
  isDateTime: boolean;
  timeRange: number;
  lines: LineData[];
}): uPlot.Plugin {
  const { theme, isDateTime, timeRange, lines } = opts;

  let tooltipEl: HTMLDivElement | null = null;

  function init(u: uPlot) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "uplot-tooltip";
    tooltipEl.style.cssText = `
      position: absolute;
      display: none;
      pointer-events: auto;
      z-index: 100;
      font-family: ui-monospace, monospace;
      font-size: 10px;
      background: ${theme === "dark" ? "#161619" : "#fff"};
      border: 1px solid ${theme === "dark" ? "#333" : "#e0e0e0"};
      border-radius: 4px;
      padding: 4px;
      max-width: 300px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;
    u.over.appendChild(tooltipEl);
  }

  function setCursor(u: uPlot) {
    if (!tooltipEl) return;

    const { idx } = u.cursor;
    if (idx == null) {
      tooltipEl.style.display = "none";
      return;
    }

    const xVal = u.data[0][idx];
    if (xVal == null) {
      tooltipEl.style.display = "none";
      return;
    }

    // Format x value
    const xFormatted = isDateTime
      ? smartDateFormatter(xVal, timeRange)
      : formatAxisLabel(xVal);

    // Gather series values
    const textColor = theme === "dark" ? "#fff" : "#000";
    const seriesItems: { name: string; value: number; color: string; hidden: boolean }[] = [];

    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      const yVal = u.data[i][idx];
      if (yVal != null && series.show !== false) {
        const lineData = lines[i - 1];
        // Handle label which can be string or HTMLElement
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        seriesItems.push({
          name: labelText,
          value: yVal,
          color: (series.stroke as string) || lineData?.color || "#888",
          hidden: lineData?.hideFromLegend || false,
        });
      }
    }

    // Sort by value descending
    seriesItems.sort((a, b) => b.value - a.value);

    // Filter out hidden series - show ALL series with scrolling
    const visibleItems = seriesItems.filter((s) => !s.hidden);

    // Clear tooltip content safely
    tooltipEl.textContent = "";

    // Create header using safe DOM APIs (prevents XSS)
    const header = document.createElement("div");
    header.style.cssText = `font-weight: bold; color: ${textColor}; padding: 2px 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px; font-size: 10px`;
    header.textContent = `${xFormatted} (${visibleItems.length} series)`;
    tooltipEl.appendChild(header);

    // Create scrollable content container for all series
    const content = document.createElement("div");
    content.style.cssText = "max-height: 40vh; overflow-y: auto; scrollbar-width: thin";

    // Add ALL rows using safe DOM APIs - scrolling handles overflow
    for (const s of visibleItems) {
      content.appendChild(createTooltipRow(s.name, s.value, s.color, textColor));
    }

    tooltipEl.appendChild(content);

    // Position tooltip
    const { left: cursorLeft, top: cursorTop } = u.cursor;
    if (cursorLeft == null || cursorTop == null) {
      tooltipEl.style.display = "none";
      return;
    }

    const tooltipWidth = tooltipEl.offsetWidth || 200;
    const chartWidth = u.over.clientWidth;

    let left = cursorLeft + 15;
    if (left + tooltipWidth > chartWidth) {
      left = cursorLeft - tooltipWidth - 15;
    }

    let top = cursorTop - 80;
    if (top < 0) top = 10;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.display = "block";
  }

  return {
    hooks: {
      init,
      setCursor,
      destroy(u: uPlot) {
        if (tooltipEl && tooltipEl.parentNode) {
          tooltipEl.parentNode.removeChild(tooltipEl);
        }
      },
    },
  };
}

// ============================
// Cross-Chart Highlighting
// ============================

/**
 * Register a chart for cross-chart highlighting and return cleanup function.
 */
function setupCrossChartHighlighting(chartId: string, chart: uPlot): () => void {
  chartRegistry.set(chartId, chart);

  return () => {
    chartRegistry.delete(chartId);
  };
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
      showXAxis = true,
      showYAxis = true,
      showLegend = false,
      syncKey,
      className,
      ...rest
    },
    ref
  ) => {
    const { resolvedTheme: theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<uPlot | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    // Measure the chart container directly (not outer container) for accurate sizing
    const { width, height } = useContainerSize(chartContainerRef);
    const chartId = useId();

    // Process data for log scales
    const processedLines = useMemo(
      () => filterDataForLogScale(lines, logXAxis, logYAxis),
      [lines, logXAxis, logYAxis]
    );

    // Calculate time range for datetime formatting
    const timeRange = useMemo(() => {
      if (!isDateTime || processedLines.length === 0) return 1;
      const allX = processedLines.flatMap((l) => l.x);
      if (allX.length === 0) return 1;
      const min = Math.min(...allX);
      const max = Math.max(...allX);
      return max - min || 1;
    }, [isDateTime, processedLines]);

    // Convert LineData[] to uPlot data format
    const uplotData = useMemo<uPlot.AlignedData>(() => {
      if (processedLines.length === 0) {
        return [[]] as uPlot.AlignedData;
      }

      // Collect all unique x values and sort them
      const xSet = new Set<number>();
      processedLines.forEach((line) => {
        line.x.forEach((x) => xSet.add(x));
      });
      const xValues = Array.from(xSet).sort((a, b) => a - b);

      // Create maps for efficient lookup
      const lineMaps = processedLines.map((line) => {
        const map = new Map<number, number>();
        line.x.forEach((x, i) => map.set(x, line.y[i]));
        return map;
      });

      // Build aligned data arrays
      const data: uPlot.AlignedData = [xValues];
      lineMaps.forEach((map) => {
        const yValues = xValues.map((x) => map.get(x) ?? null);
        data.push(yValues as (number | null)[]);
      });

      return data;
    }, [processedLines]);

    // Build uPlot options
    const options = useMemo<uPlot.Options>(() => {
      const isDark = theme === "dark";
      const axisColor = isDark ? "#fff" : "#000";
      const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

      // Series configuration
      const series: uPlot.Series[] = [
        {
          // X axis
          label: xlabel || "x",
        },
        ...processedLines.map((line, i) => ({
          label: line.label,
          stroke: line.color || `hsl(${(i * 137) % 360}, 70%, 50%)`,
          width: 1.5,
          alpha: line.opacity ?? 0.85,
          dash: line.dashed ? [5, 5] : undefined,
          spanGaps: true,
          points: {
            show: false,
          },
        })),
      ];

      // Scales configuration
      const scales: uPlot.Scales = {
        x: logXAxis
          ? { distr: 3 } // Log scale
          : isDateTime
            ? { time: true }
            : { auto: true },
        y: logYAxis ? { distr: 3 } : { auto: true },
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
            : (u, vals) => vals.map((v) => formatAxisLabel(v)),
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
          values: (u, vals) => vals.map((v) => formatAxisLabel(v)),
          label: ylabel,
          labelSize: ylabel ? 14 : 0,
          labelFont: "10px ui-monospace, monospace",
          font: "9px ui-monospace, monospace",
          size: ylabel ? 50 : 40, // Compact width for y-axis
          gap: 2,
        },
      ];

      // Cursor configuration for sync
      const cursor: uPlot.Cursor = {
        sync: syncKey
          ? {
              key: syncKey,
              setSeries: true,
            }
          : undefined,
        focus: {
          prox: 30,
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

      return {
        // Initial size - will be updated via setSize() on resize
        width: 400,
        height: 300,
        series,
        scales,
        axes,
        cursor,
        legend,
        plugins: [
          tooltipPlugin({
            theme: theme,
            isDateTime,
            timeRange,
            lines: processedLines,
          }),
        ],
        hooks: {
          setSeries: [
            (u, seriesIdx) => {
              // Handle series focus for cross-chart highlighting
              if (seriesIdx == null) {
                highlightSeriesAcrossCharts(chartId, null);
              } else {
                const series = u.series[seriesIdx];
                const seriesLabel = typeof series?.label === "string" ? series.label : null;
                highlightSeriesAcrossCharts(chartId, seriesLabel);
              }
            },
          ],
        },
      };
      // Note: width/height excluded from deps - size changes handled by separate setSize() effect
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
      syncKey,
      timeRange,
      chartId,
    ]);

    // Store cleanup function ref for proper cleanup on unmount
    const cleanupRef = useRef<(() => void) | null>(null);

    // Track if chart has been created - used to decide between create vs resize
    const chartCreatedRef = useRef(false);

    // Create chart when container has dimensions and data is ready
    useEffect(() => {
      if (!chartContainerRef.current || width === 0 || height === 0) return;

      // If chart already exists and only size changed, don't recreate
      // (size changes are handled by the resize effect below)
      if (chartCreatedRef.current && chartRef.current) {
        return;
      }

      // Destroy existing chart if present (shouldn't happen but be safe)
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }

      // Clear container using safe DOM method
      while (chartContainerRef.current.firstChild) {
        chartContainerRef.current.removeChild(chartContainerRef.current.firstChild);
      }

      // Create new chart with current dimensions
      const chartOptions = { ...options, width, height };
      const chart = new uPlot(chartOptions, uplotData, chartContainerRef.current);
      chartRef.current = chart;
      chartCreatedRef.current = true;

      // Setup cross-chart highlighting
      const cleanupHighlight = setupCrossChartHighlighting(chartId, chart);

      // Double-click to reset zoom
      const handleDblClick = () => {
        chart.setData(chart.data);
      };
      const container = chartContainerRef.current;
      container.addEventListener("dblclick", handleDblClick);

      // Store cleanup function
      cleanupRef.current = () => {
        cleanupHighlight();
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
    }, [options, uplotData, chartId, width, height]);

    // Handle resize separately - uses setSize() instead of recreating chart
    useEffect(() => {
      if (chartRef.current && width > 0 && height > 0) {
        chartRef.current.setSize({ width, height });
      }
    }, [width, height]);

    // Expose imperative handle
    useImperativeHandle(
      ref,
      () => ({
        getChart: () => chartRef.current,
        resetZoom: () => {
          // Reset by re-setting data which recalculates auto bounds
          if (chartRef.current) {
            chartRef.current.setData(chartRef.current.data);
          }
        },
      }),
      []
    );

    return (
      <div
        ref={containerRef}
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
            className="shrink-0 truncate text-center font-mono text-xs px-1"
            style={{ color: theme === "dark" ? "#fff" : "#000" }}
          >
            {title}
          </div>
        )}
        <div
          ref={chartContainerRef}
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        />
      </div>
    );
  }
);

LineChartUPlotInner.displayName = "LineChartUPlot";

// Memoized version to prevent unnecessary re-renders
const LineChartUPlot = React.memo(LineChartUPlotInner, (prevProps, nextProps) => {
  // Check array length first
  if (prevProps.lines.length !== nextProps.lines.length) return false;

  // Check each line's key properties
  for (let i = 0; i < prevProps.lines.length; i++) {
    const prev = prevProps.lines[i];
    const next = nextProps.lines[i];
    if (
      prev.label !== next.label ||
      prev.color !== next.color ||
      prev.x.length !== next.x.length ||
      prev.y.length !== next.y.length ||
      prev.dashed !== next.dashed ||
      prev.opacity !== next.opacity
    ) {
      return false;
    }
    // Quick check of first and last data points
    if (prev.x.length > 0) {
      if (
        prev.x[0] !== next.x[0] ||
        prev.x[prev.x.length - 1] !== next.x[next.x.length - 1] ||
        prev.y[0] !== next.y[0] ||
        prev.y[prev.y.length - 1] !== next.y[next.y.length - 1]
      ) {
        return false;
      }
    }
  }

  // Compare other props
  return (
    prevProps.isDateTime === nextProps.isDateTime &&
    prevProps.logXAxis === nextProps.logXAxis &&
    prevProps.logYAxis === nextProps.logYAxis &&
    prevProps.xlabel === nextProps.xlabel &&
    prevProps.ylabel === nextProps.ylabel &&
    prevProps.title === nextProps.title &&
    prevProps.showXAxis === nextProps.showXAxis &&
    prevProps.showYAxis === nextProps.showYAxis &&
    prevProps.showLegend === nextProps.showLegend &&
    prevProps.syncKey === nextProps.syncKey &&
    prevProps.className === nextProps.className
  );
});

export default LineChartUPlot;
