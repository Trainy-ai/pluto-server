import React, {
  useRef,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useState,
  memo,
  useId,
} from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";

// Extend window interface for chart highlighting functions
declare global {
  interface Window {
    __chartInstances?: Map<string, React.RefObject<ReactECharts | null>>;
    __chartHighlight?: (chartId: string, seriesIndex: number) => void;
    __chartDownplay?: (chartId: string) => void;
  }
}

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
}

// ============================
// Utility Functions
// ============================

// Compute min and max without spread
const findMinMax = (arr: number[]): { min: number; max: number } => {
  if (!arr.length) return { min: 0, max: 1 };
  return arr.reduce(
    (acc, v) => ({ min: Math.min(acc.min, v), max: Math.max(acc.max, v) }),
    { min: arr[0], max: arr[0] },
  );
};

// Escape HTML to prevent XSS attacks in tooltips
// Exported for testing
export function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

// Helper for custom log scale transformation
const LOG_MIN = 1e-10; // Minimum value for log scale to avoid log(0) and log(negative)

function applyLogTransform(value: number): number {
  return Math.log10(Math.max(LOG_MIN, value));
}

function reverseLogTransform(value: number): number {
  return Math.pow(10, value);
}

// Generate log scale axis ticks
function generateLogTicks(min: number, max: number): number[] {
  const logMin = Math.floor(applyLogTransform(Math.max(LOG_MIN, min)));
  const logMax = Math.ceil(applyLogTransform(max));

  const ticks: number[] = [];
  // Only include powers of 10 for cleaner visualization
  for (let i = logMin; i <= logMax; i++) {
    ticks.push(Math.pow(10, i));
  }

  return ticks.filter((tick) => tick >= min && tick <= max);
}

// Generate values for log axis labels
function generateLogAxisLabels(
  min: number,
  max: number,
): { value: number; label: string }[] {
  const ticks = generateLogTicks(min, max);
  return ticks.map((tick) => ({
    value: tick,
    label: formatAxisLabel(tick),
  }));
}

// Throttle interval for resize observer (ms)
const RESIZE_THROTTLE_MS = 200;

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!ref?.current) return;

    const updateSize = (width: number, height: number) => {
      setSize({ width, height });
    };

    // Do an initial measurement immediately - ResizeObserver may not fire
    // synchronously, especially for elements that are lazy-loaded or
    // use absolute positioning
    const element = ref.current;
    const measureElement = () => {
      const rect = element.getBoundingClientRect();
      // Account for padding
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
      updateSize(initialWidth, initialHeight);
    } else {
      // Layout may not be complete yet, retry after a frame
      requestAnimationFrame(() => {
        const { width, height } = measureElement();
        if (width > 0 && height > 0) {
          updateSize(width, height);
        }
      });
    }

    const observer = new ResizeObserver((entries) => {
      const now = Date.now();
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;

      // Ignore zero-size updates which can reset valid measurements
      if (width === 0 || height === 0) return;

      // Throttle updates to avoid excessive re-renders during resize
      if (now - lastUpdateRef.current >= RESIZE_THROTTLE_MS) {
        lastUpdateRef.current = now;
        updateSize(width, height);
      } else {
        // Schedule update for end of throttle period
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
        }
        pendingUpdateRef.current = setTimeout(() => {
          lastUpdateRef.current = Date.now();
          updateSize(width, height);
          pendingUpdateRef.current = null;
        }, RESIZE_THROTTLE_MS - (now - lastUpdateRef.current));
      }
    });

    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, [ref]);

  return size;
}

const isTouchScreenDevice = () => {
  try {
    document.createEvent("TouchEvent");
    return true;
  } catch {
    return false;
  }
};

function calculateAxisInterval(
  extent: { min: number; max: number },
  isMin: boolean,
): number {
  const range = extent.max - extent.min;
  if (range === 0) return isMin ? extent.min : extent.max;
  const magnitude = Math.floor(Math.log10(range));
  const scale = Math.pow(10, magnitude);
  const normalized = range / scale;
  let nice;
  if (normalized <= 1) nice = 0.2;
  else if (normalized <= 2) nice = 0.5;
  else if (normalized <= 5) nice = 1;
  else nice = 2;
  return (
    (isMin
      ? Math.floor(extent.min / (nice * scale))
      : Math.ceil(extent.max / (nice * scale))) *
    nice *
    scale
  );
}

// Numeric label formatter
// Exported for testing
export const formatAxisLabel = (value: number): string => {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001)
    return value.toExponential(2).replace(/\.?0+e/, "e");
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
  return Number(value)
    .toPrecision(4)
    .replace(/\.?0+$/, "");
};

