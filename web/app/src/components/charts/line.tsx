import React, {
  useRef,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useState,
} from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";

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

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref?.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
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
const formatAxisLabel = (value: number): string => {
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

  const setChartRef = useCallback(
    (ref: ReactECharts | null) => {
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
          if (zr)
            zr.on("dblclick", () =>
              chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 }),
            );
        }
      } else internalChartRef.current = null;

      if (externalRef && enabled) {
        if (typeof externalRef === "function") externalRef(ref);
        else
          (externalRef as React.MutableRefObject<ReactECharts | null>).current =
            ref;
      }
    },
    [externalRef, enabled, ...deps],
  );

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

function generateSeriesOptions(
  lines: LineData[],
  labelCounts: Record<string, number>,
) {
  return lines.map((l, i) => ({
    name: l.label + (labelCounts[l.label] > 1 ? ` (${i + 1})` : ""),
    type: "line" as const,
    smooth: false,
    symbol: "circle" as const,
    symbolSize: 6,
    // sampling: "average",
    // large: true,
    showSymbol: l.x.length === 1 || (l.x.length < 100 && lines.length === 1),
    sampling: "lttb" as const,
    lineStyle: {
      color: l.color,
      type: l.dashed ? ("dashed" as const) : ("solid" as const),
      width: 2,
      opacity: l.opacity !== undefined ? l.opacity : lines.length > 1 ? 0.8 : 1,
    },
    itemStyle: {
      color: l.color,
      opacity: l.opacity !== undefined ? l.opacity : lines.length > 1 ? 0.8 : 1,
      borderWidth: 2,
    },
    // emphasis: {
    //   focus: "series" as const,
    //   lineStyle: {
    //     width: 2,
    //   },
    //   itemStyle: {
    //     borderWidth: 1,
    //   },
    // },
    data: l.x.map((x, idx) => [x, l.y[idx]]),
  }));
}

function generateTooltipFormatter(
  theme: string,
  isDateTime: boolean,
  timeRange: number,
  lines: LineData[],
) {
  return (params: any | any[]) => {
    const paramArray = Array.isArray(params) ? params : [params];
    const x = paramArray[0].value[0];

    // Handle log scale for tooltip display
    let displayX: string;
    if (isDateTime) {
      displayX = smartDateFormatter(x, timeRange);
    } else {
      displayX = formatAxisLabel(x);
    }

    const uniqueValues = new Map();
    const linesTooltip = [
      `<span style=\"font-weight: bold; color: ${theme === "dark" ? "#fff" : `#000`}\">${displayX}</span>`,
    ];

    paramArray.forEach((param) => {
      // Skip series that are hidden from legend
      if (
        param.seriesIndex !== undefined &&
        lines[param.seriesIndex] &&
        lines[param.seriesIndex].hideFromLegend
      ) {
        return;
      }

      const y = param.value[1];
      const formattedY = formatAxisLabel(y);

      const key = `${param.seriesName}-${y}`;
      if (!uniqueValues.has(key)) {
        uniqueValues.set(key, true);
        linesTooltip.push(
          `<span style=\"color: ${theme === "dark" ? `#fff` : `#000`}\">${param.marker} ${param.seriesName}: ${formattedY}</span>`,
        );
      }
    });

    return linesTooltip.join("<br/>");
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
  const seriesOptions = generateSeriesOptions(lines, labelCounts);
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
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        lineStyle: {
          color:
            theme === "dark"
              ? "rgba(255, 255, 255, 0.4)"
              : "rgba(0, 0, 0, 0.4)",
        },
      },
      backgroundColor: theme === "dark" ? "#161619" : "#fff",
      borderColor: theme === "dark" ? "#161619" : "#e0e0e0",
      order: "valueDesc",
      textStyle: {
        color: theme === "dark" ? "#fff" : "#e0e0e0",
        fontFamily: "Monospace",
        fontWeight: "normal",
      },
      shadowColor: "transparent",
      formatter: tooltipFormatter,
    },
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

const LineChart = forwardRef<ReactECharts, LineChartProps>(
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
    ]);

    // Resize on window change
    useEffect(() => {
      const chart = chartRef.current?.getEchartsInstance();
      if (chart) chart.resize();
    }, [width, height]);

    useEffect(() => {
      const resize = () => chartRef.current?.getEchartsInstance().resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, []);

    const isTouchScreen = isTouchScreenDevice();

    const { setChartRef } = useChartRef(
      ref,
      [theme, processedLines, isDateTime, logXAxis, logYAxis],
      !isTouchScreen,
    );

    const handleRef = useCallback(
      (chart: ReactECharts | null) => {
        chartRef.current = chart;

        // Add event listener for datazoom event
        if (chart) {
          const echartsInstance = chart.getEchartsInstance();
          echartsInstance.on("datazoom", () => {
            // Get the current data zoom range in percentage
            const dataZoomComponent = echartsInstance
              // @ts-ignore
              .getModel()
              .getComponent("xAxis", 0);

            const xExtent = dataZoomComponent.axis.scale.getExtent() as [
              number,
              number,
            ];
            console.log("xExtent", xExtent);
          });
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
          flexGrow: 1,
          height: "100%",
          width: "100%",
          alignItems: "center",
          display: "flex",
        }}
        {...rest}
      >
        <ReactECharts
          ref={handleRef}
          option={option}
          style={{ width: width, height: height }}
          // opts={{ renderer: "svg" }}
          notMerge={true}
          lazyUpdate={false}
          theme={theme}
        />
      </div>
    );
  },
);

export default LineChart;
