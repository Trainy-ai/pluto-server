import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { formatAxisLabel, formatStepValue, smartDateFormatter } from "./format";
import { interpolateValue, type TooltipInterpolation } from "@/lib/math/interpolation";

// ============================
// Tooltip Plugin
// ============================

/** Helper to safely create tooltip row using DOM APIs (prevents XSS) */
function createTooltipRow(
  name: string,
  value: number,
  color: string,
  textColor: string,
  isHighlighted: boolean = false,
  rawValue?: number,
  isInterpolated: boolean = false,
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
  valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0${isInterpolated ? "; opacity: 0.6; font-style: italic" : ""}`;
  if (rawValue != null && rawValue !== value) {
    valueSpan.textContent = `${formatAxisLabel(value)} (${formatAxisLabel(rawValue)})`;
  } else {
    valueSpan.textContent = isInterpolated ? `~${formatAxisLabel(value)}` : formatAxisLabel(value);
  }
  row.appendChild(valueSpan);

  return row;
}

/** Type for hover state that persists across chart recreations */
export interface HoverState {
  isHovering: boolean;
  lastIdx: number | null;
  lastLeft: number | null;
  lastTop: number | null;
}

export interface TooltipPluginOpts {
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
  /** Tooltip interpolation mode for missing values */
  tooltipInterpolation?: TooltipInterpolation;
}

export function tooltipPlugin(opts: TooltipPluginOpts): uPlot.Plugin {
  const { theme, isDateTime, timeRange, lines, hoverStateRef, onHoverChange, isActiveChart, highlightedSeriesRef, tooltipInterpolation = "none" } = opts;

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
    tooltipEl.dataset.testid = "uplot-tooltip";
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

    // Format x value — show exact step for non-datetime axes
    const xFormatted = isDateTime
      ? smartDateFormatter(xVal, timeRange)
      : formatStepValue(xVal);

    // Gather series values
    const textColor = theme === "dark" ? "#fff" : "#000";
    const seriesItems: { name: string; value: number; color: string; hidden: boolean; rawValue?: number; isInterpolated: boolean }[] = [];

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

    const xValues = u.data[0] as number[];

    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      if (series.show === false) continue;

      let yVal = u.data[i][idx] as number | null | undefined;
      let isInterpolated = false;

      // If value is null and interpolation is enabled, try to interpolate
      if (yVal == null && tooltipInterpolation !== "none") {
        const interpolated = interpolateValue(
          xValues,
          u.data[i] as (number | null | undefined)[],
          idx,
          tooltipInterpolation,
        );
        if (interpolated !== null) {
          yVal = interpolated;
          isInterpolated = true;
        }
      }

      if (yVal != null) {
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
          isInterpolated,
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
      content.appendChild(createTooltipRow(s.name, s.value, s.color, textColor, isHighlighted, s.rawValue, s.isInterpolated));
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