// Smart date formatter
const smartDateFormatter = (value: number, range: number): string => {
  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Create date object from UTC timestamp and convert to user's timezone
  const localDate = new Date(value);

  const oneMinute = 60000;
  const oneHour = 3600000;
  const oneDay = 86400000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;
  const oneYear = 365 * oneDay;

  // More granular formatting based on range
  if (range < 10 * oneMinute) {
    // For very short ranges (seconds)
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimezone,
    });
  } else if (range < 2 * oneHour) {
    // For short ranges (minutes)
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimezone,
      hour12: false,
    });
  } else if (range < oneDay) {
    // For medium ranges (hours)
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: userTimezone,
      hour12: false,
    });
  } else if (range < oneWeek) {
    // For days within a week
    return localDate.toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < oneMonth) {
    // For weeks within a month
    return localDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < oneYear) {
    // For months within a year
    return localDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < 5 * oneYear) {
    // For 1-5 years
    return localDate.toLocaleDateString([], {
      month: "short",
      year: "numeric",
      timeZone: userTimezone,
    });
  } else {
    // For long ranges (many years)
    return localDate.toLocaleDateString([], {
      year: "numeric",
      timeZone: userTimezone,
    });
  }
};

// ============================
// Hook for chart reference management
// ============================

const useChartRef = (
  externalRef: React.Ref<ReactECharts> | undefined,
  deps: React.DependencyList,
  enabled: boolean = true,
) => {
  const internalChartRef = useRef<ReactECharts | null>(null);
  // Track dblclick handler for cleanup to prevent memory leaks
  const dblclickHandlerRef = useRef<(() => void) | null>(null);
  const zrInstanceRef = useRef<ReturnType<ReturnType<ReactECharts["getEchartsInstance"]>["getZr"]> | null>(null);

  const setChartRef = useCallback(
    (ref: ReactECharts | null) => {
      // Clean up previous dblclick handler before setting new ref
      if (zrInstanceRef.current && dblclickHandlerRef.current) {
        try {
          zrInstanceRef.current.off("dblclick", dblclickHandlerRef.current);
        } catch {
          // Ignore errors if instance is already disposed
        }
        dblclickHandlerRef.current = null;
        zrInstanceRef.current = null;
      }

      if (ref && enabled) {
        internalChartRef.current = ref;
        const chart = ref.getEchartsInstance();
        if (chart) {
          chart.dispatchAction({
            type: "takeGlobalCursor",
            key: "dataZoomSelect",
            dataZoomSelectActive: true,
          });
          const zr = chart.getZr();
          if (zr) {
            zrInstanceRef.current = zr;
            // Create named handler so we can remove it later
            const dblclickHandler = () => {
              try {
                chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
              } catch {
                // Ignore errors from disposed chart
              }
            };
            dblclickHandlerRef.current = dblclickHandler;
            zr.on("dblclick", dblclickHandler);
          }
        }
      } else {
        internalChartRef.current = null;
      }

      if (externalRef && enabled) {
        if (typeof externalRef === "function") externalRef(ref);
        else
          (externalRef as React.MutableRefObject<ReactECharts | null>).current =
            ref;
      }
    },
    [externalRef, enabled, ...deps],
  );

  // Cleanup effect for unmount
  useEffect(() => {
    return () => {
      if (zrInstanceRef.current && dblclickHandlerRef.current) {
        try {
          zrInstanceRef.current.off("dblclick", dblclickHandlerRef.current);
        } catch {
          // Instance may already be disposed
        }
      }
      dblclickHandlerRef.current = null;
      zrInstanceRef.current = null;
    };
  }, []);

  return { setChartRef, internalChartRef };
};

// ============================
// Data Processing Functions
// ============================

function filterDataForLogScale(
  lines: LineData[],
  logXAxis: boolean,
  logYAxis: boolean,
): LineData[] {
  if (!logXAxis && !logYAxis) return lines;

  return lines
    .map((line) => {
      let newLine = { ...line, x: [...line.x], y: [...line.y] };

      // First filter out non-positive values
      let validIndices: number[] = [];

      if (logXAxis && logYAxis) {
        // Need both x and y to be positive
        validIndices = line.x
          .map((x, idx) => ({ x, y: line.y[idx], idx }))
          .filter(({ x, y }) => x > 0 && y > 0)
          .map(({ idx }) => idx);
      } else if (logXAxis) {
        validIndices = line.x
          .map((x, idx) => ({ x, idx }))
          .filter(({ x }) => x > 0)
          .map(({ idx }) => idx);
      } else if (logYAxis) {
        validIndices = line.y
          .map((y, idx) => ({ y, idx }))
          .filter(({ y }) => y > 0)
          .map(({ idx }) => idx);
      }

      newLine.x = validIndices.map((idx) => line.x[idx]);
      newLine.y = validIndices.map((idx) => line.y[idx]);

      return newLine;
    })
    .filter((line) => line.x.length > 0);
}

