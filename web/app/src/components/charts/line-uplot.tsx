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
import { applyAlpha } from "@/lib/math/color-alpha";
import { useChartSyncContext, applySeriesHighlight } from "./context/chart-sync-context";
import { useChartLineWidth } from "@/lib/hooks/use-chart-line-width";
import { toast } from "sonner";


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
  textColor: string,
  isHighlighted: boolean = false,
  rawValue?: number,
): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = `padding: 1px 4px; display: flex; align-items: center; gap: 6px; white-space: nowrap${isHighlighted ? "; background: rgba(255,255,255,0.05)" : ""}`;

  // Colored line indicator (horizontal bar)
  const colorLine = document.createElement("span");
  colorLine.style.cssText = `flex-shrink: 0; width: 12px; height: 3px; border-radius: 1px; background: ${color}`;
  row.appendChild(colorLine);

  const nameSpan = document.createElement("span");
  nameSpan.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0${isHighlighted ? "; font-weight: 600" : ""}`;
  nameSpan.textContent = name;
  row.appendChild(nameSpan);

  const valueSpan = document.createElement("span");
  valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0`;
  if (rawValue != null && rawValue !== value) {
    valueSpan.textContent = `${formatAxisLabel(value)} (${formatAxisLabel(rawValue)})`;
  } else {
    valueSpan.textContent = formatAxisLabel(value);
  }
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
  /** Ref to get currently highlighted series name */
  highlightedSeriesRef?: { current: string | null };
}): uPlot.Plugin {
  const { theme, isDateTime, timeRange, lines, hoverStateRef, onHoverChange, isActiveChart, highlightedSeriesRef } = opts;

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
    const seriesItems: { name: string; value: number; color: string; hidden: boolean; rawValue?: number }[] = [];

    // First pass: collect raw (original) values from hidden smoothing series
    const rawValues = new Map<string, number>();
    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      const yVal = u.data[i][idx];
      const lineData = lines[i - 1];
      if (yVal != null && series.show !== false && lineData?.hideFromLegend) {
        const labelText = typeof series.label === "string" ? series.label : "";
        if (labelText.endsWith(" (original)")) {
          rawValues.set(labelText.slice(0, -" (original)".length), yVal);
        }
      }
    }

    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      const yVal = u.data[i][idx];
      if (yVal != null && series.show !== false) {
        const lineData = lines[i - 1];
        // Handle label which can be string or HTMLElement
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        // Get color from lineData (series.stroke is a function, not a string)
        const seriesColor = lineData?.color || `hsl(${((i - 1) * 137) % 360}, 70%, 50%)`;
        seriesItems.push({
          name: labelText,
          value: yVal,
          color: seriesColor,
          hidden: lineData?.hideFromLegend || false,
          rawValue: rawValues.get(labelText),
        });
      }
    }

    // Get highlighted series name
    const highlightedName = highlightedSeriesRef?.current ?? null;

    // Sort: highlighted series first, then by value descending
    seriesItems.sort((a, b) => {
      // Highlighted series always comes first
      if (highlightedName) {
        if (a.name === highlightedName && b.name !== highlightedName) return -1;
        if (b.name === highlightedName && a.name !== highlightedName) return 1;
      }
      // Then sort by value descending
      return b.value - a.value;
    });

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
      const isHighlighted = highlightedName !== null && s.name === highlightedName;
      content.appendChild(createTooltipRow(s.name, s.value, s.color, textColor, isHighlighted, s.rawValue));
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

    // For non-active (synced) charts, HIDE the tooltip
    // This prevents multiple tooltips from appearing on different charts
    // With synchronous ref tracking in chart-sync-context, this is now safe
    if (!isActive) {
      log(`setCursor - hiding tooltip (not active chart)`);
      tooltipEl.style.display = "none";
      return;
    }

    // If not hovering, don't update content
    if (!isHovering) return;

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
      const dataMin = xData.length > 0 ? Math.min(...xData) : null;
      const dataMax = xData.length > 0 ? Math.max(...xData) : null;

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

      // Series configuration
      const series: uPlot.Series[] = [
        {
          // X axis
          label: xlabel || "x",
        },
        ...processedLines.map((line, i) => {
          // Check if this series has only a single point - need to show as dot since lines need 2+ points
          const isSinglePoint = line.x.length === 1;
          const baseColor = line.color || `hsl(${(i * 137) % 360}, 70%, 50%)`;

          return {
            label: line.label,
            _seriesId: line.seriesId ?? line.label,
            // Use a function for stroke that checks both local and cross-chart focus
            // and applies per-series opacity (used by smoothing to dim raw data)
            stroke: (u: uPlot, seriesIdx: number) => {
              const localFocusIdx = lastFocusedSeriesRef.current;
              const crossChartLabel = crossChartHighlightRef.current;
              const tableId = tableHighlightRef.current;
              const thisSeriesLabel = u.series[seriesIdx]?.label;
              const thisSeriesId = (u.series[seriesIdx] as any)?._seriesId;
              const lineOpacity = line.opacity ?? 1;

              // Determine if this series should be highlighted
              // Priority: local chart hover > cross-chart hover > table row hover
              let isHighlighted = false;
              let highlightedLabel: string | null = null;

              if (localFocusIdx !== null) {
                // Local focus takes priority (this chart is being hovered)
                isHighlighted = seriesIdx === localFocusIdx;
                highlightedLabel = typeof u.series[localFocusIdx]?.label === "string"
                  ? (u.series[localFocusIdx].label as string) : null;
              } else if (crossChartLabel !== null) {
                // Cross-chart highlight (another chart is being hovered)
                isHighlighted = thisSeriesLabel === crossChartLabel;
                highlightedLabel = crossChartLabel;
              } else if (tableId !== null) {
                // Table row hover highlight - match by unique seriesId to handle duplicate run names
                isHighlighted = thisSeriesId === tableId;
              }

              const isFocusActive =
                localFocusIdx !== null || crossChartLabel !== null || tableId !== null;

              // Check if this is the raw/original companion of the highlighted series
              const isRawOfHighlighted = isFocusActive && !isHighlighted &&
                line.hideFromLegend &&
                typeof thisSeriesLabel === "string" &&
                thisSeriesLabel.endsWith(" (original)") &&
                highlightedLabel !== null &&
                thisSeriesLabel === highlightedLabel + " (original)";

              if (!isFocusActive || isHighlighted) {
                return lineOpacity < 1
                  ? applyAlpha(baseColor, lineOpacity)
                  : baseColor;
              }
              // Slightly boost raw companion of emphasized series
              if (isRawOfHighlighted) {
                return applyAlpha(baseColor, Math.min(lineOpacity * 2.5, 0.35));
              }
              // Dim unfocused series: combine line opacity with focus dimming
              return applyAlpha(baseColor, lineOpacity * 0.15);
            },
            width: chartLineWidth,
            dash: line.dashed ? [5, 5] : undefined,
            spanGaps: true,
            points: {
              // Show points for single-point series since lines need 2+ points to be visible
              show: isSinglePoint,
              size: isSinglePoint ? 10 : 6,
              fill: (line.opacity ?? 1) < 1
                ? applyAlpha(baseColor, line.opacity!)
                : baseColor,
            },
          };
        }),
      ];

      // Scales configuration
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
          }),
        ],
        hooks: {
          ready: [
            (u) => {
              // Store chart instance for resetting emphasis on mouseleave
              chartInstanceRef.current = u;
            },
          ],
          setCursor: [
            (u) => {
              // Manual focus detection - uPlot's built-in focus doesn't work with cursor sync
              // because synced charts receive bad Y coordinates

              // Only run focus detection on the actively hovered chart
              if (!isActiveChart()) return;

              const idx = u.cursor.idx;
              const top = u.cursor.top;

              // Skip if cursor not on chart
              if (idx == null || top == null || top < 0) return;

              // Find the series closest to the cursor Y position
              let closestSeriesIdx: number | null = null;
              let closestDistance = Infinity;

              const yScale = u.scales.y;

              for (let si = 1; si < u.series.length; si++) {
                const series = u.series[si];
                if (!series.show) continue; // Skip hidden series

                // Skip raw/original series from smoothing - only smoothed lines should compete for emphasis
                const lineData = processedLines[si - 1];
                if (lineData?.hideFromLegend) continue;

                const yData = u.data[si] as (number | null)[];
                const yVal = yData[idx];
                if (yVal == null) continue;

                // Convert data value to pixel position
                if (yScale.min == null || yScale.max == null) continue;

                const plotHeight = u.bbox.height / devicePixelRatio;
                const yRange = yScale.max - yScale.min;
                const yPx = plotHeight - ((yVal - yScale.min) / yRange) * plotHeight;

                const distance = Math.abs(yPx - top);
                if (distance < closestDistance) {
                  closestDistance = distance;
                  closestSeriesIdx = si;
                }
              }

              // Skip if no change from last focus
              if (closestSeriesIdx === lastFocusedSeriesRef.current) return;

              // Apply emphasis (always pick closest, no threshold)
              if (closestSeriesIdx != null && closestDistance < Infinity) {
                // Update focus ref - stroke functions will read this during redraw
                lastFocusedSeriesRef.current = closestSeriesIdx;

                // Trigger redraw so stroke functions re-evaluate with new focus
                u.redraw();

                // CROSS-CHART highlighting
                const seriesLabel = processedLines[closestSeriesIdx - 1]?.label ?? null;
                if (seriesLabel) {
                  // Update tooltip ref immediately (context state is async)
                  highlightedSeriesRef.current = seriesLabel;
                  chartSyncContextRef.current?.highlightUPlotSeries(chartId, seriesLabel);
                  chartSyncContextRef.current?.setHighlightedSeriesName(seriesLabel);
                }
              }
            },
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

                // ZOOM SYNC: Broadcast X scale to other charts via context
                // Only sync if this is a user-initiated zoom (drag), not a programmatic scale change.
                // Programmatic changes (chart init, zoom sync from context, syncXScale propagation)
                // must not broadcast back to context as that corrupts syncedZoomRange for other charts.
                // Also skip when syncXScale is propagating to this chart (isSyncingZoomRef) -
                // without this, target charts re-broadcast during scroll when isActiveChart() is true.
                if (!isProgrammaticScaleRef.current && !chartSyncContextRef.current?.isSyncingZoomRef?.current && isActiveChart()) {
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
              }
            },
          ],
          // Note: setSelect hook removed - zoom is handled by cursor.drag.setScale: true
          // The setScale hook above handles Y-axis auto-scaling when X scale changes
        },
      };
      // Note: width/height excluded from deps - size changes handled by separate setSize() effect
      // Note: xRange removed - global range is set via setScale() after chart creation, not in options
      // Note: yRange removed - Y auto-scaling is handled by scale.auto:true and setScale hook
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
        // Check if data actually changed (avoid unnecessary setData on resize)
        if (prevDataRef.current === uplotData) {
          // Data reference is the same - this is just a resize, skip
          return;
        }

        // Check if we can use setData() instead of full recreation
        // setData() preserves zoom state and is more efficient
        if (
          prevDataStructureRef.current &&
          prevDataStructureRef.current.seriesCount === currentSeriesCount
        ) {
          // Structure is the same - use setData() to preserve zoom
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

      // Track data structure and reference for future setData() optimization
      prevDataStructureRef.current = { seriesCount: currentSeriesCount };
      prevDataRef.current = uplotData;

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
          const dataMin = Math.min(...xData);
          const dataMax = Math.max(...xData);
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
            const dataMin = Math.min(...xData);
            const dataMax = Math.max(...xData);
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

      // Safety: Re-check synced zoom from context in next frame
      // This handles race conditions where context wasn't yet updated during chart creation
      if (!rangeToApply && !logXAxis && !isDateTime) {
        requestAnimationFrame(() => {
          const ctx = chartSyncContextRef.current;
          const lateSyncedZoom = ctx?.syncedZoomRange;
          if (lateSyncedZoom && chart) {
            const xData = chart.data[0] as number[];
            if (xData && xData.length > 0) {
              const dataMin = Math.min(...xData);
              const dataMax = Math.max(...xData);
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
        try {
          isProgrammaticScaleRef.current = true;
          chart.batch(() => {
            chart.setData(chart.data);
          });
        } finally {
          isProgrammaticScaleRef.current = false;
        }
        // Clear saved zoom state so it doesn't get restored on next data update
        zoomStateRef.current = null;
        // Clear user zoom flag so global range can be applied again
        userHasZoomedRef.current = false;
        lastAppliedGlobalRangeRef.current = null;
        // Reset toast tracking so it can show again if needed
        noDataToastShownRef.current = null;
        // Clear synced zoom in context so all charts reset
        chartSyncContextRef.current?.setSyncedZoomRange(null);
        // Reset all other charts to global range
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
          // Reset by re-setting data which recalculates auto bounds
          if (chartRef.current) {
            try {
              isProgrammaticScaleRef.current = true;
              chartRef.current.setData(chartRef.current.data);
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
