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
import { useChartSyncContext } from "./context/chart-sync-context";


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

/**
 * Default sync key for all uPlot charts on the same page.
 * This enables cursor synchronization across charts by default.
 */
const DEFAULT_SYNC_KEY = "uplot-global-sync";

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

/** Type for hover state that persists across chart recreations */
interface HoverState {
  isHovering: boolean;
  lastIdx: number | null;
  lastLeft: number | null;
  lastTop: number | null;
}

function tooltipPlugin(opts: {
  theme: string;
  isDateTime: boolean;
  timeRange: number;
  lines: LineData[];
  /** External hover state ref that survives chart recreation */
  hoverStateRef?: { current: HoverState };
  /** Callback when hover state changes (for context tracking) */
  onHoverChange?: (isHovering: boolean) => void;
  /** Function to check if this chart is the currently hovered chart */
  isActiveChart?: () => boolean;
}): uPlot.Plugin {
  const { theme, isDateTime, timeRange, lines, hoverStateRef, onHoverChange, isActiveChart } = opts;

  // DEBUG: Temporary logging to diagnose tooltip persistence issue
  const DEBUG_TOOLTIP = false; // Set to true for debugging
  const tooltipId = Math.random().toString(36).substring(7);
  const log = (msg: string) => DEBUG_TOOLTIP && console.log(`[tooltip-${tooltipId}] ${msg}`);
  log("tooltipPlugin created");

  let tooltipEl: HTMLDivElement | null = null;
  let overEl: HTMLElement | null = null;
  // Restore ALL state from external ref (survives chart recreation)
  let lastIdx: number | null = hoverStateRef?.current.lastIdx ?? null;
  let lastLeft: number | null = hoverStateRef?.current.lastLeft ?? null;
  let lastTop: number | null = hoverStateRef?.current.lastTop ?? null;
  let isHovering = hoverStateRef?.current.isHovering ?? false;
  let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Sync local state to external ref (includes cursor position now)
  const syncHoverState = () => {
    if (hoverStateRef) {
      hoverStateRef.current = { isHovering, lastIdx, lastLeft, lastTop };
    }
  };

  function init(u: uPlot) {
    overEl = u.over;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "uplot-tooltip";
    tooltipEl.style.cssText = `
      position: fixed;
      display: none;
      pointer-events: none;
      z-index: 9999;
      font-family: ui-monospace, monospace;
      font-size: 10px;
      background: ${theme === "dark" ? "#161619" : "#fff"};
      border: 1px solid ${theme === "dark" ? "#333" : "#e0e0e0"};
      border-radius: 4px;
      padding: 4px;
      max-width: 300px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;
    // Append to body so tooltip can overflow chart boundaries
    document.body.appendChild(tooltipEl);

    // Following uPlot's official tooltips.html demo pattern EXACTLY:
    // mouseenter -> show tooltip (cancel any pending hide)
    // mouseleave -> hide tooltip (with small debounce to prevent spurious hides)
    // setCursor -> just update content, never control visibility
    const handleMouseEnter = () => {
      log(`mouseenter - was isHovering=${isHovering}, hideTimeoutId=${hideTimeoutId !== null}`);
      // Cancel any pending hide
      if (hideTimeoutId !== null) {
        clearTimeout(hideTimeoutId);
        hideTimeoutId = null;
        log("  cancelled pending hide");
      }
      isHovering = true;
      syncHoverState();
      // Notify context that this chart is now hovered
      onHoverChange?.(true);
      // Show tooltip immediately on mouseenter (uPlot demo pattern)
      if (tooltipEl) {
        tooltipEl.style.display = "block";
        log("  set display=block");
      }
    };

    const handleMouseLeave = () => {
      log(`mouseleave - isHovering=${isHovering}, pendingHide=${hideTimeoutId !== null}`);
      // Small debounce to prevent spurious mouseleave events from hiding tooltip
      // This protects against edge cases like cursor sync updates or scroll events
      // that might trigger false mouseleave events
      if (hideTimeoutId !== null) {
        clearTimeout(hideTimeoutId);
      }
      hideTimeoutId = setTimeout(() => {
        log("  hide timeout fired - hiding tooltip");
        isHovering = false;
        lastIdx = null;
        lastLeft = null;
        lastTop = null;
        syncHoverState();
        // Notify context that this chart is no longer hovered
        onHoverChange?.(false);
        if (tooltipEl) {
          tooltipEl.style.display = "none";
        }
        hideTimeoutId = null;
      }, 50); // 50ms debounce - enough to filter spurious events but not noticeable to user
    };

    overEl.addEventListener("mouseenter", handleMouseEnter);
    overEl.addEventListener("mouseleave", handleMouseLeave);

    // Store cleanup function on the element for later removal
    (overEl as HTMLElement & { _tooltipCleanup?: () => void })._tooltipCleanup = () => {
      overEl?.removeEventListener("mouseenter", handleMouseEnter);
      overEl?.removeEventListener("mouseleave", handleMouseLeave);
      // Clear any pending hide timeout
      if (hideTimeoutId !== null) {
        clearTimeout(hideTimeoutId);
        hideTimeoutId = null;
      }
    };

    // CRITICAL: Check if we were hovering before chart recreation
    // This handles the case where chart is recreated while mouse is stationary over it
    // The external hoverStateRef preserves the hover state AND cursor position
    if (isHovering && tooltipEl && lastIdx != null) {
      log(`init: restoring hover state - idx=${lastIdx}, left=${lastLeft}, top=${lastTop}`);
      tooltipEl.style.display = "block";
      // Immediately update tooltip content with restored state
      // Use requestAnimationFrame to ensure uPlot is fully initialized
      requestAnimationFrame(() => {
        if (lastIdx != null) {
          updateTooltipContent(u, lastIdx);
        }
      });
    }
  }

  function updateTooltipContent(u: uPlot, idx: number) {
    if (!tooltipEl) return;

    const xVal = u.data[0][idx];
    // If no valid x value, just return - don't hide (mouseleave handles that)
    if (xVal == null) return;

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

    // Position tooltip following the cursor with offset to top-right
    // Use viewport coordinates so tooltip can overflow chart boundaries
    const tooltipWidth = tooltipEl.offsetWidth || 200;
    const tooltipHeight = tooltipEl.offsetHeight || 100;

    // Get cursor position from uPlot (relative to chart area)
    // uPlot sets cursor.left/top to -10 when cursor is outside chart
    // Use last known position if current is invalid (negative)
    // Note: 0 is valid (left/top edge), so check >= 0
    const cursorLeft = (u.cursor.left != null && u.cursor.left >= 0) ? u.cursor.left : (lastLeft ?? 0);
    const cursorTop = (u.cursor.top != null && u.cursor.top >= 0) ? u.cursor.top : (lastTop ?? 0);

    // Convert chart-relative coords to viewport coords
    const chartRect = u.over.getBoundingClientRect();
    const viewportX = chartRect.left + cursorLeft;
    const viewportY = chartRect.top + cursorTop;

    const offsetX = 15; // Offset to the right
    const offsetY = 10; // Offset above

    // Default position: to the right and above cursor (in viewport coords)
    let left = viewportX + offsetX;
    let top = viewportY - tooltipHeight - offsetY;

    // If tooltip would go off right edge of VIEWPORT, position to the left
    if (left + tooltipWidth > window.innerWidth - 10) {
      left = viewportX - tooltipWidth - offsetX;
    }

    // If tooltip would go off top of VIEWPORT, position below cursor
    if (top < 10) {
      top = viewportY + offsetY;
    }

    // Ensure tooltip stays within viewport (but NOT clamped to chart bounds)
    left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
    top = Math.max(10, Math.min(top, window.innerHeight - tooltipHeight - 10));

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    // Note: visibility controlled by mouseenter/mouseleave, not here
  }

  function setCursor(u: uPlot) {
    if (!tooltipEl || !overEl) return;

    // Check if this chart is the one being directly hovered
    // This prevents synced charts from showing tooltips
    const isActive = isActiveChart?.() ?? true; // Default to true if no context

    // If not hovering OR this is a synced cursor (not active chart), hide tooltip
    if (!isHovering || !isActive) {
      // Hide tooltip if visible and this isn't the active chart
      if (!isActive && tooltipEl.style.display !== "none") {
        tooltipEl.style.display = "none";
        log(`setCursor - hiding tooltip (not active chart)`);
      }
      return;
    }

    const { idx, left, top } = u.cursor;
    log(`setCursor - idx=${idx}, left=${left?.toFixed(0)}, top=${top?.toFixed(0)}, lastIdx=${lastIdx}`);

    // Store valid cursor data for tooltip persistence when mouse stops moving
    // Only sync to ref when idx changes (not every mouse move) to reduce overhead
    if (idx != null && idx !== lastIdx) {
      lastIdx = idx;
      // Also capture position at this point
      if (left != null && left >= 0) {
        lastLeft = left;
      }
      if (top != null && top >= 0) {
        lastTop = top;
      }
      syncHoverState();
    } else {
      // Still update local position cache for tooltip positioning
      if (left != null && left >= 0) {
        lastLeft = left;
      }
      if (top != null && top >= 0) {
        lastTop = top;
      }
    }

    // Use the last valid index if current is null but we're still hovering
    const displayIdx = idx ?? lastIdx;

    // If no valid index, just return - don't hide (mouseleave handles that)
    if (displayIdx == null) return;

    updateTooltipContent(u, displayIdx);
  }

  return {
    hooks: {
      init,
      setCursor,
      destroy(u: uPlot) {
        log(`destroy called - isHovering=${isHovering}, hideTimeoutId=${hideTimeoutId !== null}`);
        // Cleanup event listeners
        const cleanup = (overEl as HTMLElement & { _tooltipCleanup?: () => void })?._tooltipCleanup;
        cleanup?.();

        // Remove tooltip element
        if (tooltipEl && tooltipEl.parentNode) {
          tooltipEl.parentNode.removeChild(tooltipEl);
        }
      },
    },
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

    // Use context's syncKey, then prop, then default (in that priority order)
    const effectiveSyncKey = chartSyncContext?.syncKey ?? syncKey ?? DEFAULT_SYNC_KEY;

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

    // Pre-calculate y-axis range from actual data
    // This is done separately to avoid uPlot's yRangeFn timing issue where
    // it gets called before all data is processed
    const yRange = useMemo<[number, number]>(() => {
      // Skip for log scale (handled by distr: 3)
      if (logYAxis) return [0, 1];

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
        return [0, 1];
      }

      const dataMin = Math.min(...allYValues);
      const dataMax = Math.max(...allYValues);
      const range = dataMax - dataMin;
      const dataMagnitude = Math.max(Math.abs(dataMax), Math.abs(dataMin), 0.1);

      // Ensure minimum visible range of 10% of data magnitude
      // This prevents "super zoomed in" views for metrics with tiny variations
      const minRange = dataMagnitude * 0.1;

      let yMin: number, yMax: number;

      // If actual range is less than minimum, expand symmetrically
      if (range < minRange) {
        const center = (dataMin + dataMax) / 2;
        const halfRange = minRange / 2;
        yMin = center - halfRange;
        yMax = center + halfRange;

        // Don't show negative values if all data is non-negative
        if (dataMin >= 0 && yMin < 0) {
          yMin = 0;
          yMax = minRange;
        }
      } else {
        // For normal ranges, add 5% padding
        const padding = range * 0.05;
        yMin = dataMin - padding;
        yMax = dataMax + padding;

        // Don't show negative values if all data is non-negative
        if (dataMin >= 0 && yMin < 0) {
          yMin = 0;
        }
      }

      return [yMin, yMax];
    }, [uplotData, logYAxis]);

    // Pre-calculate x-axis range for single-point data
    // Without this, single points appear at the edge of the chart
    const xRange = useMemo<[number, number] | null>(() => {
      // Skip for log scale or datetime (handled separately)
      if (logXAxis || isDateTime) return null;

      const xValues = uplotData[0] as number[];
      if (xValues.length === 0) return null;

      const dataMin = Math.min(...xValues);
      const dataMax = Math.max(...xValues);

      // Only apply custom range for single points or very small ranges
      if (dataMin === dataMax) {
        // Single point - create a symmetric range around it
        // Use 10% of the value as padding, with a minimum padding
        const value = dataMin;
        const padding = Math.max(Math.abs(value) * 0.1, 1);
        return [value - padding, value + padding];
      }

      // Multiple points - let uPlot auto-scale
      return null;
    }, [uplotData, logXAxis, isDateTime]);

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
          if (ctx.hoveredChartId === chartId) {
            ctx.setHoveredChart(null);
          }
        }
      };
    }, [chartId]);

    // Function to check if this chart is currently the active (hovered) chart
    // Used by tooltipPlugin to only show tooltip on the directly-hovered chart
    // Uses ref to read current hover state at call time without causing chart recreation
    const isActiveChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        // If no context, default to active (standalone chart)
        if (!ctx) return true;
        // Active if no chart is hovered or this chart is the hovered one
        return ctx.hoveredChartId === null || ctx.hoveredChartId === chartId;
      };
    }, [chartId]);

    // Callback for series focus changes - notifies context for cross-chart highlighting
    const handleSeriesFocus = useMemo(() => {
      return (seriesLabel: string | null) => {
        chartSyncContextRef.current?.setHighlightedSeriesName(seriesLabel);
      };
    }, []);

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
        ...processedLines.map((line, i) => {
          // Check if this series has only a single point - need to show as dot since lines need 2+ points
          const isSinglePoint = line.x.length === 1;
          return {
            label: line.label,
            stroke: line.color || `hsl(${(i * 137) % 360}, 70%, 50%)`,
            width: 1.5,
            alpha: line.opacity ?? 0.85,
            dash: line.dashed ? [5, 5] : undefined,
            spanGaps: true,
            points: {
              // Show points for single-point series since lines need 2+ points to be visible
              show: isSinglePoint,
              size: isSinglePoint ? 10 : 6,
              fill: line.color || `hsl(${(i * 137) % 360}, 70%, 50%)`,
            },
            // Focus styling - when this series is focused, make it bolder
            focus: {
              alpha: 1, // Full opacity when focused
            },
          };
        }),
      ];

      // Scales configuration
      // Use a range function for y-axis to ensure our minimum visible range is applied
      // Note: When auto is true, uPlot allows setScale() to override the range.
      // When using a range function without auto, setScale() is ignored.
      // We use auto: true to enable dynamic Y rescaling on zoom.

      // Use a range function for x-axis to center single points
      const xRangeFn: uPlot.Range.Function | undefined = xRange
        ? () => xRange
        : undefined;

      const scales: uPlot.Scales = {
        x: logXAxis
          ? { distr: 3 }
          : isDateTime
            ? { time: true, auto: true }
            : xRangeFn
              ? { range: xRangeFn }
              : { auto: true },
        // For Y-axis: use auto:true to enable dynamic rescaling via setScale()
        // The pre-calculated yRange is only used for initial render
        y: logYAxis
          ? { distr: 3 }
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

      // Cursor configuration
      const cursor: uPlot.Cursor = {
        sync: {
          key: effectiveSyncKey,
          setSeries: false, // Disable uPlot's series visibility sync - we handle highlighting via alpha
        },
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
        plugins: [
          tooltipPlugin({
            theme: theme,
            isDateTime,
            timeRange,
            lines: processedLines,
            hoverStateRef, // Survives chart recreation
            onHoverChange: handleHoverChange, // Notifies context of hover state
            isActiveChart, // Checks if this chart is the one being hovered
          }),
        ],
        hooks: {
          setSeries: [
            (u, seriesIdx) => {
              // Handle series focus for local + cross-chart highlighting
              if (seriesIdx == null) {
                // No series focused - reset all series to normal alpha
                for (let i = 1; i < u.series.length; i++) {
                  const originalAlpha = processedLines[i - 1]?.opacity ?? 0.85;
                  u.series[i].alpha = originalAlpha;
                }
                // Notify context to clear cross-chart highlighting
                handleSeriesFocus(null);
              } else {
                // Highlight focused series, fade others
                for (let i = 1; i < u.series.length; i++) {
                  if (i === seriesIdx) {
                    u.series[i].alpha = 1; // Full opacity for focused series
                  } else {
                    u.series[i].alpha = 0.2; // Fade unfocused series
                  }
                }
                // Notify context for cross-chart highlighting
                const seriesLabel = processedLines[seriesIdx - 1]?.label;
                if (seriesLabel) {
                  handleSeriesFocus(seriesLabel);
                }
              }
              // Redraw to apply alpha changes
              u.redraw();
            },
          ],
          setScale: [
            (u, scaleKey) => {
              // Auto-scale Y axis when X scale changes (zoom)
              if (scaleKey === "x" && !logYAxis) {
                const xMin = u.scales.x.min;
                const xMax = u.scales.x.max;
                if (xMin == null || xMax == null) return;

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
                  const newYMin = visibleYMin >= 0 ? Math.max(0, visibleYMin - padding) : visibleYMin - padding;
                  const newYMax = visibleYMax + padding;

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
            },
          ],
          // Note: setSelect hook removed - zoom is handled by cursor.drag.setScale: true
          // The setScale hook above handles Y-axis auto-scaling when X scale changes
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
      effectiveSyncKey,
      timeRange,
      chartId,
      yRange,
      xRange,
      handleHoverChange,
      isActiveChart,
      handleSeriesFocus,
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
      if (!chartContainerRef.current || dims.width === 0 || dims.height === 0) return;

      const currentSeriesCount = uplotData.length;

      // Check if we can use setData() instead of full recreation
      // setData() preserves zoom state and is more efficient
      if (
        chartRef.current &&
        prevDataStructureRef.current &&
        prevDataStructureRef.current.seriesCount === currentSeriesCount
      ) {
        // Structure is the same - use setData() to preserve zoom
        chartRef.current.setData(uplotData);
        return;
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
      const chart = new uPlot(chartOptions, uplotData, chartContainerRef.current);
      chartRef.current = chart;
      chartCreatedRef.current = true;

      // Track data structure for future setData() optimization
      prevDataStructureRef.current = { seriesCount: currentSeriesCount };

      // Restore zoom state if it was saved (user had zoomed before recreation)
      if (zoomStateRef.current) {
        const { xMin, xMax } = zoomStateRef.current;
        // Validate that the saved zoom is within current data bounds
        const xData = uplotData[0] as number[];
        if (xData.length > 0) {
          const dataMin = Math.min(...xData);
          const dataMax = Math.max(...xData);
          // Only restore if zoom range overlaps with data
          if (xMin < dataMax && xMax > dataMin) {
            // Use requestAnimationFrame to ensure chart is fully initialized
            requestAnimationFrame(() => {
              chart.setScale("x", { min: xMin, max: xMax });
            });
          }
        }
        // Clear saved zoom state after restoring
        zoomStateRef.current = null;
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
      chartSyncContext?.registerUPlot(chartId, chart);

      // Double-click to reset zoom
      const handleDblClick = () => {
        chart.setData(chart.data);
        // Clear saved zoom state so it doesn't get restored on next data update
        zoomStateRef.current = null;
      };
      const container = chartContainerRef.current;
      container.addEventListener("dblclick", handleDblClick);

      // Store cleanup function
      cleanupRef.current = () => {
        chartSyncContext?.unregisterUPlot(chartId);
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
      // Note: width/height intentionally excluded - size changes handled by separate setSize() effect
      // Including them here causes infinite recreation loop when ResizeObserver fires after chart mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options, uplotData, chartId, chartSyncContext]);

    // Handle resize separately - uses setSize() instead of recreating chart
    useEffect(() => {
      if (chartRef.current && width > 0 && height > 0) {
        chartRef.current.setSize({ width, height });
      }
    }, [width, height]);

    // NOTE: Data updates are handled by the chart creation effect above,
    // which already depends on uplotData. A separate setData effect was
    // removed because it caused issues with scale calculation when both
    // effects ran simultaneously.

    // Apply cross-chart highlighting when another chart highlights a series
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || !chartSyncContext) return;

      const highlightedName = chartSyncContext.highlightedSeriesName;

      // Skip if this chart is the source of the highlight (already handled in setSeries hook)
      // We detect this by checking if the chart's focused series matches the highlighted name
      const focusedIdx = chart.cursor.idx !== null ? chart.series.findIndex(
        (s, i) => i > 0 && s.label === highlightedName
      ) : -1;

      // Apply highlighting based on context
      if (highlightedName === null) {
        // No series highlighted - reset all to original alpha
        for (let i = 1; i < chart.series.length; i++) {
          const originalAlpha = processedLines[i - 1]?.opacity ?? 0.85;
          chart.series[i].alpha = originalAlpha;
        }
      } else {
        // Find the series with matching label and highlight it
        for (let i = 1; i < chart.series.length; i++) {
          const seriesLabel = chart.series[i].label;
          if (seriesLabel === highlightedName) {
            chart.series[i].alpha = 1; // Full opacity for highlighted
          } else {
            chart.series[i].alpha = 0.2; // Fade others
          }
        }
      }

      chart.redraw();
    }, [chartSyncContext?.highlightedSeriesName, processedLines, chartSyncContext]);

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