function calculateDataExtents(
  lines: LineData[],
  isDateTime: boolean,
  logXAxis: boolean,
  logYAxis: boolean,
) {
  const allX = lines.flatMap((l) => l.x);
  const allY = lines.flatMap((l) => l.y);
  const { min: rawXMin, max: rawXMax } = findMinMax(allX);
  const { min: rawYMin, max: rawYMax } = findMinMax(allY);

  // Handle log scales for bounds calculation
  let xMin: number, xMax: number, yMin: number, yMax: number;

  // X-axis bounds
  if (logXAxis && rawXMin > 0) {
    // Use custom log scale bounds
    xMin = Math.max(LOG_MIN, rawXMin);
    xMax = rawXMax;
  } else if (rawXMax - rawXMin === 0) {
    // Handle constant values by adding padding for a single data point
    const pad = rawXMin === 0 ? 1 : Math.abs(rawXMin * 0.1);
    xMin = rawXMin - pad;
    xMax = rawXMax + pad;
  } else {
    // Use linear scale nice bounds
    xMin = calculateAxisInterval({ min: rawXMin, max: rawXMax }, true);
    xMax = calculateAxisInterval({ min: rawXMin, max: rawXMax }, false);
  }

  // Y-axis bounds
  if (logYAxis && rawYMin > 0) {
    // Use custom log scale bounds
    yMin = Math.max(LOG_MIN, rawYMin);
    yMax = rawYMax;
  } else if (rawYMax - rawYMin === 0) {
    // Handle constant values by adding padding
    const pad = rawYMin === 0 ? 1 : Math.abs(rawYMin * 0.1);
    yMin = rawYMin - pad;
    yMax = rawYMax + pad;
  } else {
    // Use linear scale nice bounds
    yMin = calculateAxisInterval({ min: rawYMin, max: rawYMax }, true);
    yMax = calculateAxisInterval({ min: rawYMin, max: rawYMax }, false);
  }

  const splits = 5;
  const xInterval = isDateTime || logXAxis ? undefined : (xMax - xMin) / splits;
  const yInterval = logYAxis ? undefined : (yMax - yMin) / splits;
  const timeRange = isDateTime ? rawXMax - rawXMin || 1 : 1;

  const labelCounts: Record<string, number> = {};
  lines.forEach((l) => {
    labelCounts[l.label] = (labelCounts[l.label] || 0) + 1;
  });

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    timeRange,
    labelCounts,
    xInterval,
    yInterval,
  };
}

// ============================
// Chart Configuration Generators
// ============================

function generateLegendConfig(
  lines: LineData[],
  labelCounts: Record<string, number>,
  theme: string,
  showLegend: boolean,
) {
  if (!(lines.length > 1 || showLegend)) return undefined;

  const cols = Math.min(Math.ceil(lines.length / 10), 4);
  const top = cols > 1 ? 60 : 50;

  return {
    type: "scroll" as const,
    orient: "horizontal" as const,
    top,
    data: lines
      .filter((l) => !l.hideFromLegend)
      .map((l, i) => ({
        name: l.label + (labelCounts[l.label] > 1 ? ` (${i + 1})` : ""),
        icon: "circle" as const,
        textStyle: {
          color: l.color || (theme === "dark" ? `#fff` : `#000`),
        },
      })),
  };
}

function generateXAxisOption(
  isDateTime: boolean,
  logXAxis: boolean,
  xMin: number,
  xMax: number,
  xInterval: number | undefined,
  timeRange: number,
  showXAxis: boolean,
  theme: string,
) {
  const commonProps = {
    axisLine: {
      show: showXAxis,
      lineStyle: { color: theme === "dark" ? `#fff` : `#000` },
    },
    axisTick: { show: showXAxis },
    splitLine: { show: false },
    axisLabel: {
      color: theme === "dark" ? `#fff` : `#000`,
      // Add rotation when dealing with datetime to prevent overlap
      rotate: isDateTime ? (timeRange < 86400000 ? 30 : 0) : 0,
      margin: 12,
      // Limit label width to avoid excessive space usage
      width: 80,
      overflow: "truncate" as const,
      // Add interval for large datetime ranges to avoid crowding
      interval: isDateTime && timeRange > 30 * 86400000 ? "auto" : null,
    },
  };

  if (logXAxis) {
    return {
      ...commonProps,
      type: "log" as const,
      logBase: 10,
      min: xMin,
      max: xMax,
      axisLabel: {
        ...commonProps.axisLabel,
        formatter: (value: number) => formatAxisLabel(value),
      },
    };
  } else if (isDateTime) {
    return {
      ...commonProps,
      type: "time" as const,
      min: xMin,
      max: xMax,
      axisLabel: {
        ...commonProps.axisLabel,
        formatter: (value: number) => smartDateFormatter(value, timeRange),
      },
    };
  } else {
    return {
      ...commonProps,
      type: "value" as const,
      min: xMin,
      max: xMax,
      interval: xInterval,
      axisLabel: {
        ...commonProps.axisLabel,
        formatter: (value: number) => formatAxisLabel(value),
      },
    };
  }
}

function generateYAxisOption(
  logYAxis: boolean,
  yMin: number,
  yMax: number,
  yInterval: number | undefined,
  theme: string,
) {
  if (logYAxis) {
    return {
      type: "log" as const,
      logBase: 10,
      min: yMin,
      max: yMax,
      axisLabel: {
        color: theme === "dark" ? `#fff` : `#000`,
        formatter: (value: number) => formatAxisLabel(value),
      },
    };
  } else {
    return {
      type: "value" as const,
      min: yMin,
      max: yMax,
      interval: yInterval,
      axisLabel: {
        color: theme === "dark" ? `#fff` : `#000`,
        formatter: (value: number) => formatAxisLabel(value),
      },
    };
  }
}

// Exported for testing
export function generateSeriesOptions(
  lines: LineData[],
  labelCounts: Record<string, number>,
  seriesData: number[][][],
) {
  // Performance tiers based on series count
  const seriesCount = lines.length;
  const isManySeries = seriesCount > 20;
  const hasLargeDataset = lines.some((l) => l.x.length > 1000);

  return lines.map((l, i) => {
    // Show symbol for single data points since lines need at least 2 points to be visible
    const isSinglePoint = seriesData[i].length === 1;

    return {
      name: l.label + (labelCounts[l.label] > 1 ? ` (${i + 1})` : ""),
      type: "line" as const,
      smooth: false,
      symbol: "circle" as const, // Show dots at cursor intersection points
      symbolSize: isSinglePoint ? 8 : 6, // Larger dot for single points to make them more visible
      showSymbol: isSinglePoint, // Show symbol for single points, otherwise only on hover
      sampling: "lttb" as const,
      // Enable large mode for many series or big datasets
      large: isManySeries || hasLargeDataset,
      largeThreshold: isManySeries ? 500 : 2000,
      // Aggressive progressive rendering for many series
      progressive: isManySeries ? 200 : 400,
      progressiveThreshold: isManySeries ? 1000 : 3000,
      progressiveChunkMode: "mod" as const,
      // Enable line hover events so mouseover works even without symbols
      triggerLineEvent: true,
      lineStyle: {
        color: l.color,
        type: l.dashed ? ("dashed" as const) : ("solid" as const),
        width: 2, // Full width for all series
        opacity: l.opacity !== undefined ? l.opacity : 0.85,
      },
      itemStyle: {
        color: l.color,
        opacity: l.opacity !== undefined ? l.opacity : 0.85,
        borderWidth: 0, // No border for performance
      },
      // Always enable emphasis for hover highlighting
      emphasis: {
        focus: "series" as const,
        lineStyle: {
          width: 3,
        },
      },
      // Always enable blur for non-hovered series
      blur: {
        lineStyle: {
          opacity: 0.15,
        },
      },
      data: seriesData[i],
    };
  });
}

// Maximum number of series to show in tooltip to prevent performance issues
// Exported for testing
export const MAX_TOOLTIP_SERIES = 50;

// Exported for testing
export function generateTooltipFormatter(
  theme: string,
  isDateTime: boolean,
  timeRange: number,
  lines: LineData[],
) {
  // Pre-compute formatters once
  const formatX = isDateTime
    ? (x: number) => smartDateFormatter(x, timeRange)
    : formatAxisLabel;

  const textColor = theme === "dark" ? "#fff" : "#000";

  return (params: any | any[]) => {
    try {
      const paramArray = Array.isArray(params) ? params : [params];
      if (!paramArray[0]?.value) return "";

      const x = paramArray[0].value[0];
      const displayX = formatX(x);

      // Filter out hidden series and sort by Y value descending for better UX
      const validParams = paramArray
        .filter((param) => {
          if (param.seriesIndex === undefined || param.seriesIndex === null) return true;
          if (!lines[param.seriesIndex]) return true;
          return !lines[param.seriesIndex].hideFromLegend;
        })
        .sort((a, b) => (b.value?.[1] ?? 0) - (a.value?.[1] ?? 0));

      // Limit to top N series for performance
      const totalCount = validParams.length;
      const displayParams = validParams.slice(0, MAX_TOOLTIP_SERIES);
      const hiddenCount = totalCount - displayParams.length;

      // Use Set for O(1) duplicate checking
      const seen = new Set<string>();
      const seriesItems: string[] = [];

      for (const param of displayParams) {
        const y = param.value[1];
        const key = `${param.seriesName}-${y}`;
        if (!seen.has(key)) {
          seen.add(key);
          const formattedY = formatAxisLabel(y);
          // Simplified row without inline event handlers for better performance
          seriesItems.push(
            `<div style="padding: 2px 4px;">${param.marker} <span style="color: ${textColor}">${escapeHtml(String(param.seriesName))}: ${formattedY}</span></div>`
          );
        }
      }

      // Show count of hidden series
      const hiddenNote = hiddenCount > 0
        ? `<div style="padding: 2px 4px; color: ${theme === "dark" ? "#888" : "#666"}; font-style: italic;">+${hiddenCount} more series</div>`
        : "";

      return `
        <div style="font-family: monospace; font-size: 11px;">
          <div style="font-weight: bold; color: ${textColor}; padding: 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px;">
            ${escapeHtml(String(displayX))}
          </div>
          <div style="max-height: 300px; overflow-y: auto;">
            ${seriesItems.join("")}
            ${hiddenNote}
          </div>
        </div>
      `;
    } catch (e) {
      return "";
    }
  };
}

function generateChartOptions(
  props: {
    lines: LineData[];
    isDateTime: boolean;
    logXAxis: boolean;
    logYAxis: boolean;
    xlabel?: string;
    ylabel?: string;
    title?: string;
    showXAxis: boolean;
    showYAxis: boolean;
    showLegend: boolean;
  },
  extents: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    timeRange: number;
    labelCounts: Record<string, number>;
    xInterval?: number;
    yInterval?: number;
  },
  theme: string,
  legendTop: number,
  seriesData: number[][][], // Pre-computed [x, y] pairs for each line
): EChartsOption {
  const {
    lines,
    isDateTime,
    logXAxis,
    logYAxis,
    xlabel,
    ylabel,
    title,
    showXAxis,
    showYAxis,
    showLegend,
  } = props;

  const {
    xMin,
    xMax,
    yMin,
    yMax,
    timeRange,
    labelCounts,
    xInterval,
    yInterval,
  } = extents;

  const xAxisOption = generateXAxisOption(
    isDateTime,
    logXAxis,
    xMin,
    xMax,
    xInterval,
    timeRange,
    showXAxis,
    theme,
  );
  const yAxisOption = generateYAxisOption(
    logYAxis,
    yMin,
    yMax,
    yInterval,
    theme,
  );
  const seriesOptions = generateSeriesOptions(lines, labelCounts, seriesData);
  const legendConfig = generateLegendConfig(
    lines,
    labelCounts,
    theme,
    showLegend,
  );
  const tooltipFormatter = generateTooltipFormatter(
    theme,
    isDateTime,
    timeRange,
    lines,
  );

  // Calculate increased nameGap when datetime with rotation is used
  const shouldRotateLabels = isDateTime && timeRange < 86400000;
  const xAxisNameGap = shouldRotateLabels ? 55 : 35;

  // Always use native tooltip - optimized formatter handles all series counts
  const tooltipConfig = {
    trigger: "axis" as const,
    enterable: true, // Allow hovering over tooltip for scrolling
    confine: false, // Allow tooltip to overflow chart boundaries
    showDelay: 0,
    hideDelay: 100, // Shorter delay to feel more responsive
    transitionDuration: 0.05,
    position: (point: number[], _params: any, _dom: any, rect: any, size: { viewSize: number[]; contentSize: number[] }) => {
      // Use actual tooltip size, with fallback minimum for first render
      const tooltipWidth = Math.max(size.contentSize[0], 200);
      const tooltipHeight = size.contentSize[1];

      const offsetX = 30;
      const offsetY = 80;

      const rectY = rect?.y ?? 0;
      // Use chart container width, not viewport width
      const chartWidth = size.viewSize[0];

      // Check if tooltip would go off right edge of chart container
      const rightX = point[0] + offsetX;
      const wouldOverflowRight = rightX + tooltipWidth > chartWidth;

      // Position on left side if it would overflow right, otherwise right side
      let x = wouldOverflowRight
        ? point[0] - offsetX - tooltipWidth  // Left of cursor
        : rightX;                             // Right of cursor

      let y = point[1] - offsetY - tooltipHeight; // Above cursor

      // If tooltip would go off top of viewport, shift down
      const viewportY = rectY + y;
      if (viewportY < 10) {
        y = 10 - rectY;
      }

      return [x, y];
    },
    axisPointer: {
      type: "line" as const,
      snap: false, // Don't snap to nearest data point - keeps series list consistent when curves are close
      animation: false,
      lineStyle: {
        color:
          theme === "dark"
            ? "rgba(255, 255, 255, 0.3)"
            : "rgba(0, 0, 0, 0.3)",
      },
    },
    backgroundColor: theme === "dark" ? "#161619" : "#fff",
    borderColor: theme === "dark" ? "#333" : "#e0e0e0",
    borderWidth: 1,
    order: "valueDesc" as const,
    textStyle: {
      color: theme === "dark" ? "#fff" : "#333",
      fontFamily: "Monospace",
      fontWeight: "normal" as const,
      fontSize: 11,
    },
    shadowColor: "transparent",
    formatter: tooltipFormatter,
    extraCssText: "max-width: 350px; max-height: 50vh; border-radius: 4px; padding: 4px; overflow-y: auto;",
  };

  return {
    backgroundColor: "transparent",
    title: title
      ? {
          text: title,
          left: "center",
          textStyle: {
            color: theme === "dark" ? "#fff" : "#000",
            fontSize: 17,
            fontFamily: "Monospace",
            fontWeight: "normal",
          },
        }
      : undefined,
    tooltip: tooltipConfig,
    legend: legendConfig,
    grid: {
      left: "5%",
      right: "5%",
      top: legendTop + 40,
      bottom: shouldRotateLabels ? 60 : 50, // Increase bottom space when labels are rotated
      containLabel: true,
    },
    xAxis: {
      name: xlabel,
      nameLocation: "middle",
      nameGap: xAxisNameGap,
      nameTextStyle: { fontFamily: "Monospace" },
      ...xAxisOption,
    },
    yAxis: {
      name: ylabel,
      nameLocation: "middle",
      nameGap: 50,
      axisLine: {
        show: showYAxis,
        lineStyle: { color: theme === "dark" ? `#fff` : `#000` },
      },
      axisTick: { show: showYAxis },
      splitLine: {
        show: true,
        lineStyle: { type: "dashed", opacity: 0.6 },
      },
      ...yAxisOption,
    },
    series: seriesOptions,
    animation: false,
    // Internal dataZoom for programmatic zoom control
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: false,
        moveOnMouseWheel: false,
      },
    ],
    toolbox: {
      feature: {
        dataZoom: {
          filterMode: "none",
          icon: {
            zoom: "path://",
            back: "path://",
          },
        },
      },
    },
  };
}

// ============================
// Main Component
// ============================

const LineChartInner = forwardRef<ReactECharts, LineChartProps>(
  (
    {
      lines,
      isDateTime = false,
      logXAxis = false,
      logYAxis = false,
      xlabel,
      ylabel,
      title,
      showXAxis = false,
      showYAxis = false,
      showLegend = false,
      className,
      ...rest
    },
    ref,
  ) => {
    const { resolvedTheme: theme } = useTheme();
    const chartRef = useRef<ReactECharts>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { width, height } = useContainerSize(containerRef);

    // Generate unique chart ID for cross-chart highlighting
    // useId() guarantees uniqueness across the React tree, unlike Math.random()
    const chartId = useId();

    // Expose highlight/downplay functions on window for tooltip hover interaction
    useEffect(() => {
      // Create global registry if it doesn't exist
      if (!window.__chartInstances) {
        window.__chartInstances = new Map();
      }

      // Register this chart instance
      window.__chartInstances.set(chartId, chartRef);

      // Create global highlight function if it doesn't exist
      if (!window.__chartHighlight) {
        window.__chartHighlight = (targetChartId: string, seriesIndex: number) => {
          try {
            const ref = window.__chartInstances?.get(targetChartId);
            const chart = ref?.current?.getEchartsInstance();
            if (chart && !chart.isDisposed?.()) {
              chart.dispatchAction({
                type: "highlight",
                seriesIndex,
              });
            }
          } catch (e) {
            // Silently ignore errors during highlight (chart may be unmounting)
          }
        };
      }

      if (!window.__chartDownplay) {
        window.__chartDownplay = (targetChartId: string) => {
          try {
            const ref = window.__chartInstances?.get(targetChartId);
            const chart = ref?.current?.getEchartsInstance();
            if (chart && !chart.isDisposed?.()) {
              chart.dispatchAction({
                type: "downplay",
              });
            }
          } catch (e) {
            // Silently ignore errors during downplay (chart may be unmounting)
          }
        };
      }

      return () => {
        window.__chartInstances?.delete(chartId);
      };
    }, [chartId]);

    // Process the data for log scales
    const processedLines = useMemo(
      () => filterDataForLogScale(lines, logXAxis, logYAxis),
      [lines, logXAxis, logYAxis],
    );

    // Calculate data extents and related info
    const extents = useMemo(
      () =>
        calculateDataExtents(processedLines, isDateTime, logXAxis, logYAxis),
      [processedLines, isDateTime, logXAxis, logYAxis],
    );

    // Calculate legend configuration
    const legendConfig = useMemo(() => {
      const cols = Math.min(Math.ceil(processedLines.length / 10), 4);
      const top = cols > 1 ? 60 : 50;
      return { cols, top };
    }, [processedLines.length]);

    // Pre-compute series data arrays to avoid recreation on theme changes
    // This is the most expensive data transformation (creates [x, y] pairs)
    const seriesData = useMemo(
      () => processedLines.map((l) => l.x.map((x, idx) => [x, l.y[idx]])),
      [processedLines]
    );

    // Generate chart options
    const option = useMemo(() => {
      return generateChartOptions(
        {
          lines: processedLines,
          isDateTime,
          logXAxis,
          logYAxis,
          xlabel,
          ylabel,
          title,
          showXAxis,
          showYAxis,
          showLegend,
        },
        extents,
        theme,
        legendConfig.top,
        seriesData,
      );
    }, [
      processedLines,
      theme,
      title,
      isDateTime,
      logXAxis,
      logYAxis,
      xlabel,
      ylabel,
      showXAxis,
      showYAxis,
      showLegend,
      legendConfig.top,
      extents,
      seriesData,
    ]);

    // Cache ECharts instance to avoid repeated getEchartsInstance() calls
    // which trigger forced reflows by accessing DOM properties
    const cachedChartInstanceRef = useRef<ReturnType<ReactECharts["getEchartsInstance"]> | null>(null);

    // Track event handlers for cleanup to prevent memory leaks
    const dataZoomHandlerRef = useRef<(() => void) | null>(null);

    // Click-to-pin tooltip state
    const [isPinned, setIsPinned] = useState(false);
    const pinnedDataIndexRef = useRef<number | null>(null);

    // Resize on window change - use RAF to batch DOM operations
    useEffect(() => {
      requestAnimationFrame(() => {
        const chart = cachedChartInstanceRef.current ?? chartRef.current?.getEchartsInstance();
        if (chart && !chart.isDisposed?.()) {
          cachedChartInstanceRef.current = chart;
          chart.resize();
        }
      });
    }, [width, height]);

    useEffect(() => {
      let rafId: number | null = null;
      const resize = () => {
        if (rafId !== null) return; // Debounce RAF
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const chart = cachedChartInstanceRef.current ?? chartRef.current?.getEchartsInstance();
          if (chart && !chart.isDisposed?.()) {
            cachedChartInstanceRef.current = chart;
            chart.resize();
          }
        });
      };
      window.addEventListener("resize", resize);
      return () => {
        window.removeEventListener("resize", resize);
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }, []);

    // Track click handler for cleanup
    const clickHandlerRef = useRef<((params: any) => void) | null>(null);
    // Track mouseover/mouseout handlers for cleanup (memory leak fix)
    const mouseoverHandlerRef = useRef<((params: any) => void) | null>(null);
    const mouseoutHandlerRef = useRef<((params: any) => void) | null>(null);

    // Cleanup ECharts event listeners on unmount to prevent memory leaks
    useEffect(() => {
      return () => {
        if (cachedChartInstanceRef.current) {
          // Remove datazoom listener
          if (dataZoomHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("datazoom", dataZoomHandlerRef.current);
            } catch {
              // Instance may already be disposed
            }
          }
          // Remove click listener
          if (clickHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("click", clickHandlerRef.current);
            } catch {
              // Instance may already be disposed
            }
          }
          // Remove mouseover listener
          if (mouseoverHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("mouseover", mouseoverHandlerRef.current);
            } catch {
              // Instance may already be disposed
            }
          }
          // Remove mouseout listener
          if (mouseoutHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("mouseout", mouseoutHandlerRef.current);
            } catch {
              // Instance may already be disposed
            }
          }
        }
        // Clear refs
        cachedChartInstanceRef.current = null;
        dataZoomHandlerRef.current = null;
        clickHandlerRef.current = null;
        mouseoverHandlerRef.current = null;
        mouseoutHandlerRef.current = null;
      };
    }, []);

    // Handle Escape key to unpin tooltip
    useEffect(() => {
      if (!isPinned) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setIsPinned(false);
          pinnedDataIndexRef.current = null;
          // Hide tooltip
          const chart = cachedChartInstanceRef.current;
          if (chart && !chart.isDisposed?.()) {
            chart.dispatchAction({ type: "hideTip" });
          }
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isPinned]);

    // Handle click outside to unpin tooltip
    useEffect(() => {
      if (!isPinned) return;

      const handleClickOutside = (e: MouseEvent) => {
        // Check if click is inside the chart container
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsPinned(false);
          pinnedDataIndexRef.current = null;
          const chart = cachedChartInstanceRef.current;
          if (chart && !chart.isDisposed?.()) {
            chart.dispatchAction({ type: "hideTip" });
          }
        }
      };

      // Delay adding listener to avoid immediate trigger from the pin click
      const timer = setTimeout(() => {
        window.addEventListener("click", handleClickOutside);
      }, 100);

      return () => {
        clearTimeout(timer);
        window.removeEventListener("click", handleClickOutside);
      };
    }, [isPinned]);

    // Note: Removed mousemove handler for pinned tooltip as it interferes with datazoom
    // The click-to-pin now works by clicking to show tooltip, clicking again to hide
    // Without the continuous re-show, the tooltip will follow mouse movement naturally

    const isTouchScreen = isTouchScreenDevice();

    const { setChartRef } = useChartRef(
      ref,
      [theme, processedLines, isDateTime, logXAxis, logYAxis],
      !isTouchScreen,
    );

    const handleRef = useCallback(
      (chart: ReactECharts | null) => {
        // Clean up previous instance's event listeners before setting new ref
        if (cachedChartInstanceRef.current) {
          if (dataZoomHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("datazoom", dataZoomHandlerRef.current);
            } catch {
              // Ignore errors if instance is already disposed
            }
            dataZoomHandlerRef.current = null;
          }
          if (clickHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("click", clickHandlerRef.current);
            } catch {
              // Ignore errors if instance is already disposed
            }
            clickHandlerRef.current = null;
          }
          if (mouseoverHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("mouseover", mouseoverHandlerRef.current);
            } catch {
              // Ignore errors if instance is already disposed
            }
            mouseoverHandlerRef.current = null;
          }
          if (mouseoutHandlerRef.current) {
            try {
              cachedChartInstanceRef.current.off("mouseout", mouseoutHandlerRef.current);
            } catch {
              // Ignore errors if instance is already disposed
            }
            mouseoutHandlerRef.current = null;
          }
        }

        chartRef.current = chart;

        if (chart) {
          const echartsInstance = chart.getEchartsInstance();
          // Cache the instance for future use to avoid forced reflows
          cachedChartInstanceRef.current = echartsInstance;

          // Create named handler so we can remove it later
          const dataZoomHandler = () => {
            // Get the current data zoom range in percentage
            try {
              const dataZoomComponent = echartsInstance
                // @ts-ignore
                .getModel()
                .getComponent("xAxis", 0);

              const xExtent = dataZoomComponent.axis.scale.getExtent() as [
                number,
                number,
              ];
              console.log("xExtent", xExtent);
            } catch {
              // Ignore errors from disposed chart
            }
          };
          dataZoomHandlerRef.current = dataZoomHandler;
          echartsInstance.on("datazoom", dataZoomHandler);

          // Click handler to pin/unpin tooltip
          const clickHandler = (params: any) => {
            if (params.componentType === "series") {
              // Toggle pin state
              setIsPinned((prev) => {
                if (prev) {
                  // Unpin - hide tooltip
                  pinnedDataIndexRef.current = null;
                  echartsInstance.dispatchAction({ type: "hideTip" });
                  return false;
                } else {
                  // Pin - show tooltip at this data index
                  pinnedDataIndexRef.current = params.dataIndex;
                  echartsInstance.dispatchAction({
                    type: "showTip",
                    seriesIndex: 0,
                    dataIndex: params.dataIndex,
                  });
                  return true;
                }
              });
            }
          };
          clickHandlerRef.current = clickHandler;
          echartsInstance.on("click", clickHandler);

          // Cross-chart emphasis: propagate highlight/downplay to all connected charts
          const mouseoverHandler = (params: any) => {
            if (params.componentType === "series" && params.seriesName) {
              // Find all charts and highlight the same series by name
              window.__chartInstances?.forEach((ref, id) => {
                if (id === chartId) return; // Skip self
                try {
                  const otherChart = ref?.current?.getEchartsInstance();
                  if (otherChart && !otherChart.isDisposed?.()) {
                    otherChart.dispatchAction({
                      type: "highlight",
                      seriesName: params.seriesName,
                    });
                  }
                } catch {
                  // Ignore errors
                }
              });
            }
          };
          mouseoverHandlerRef.current = mouseoverHandler;
          echartsInstance.on("mouseover", mouseoverHandler);

          const mouseoutHandler = (params: any) => {
            if (params.componentType === "series") {
              // Downplay all series on all other charts
              window.__chartInstances?.forEach((ref, id) => {
                if (id === chartId) return; // Skip self
                try {
                  const otherChart = ref?.current?.getEchartsInstance();
                  if (otherChart && !otherChart.isDisposed?.()) {
                    otherChart.dispatchAction({
                      type: "downplay",
                    });
                  }
                } catch {
                  // Ignore errors
                }
              });
            }
          };
          mouseoutHandlerRef.current = mouseoutHandler;
          echartsInstance.on("mouseout", mouseoutHandler);
        } else {
          cachedChartInstanceRef.current = null;
        }

        setChartRef(chart);

        if (typeof ref === "function") ref(chart);
        else if (ref) ref.current = chart;
      },
      [ref, setChartRef],
    );

    return (
      <div
        ref={containerRef}
        className={cn("p-2 pt-4", className)}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
        }}
        {...rest}
      >
        <ReactECharts
          ref={handleRef}
          option={option}
          style={{ width: width, height: height }}
          opts={
            {
              renderer: "canvas",
              // Use separate canvas layer for hover effects when >5 series
              // This avoids redrawing the entire chart on every mousemove
              hoverLayerThreshold: 5,
              // Enable partial canvas redraws for better performance
              useDirtyRect: true,
            } as { renderer: "canvas"; hoverLayerThreshold: number; useDirtyRect: boolean }
          }
          notMerge={false}
          lazyUpdate={true}
          theme={theme}
        />
      </div>
    );
  },
);

// Custom comparison function to prevent unnecessary re-renders
// Only re-render when data or display settings actually change
const LineChart = memo(LineChartInner, (prevProps, nextProps) => {
  // Check array length first (fast check)
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
    prevProps.className === nextProps.className
  );
});

export default LineChart;
