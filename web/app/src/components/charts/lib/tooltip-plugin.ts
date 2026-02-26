import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { formatAxisLabel, formatStepValue, smartDateFormatter } from "./format";
import { interpolateValue, type TooltipInterpolation } from "@/lib/math/interpolation";

// ============================
// Tooltip Plugin
// ============================

// --- Shared document-level mousemove safety net (Fix #1) ---
// Instead of each tooltip instance adding its own document "mousemove" listener,
// we use a single shared listener that iterates all registered tooltip instances.
interface TooltipSafetyEntry {
  overEl: HTMLElement;
  tooltipEl: HTMLDivElement;
  isPinned: () => boolean;
  hide: () => void;
}
const tooltipSafetyEntries = new Set<TooltipSafetyEntry>();

function sharedMouseMoveHandler(e: MouseEvent) {
  for (const entry of tooltipSafetyEntries) {
    if (entry.isPinned()) continue;
    if (entry.tooltipEl.style.display === "none") continue;
    const rect = entry.overEl.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      entry.hide();
    }
  }
}

// Lazily attach/detach the single listener based on whether any entries exist
function registerSafetyEntry(entry: TooltipSafetyEntry) {
  if (tooltipSafetyEntries.size === 0) {
    document.addEventListener("mousemove", sharedMouseMoveHandler);
  }
  tooltipSafetyEntries.add(entry);
}

function unregisterSafetyEntry(entry: TooltipSafetyEntry) {
  tooltipSafetyEntries.delete(entry);
  if (tooltipSafetyEntries.size === 0) {
    document.removeEventListener("mousemove", sharedMouseMoveHandler);
  }
}

/** Check if ANY tooltip instance across all charts is currently pinned */
function isAnyTooltipPinnedGlobal(): boolean {
  for (const entry of tooltipSafetyEntries) {
    if (entry.isPinned()) return true;
  }
  return false;
}

const TOOLTIP_SIZE_KEY = "uplot-tooltip-size";

/** Module-level cache so all tooltip instances share the latest size immediately */
let cachedTooltipSize: { width: string; height: string } | null = (() => {
  try {
    const raw = localStorage.getItem(TOOLTIP_SIZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.width === "string" && typeof parsed.height === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
})();

/** Save tooltip dimensions — updates in-memory cache AND localStorage */
function saveTooltipSize(width: string, height: string) {
  cachedTooltipSize = { width, height };
  try {
    localStorage.setItem(TOOLTIP_SIZE_KEY, JSON.stringify(cachedTooltipSize));
  } catch {
    // ignore
  }
}

/** Apply saved tooltip size to a tooltip element (if any saved) */
function applySavedSize(el: HTMLDivElement) {
  if (cachedTooltipSize) {
    el.style.width = cachedTooltipSize.width;
    el.style.height = cachedTooltipSize.height;
    el.style.maxWidth = "none";
    el.style.overflow = "auto";
  }
}

/** Scale a uPlot dash pattern down to fit the small tooltip indicator */
function scaleDash(dash: number[], scale: number): string {
  return dash.map((v) => Math.max(1, Math.round(v * scale))).join(",");
}

/** Helper to safely create tooltip row using DOM APIs (prevents XSS) */
function createTooltipRow(
  name: string,
  value: number,
  color: string,
  textColor: string,
  isHighlighted: boolean = false,
  rawValue?: number,
  isInterpolated: boolean = false,
  flagText?: string,
  rawFlagText?: string,
  dash?: number[],
): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = `padding: 1px 4px; display: flex; align-items: center; gap: 6px; white-space: nowrap${isHighlighted ? "; background: rgba(255,255,255,0.05)" : ""}`;

  // Colored line indicator — SVG with dash pattern matching the chart line
  if (dash && dash.length > 0) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "6");
    svg.style.cssText = "flex-shrink: 0";
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "3");
    line.setAttribute("x2", "16");
    line.setAttribute("y2", "3");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", scaleDash(dash, 0.4));
    svg.appendChild(line);
    row.appendChild(svg);
  } else {
    const colorLine = document.createElement("span");
    colorLine.style.cssText = `flex-shrink: 0; width: 12px; height: 3px; border-radius: 1px; background: ${color}`;
    row.appendChild(colorLine);
  }

  const nameSpan = document.createElement("span");
  nameSpan.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0${isHighlighted ? "; font-weight: 600" : ""}`;
  nameSpan.textContent = name;
  row.appendChild(nameSpan);

  const valueSpan = document.createElement("span");
  if (flagText) {
    // Non-finite value: show flag text (NaN/Inf/-Inf) in warning color
    valueSpan.style.cssText = `color: #e8a838; font-weight: 600; flex-shrink: 0; font-style: italic`;
    valueSpan.textContent = flagText;
  } else if (rawFlagText) {
    // Smoothed value is finite but raw/original value was NaN/Inf/-Inf
    valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0`;
    const smoothedText = document.createTextNode(`${formatAxisLabel(value)} (`);
    valueSpan.appendChild(smoothedText);
    const flagSpan = document.createElement("span");
    flagSpan.style.cssText = "color: #e8a838; font-style: italic";
    flagSpan.textContent = rawFlagText;
    valueSpan.appendChild(flagSpan);
    valueSpan.appendChild(document.createTextNode(")"));
  } else {
    valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0${isInterpolated ? "; opacity: 0.6; font-style: italic" : ""}`;
    if (rawValue != null && rawValue !== value) {
      valueSpan.textContent = `${formatAxisLabel(value)} (${formatAxisLabel(rawValue)})`;
    } else {
      valueSpan.textContent = isInterpolated ? `~${formatAxisLabel(value)}` : formatAxisLabel(value);
    }
  }
  row.appendChild(valueSpan);

  return row;
}

/** Type for hover state that persists across chart recreations */
export interface HoverState {
  isHovering: boolean;
  isPinned: boolean;
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
  /** X-axis label (e.g. "step", "absolute time", "relative time (seconds)", or a metric name) */
  xlabel?: string;
  /** Chart/metric title shown in tooltip header */
  title?: string;
  /** Additional subtitle (e.g. chip/pattern names) shown below title in tooltip header */
  subtitle?: string;
}

export function tooltipPlugin(opts: TooltipPluginOpts): uPlot.Plugin {
  const { theme, isDateTime, timeRange, lines, hoverStateRef, onHoverChange, isActiveChart, highlightedSeriesRef, tooltipInterpolation = "none", xlabel, title, subtitle } = opts;

  // DEBUG: Temporary logging to diagnose tooltip persistence issue
  const DEBUG_TOOLTIP = false; // Set to true for debugging
  const tooltipId = Math.random().toString(36).substring(7);
  const log = (msg: string) => DEBUG_TOOLTIP && console.log(`[tooltip-${tooltipId}] ${msg}`);
  log("tooltipPlugin created");

  let tooltipEl: HTMLDivElement | null = null;
  /** Content container inside tooltipEl — only this gets cleared on content rebuild.
   *  The close button lives directly on tooltipEl, outside this container. */
  let contentContainer: HTMLDivElement | null = null;
  let overEl: HTMLElement | null = null;
  // Restore ALL state from external ref (survives chart recreation)
  let lastIdx: number | null = hoverStateRef?.current.lastIdx ?? null;
  let lastLeft: number | null = hoverStateRef?.current.lastLeft ?? null;
  let lastTop: number | null = hoverStateRef?.current.lastTop ?? null;
  let isHovering = hoverStateRef?.current.isHovering ?? false;
  let isPinned = hoverStateRef?.current.isPinned ?? false;
  let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pinTimerId: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** Timestamp of last unpin — prevents click event from immediately re-pinning */
  let lastUnpinTime = 0;
  /** True while updateTooltipContent is rebuilding DOM — suppresses ResizeObserver localStorage writes */
  let isRebuilding = false;
  /** Shared safety-net entry for the module-level mousemove listener */
  let safetyEntry: TooltipSafetyEntry | null = null;
  /** Drag state for pinned tooltip */
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;

  const handleDragMouseDown = (e: MouseEvent) => {
    if (!tooltipEl || !isPinned) return;
    // Only drag from header area
    const target = e.target as HTMLElement;
    if (!target.closest("[data-tooltip-header]")) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLeft = parseInt(tooltipEl.style.left) || 0;
    dragStartTop = parseInt(tooltipEl.style.top) || 0;
    e.preventDefault();
  };

  const handleDragMouseMove = (e: MouseEvent) => {
    if (!isDragging || !tooltipEl) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    tooltipEl.style.left = `${dragStartLeft + dx}px`;
    tooltipEl.style.top = `${dragStartTop + dy}px`;
  };

  const handleDragMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
  };

  // Sync local state to external ref (includes cursor position now)
  const syncHoverState = () => {
    if (hoverStateRef) {
      hoverStateRef.current = { isHovering, isPinned, lastIdx, lastLeft, lastTop };
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
    applySavedSize(tooltipEl);
    // Content container — only this gets cleared on rebuild, close button stays on tooltipEl
    contentContainer = document.createElement("div");
    tooltipEl.appendChild(contentContainer);
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
      // But suppress if any other tooltip is currently pinned
      if (tooltipEl && !isAnyTooltipPinnedGlobal()) {
        tooltipEl.style.display = "block";
        log("  set display=block");
      }
    };

    const handleMouseLeave = () => {
      log(`mouseleave - isHovering=${isHovering}, isPinned=${isPinned}, pendingHide=${hideTimeoutId !== null}`);
      // When tooltip is pinned, keep it visible on mouseleave
      if (isPinned) return;
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

    // Safety net: shared module-level mousemove listener hides tooltip when mouse is
    // outside chart bounds. Uses a single document listener for all chart instances.
    safetyEntry = {
      overEl: overEl!,
      tooltipEl,
      isPinned: () => isPinned,
      hide: () => {
        if (hideTimeoutId !== null) {
          clearTimeout(hideTimeoutId);
          hideTimeoutId = null;
        }
        isHovering = false;
        lastIdx = null;
        lastLeft = null;
        lastTop = null;
        syncHoverState();
        onHoverChange?.(false);
        if (tooltipEl) tooltipEl.style.display = "none";
      },
    };
    registerSafetyEntry(safetyEntry);

    // --- Pin / Unpin logic ---
    const borderDefault = `1px solid ${theme === "dark" ? "#333" : "#e0e0e0"}`;
    const borderPinned = `1px solid ${theme === "dark" ? "#5b9bf0" : "#3b82f6"}`;

    /** Apply pinned visual state to tooltip */
    const applyPinnedStyle = () => {
      if (!tooltipEl) return;
      tooltipEl.style.pointerEvents = "auto";
      tooltipEl.style.border = borderPinned;
      tooltipEl.style.resize = "both";
      tooltipEl.style.overflow = "auto";
      tooltipEl.style.cursor = "default";
      tooltipEl.style.maxWidth = "none";

      // Enable dragging (header only)
      tooltipEl.addEventListener("mousedown", handleDragMouseDown);
      document.addEventListener("mousemove", handleDragMouseMove);
      document.addEventListener("mouseup", handleDragMouseUp);

      // Apply saved size if available
      applySavedSize(tooltipEl);

      // Observe resize to persist user-chosen dimensions.
      // The isRebuilding guard prevents localStorage writes triggered by content
      // rebuilds (textContent="" + re-appending rows). Only user-initiated resize
      // handle drags should persist dimensions.
      if (!resizeObserver && tooltipEl) {
        const el = tooltipEl;
        resizeObserver = new ResizeObserver(() => {
          if (!isPinned || isRebuilding) return;
          // Use offsetWidth/Height to include padding + border
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w > 0 && h > 0) {
            saveTooltipSize(`${w}px`, `${h}px`);
          }
        });
        resizeObserver.observe(tooltipEl);
      }

      // Add close button if not already present
      if (!tooltipEl.querySelector("[data-tooltip-close]")) {
        const closeBtn = document.createElement("button");
        closeBtn.setAttribute("data-tooltip-close", "true");
        closeBtn.style.cssText = `
          position: absolute; top: 2px; right: 2px;
          width: 16px; height: 16px; border: none; background: transparent;
          color: ${theme === "dark" ? "#888" : "#666"};
          cursor: pointer; font-size: 12px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          border-radius: 2px; padding: 0;
        `;
        closeBtn.textContent = "\u00d7";
        closeBtn.addEventListener("mouseenter", () => {
          closeBtn.style.background = theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
        });
        closeBtn.addEventListener("mouseleave", () => {
          closeBtn.style.background = "transparent";
        });
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          unpinTooltip();
        });
        tooltipEl.style.position = "fixed"; // keep fixed positioning
        tooltipEl.appendChild(closeBtn);
      }
    };

    /** Pin the tooltip at its current position */
    const pinTooltip = () => {
      if (!tooltipEl) return;
      isPinned = true;
      syncHoverState();
      applyPinnedStyle();
      log("tooltip pinned");
    };

    /** Unpin the tooltip and restore normal following behavior */
    const unpinTooltip = () => {
      if (!tooltipEl) return;
      isPinned = false;
      lastUnpinTime = Date.now();
      syncHoverState();
      // Stop observing resize
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      // Remove drag handlers
      tooltipEl.removeEventListener("mousedown", handleDragMouseDown);
      document.removeEventListener("mousemove", handleDragMouseMove);
      document.removeEventListener("mouseup", handleDragMouseUp);
      isDragging = false;

      tooltipEl.style.pointerEvents = "none";
      tooltipEl.style.border = borderDefault;
      tooltipEl.style.resize = "none";
      tooltipEl.style.cursor = "";
      // Apply saved size or reset to defaults
      if (cachedTooltipSize) {
        applySavedSize(tooltipEl);
      } else {
        tooltipEl.style.width = "";
        tooltipEl.style.height = "";
        tooltipEl.style.maxWidth = "300px";
        tooltipEl.style.overflow = "";
      }
      // Remove close button
      const closeBtn = tooltipEl.querySelector("[data-tooltip-close]");
      if (closeBtn) {
        closeBtn.remove();
      }
      // Check if mouse is actually over the chart right now.
      // isHovering may be stale because handleMouseLeave returned early while pinned.
      const mouseOverChart = overEl ? overEl.matches(":hover") : false;
      if (!mouseOverChart) {
        isHovering = false;
        tooltipEl.style.display = "none";
        onHoverChange?.(false);
      }
      syncHoverState();
      log("tooltip unpinned");
    };

    // Click on chart area → toggle pin (with debounce to avoid double-click conflict)
    const handleOverClick = () => {
      // If already pinned, unpin (toggle behavior)
      if (isPinned) {
        unpinTooltip();
        return;
      }
      // Skip if we just unpinned — the mousedown handler may have unpinned,
      // and this click event from the same interaction would immediately re-pin
      if (Date.now() - lastUnpinTime < 300) return;
      // If tooltip isn't visible or has no content, don't pin
      if (!tooltipEl || tooltipEl.style.display === "none" || lastIdx == null) return;
      // Start a 300ms timer; if dblclick fires before, we cancel
      pinTimerId = setTimeout(() => {
        pinTimerId = null;
        pinTooltip();
      }, 200);
    };

    // Double-click cancels pending pin timer so zoom reset proceeds normally
    const handleOverDblClick = () => {
      if (pinTimerId !== null) {
        clearTimeout(pinTimerId);
        pinTimerId = null;
        log("pin cancelled by dblclick");
      }
    };

    // Escape key unpins
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isPinned) {
        unpinTooltip();
      }
    };

    // Click outside pinned tooltip unpins
    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (!isPinned || !tooltipEl) return;
      if (!tooltipEl.contains(e.target as Node)) {
        unpinTooltip();
      }
    };

    overEl!.addEventListener("click", handleOverClick);
    overEl!.addEventListener("dblclick", handleOverDblClick);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleDocumentMouseDown);

    // Store cleanup function on the element for later removal
    (overEl as HTMLElement & { _tooltipCleanup?: () => void })._tooltipCleanup = () => {
      overEl?.removeEventListener("mouseenter", handleMouseEnter);
      overEl?.removeEventListener("mouseleave", handleMouseLeave);
      overEl?.removeEventListener("click", handleOverClick);
      overEl?.removeEventListener("dblclick", handleOverDblClick);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      if (safetyEntry) {
        unregisterSafetyEntry(safetyEntry);
        safetyEntry = null;
      }
      // Clear any pending timers
      if (hideTimeoutId !== null) {
        clearTimeout(hideTimeoutId);
        hideTimeoutId = null;
      }
      if (pinTimerId !== null) {
        clearTimeout(pinTimerId);
        pinTimerId = null;
      }
    };

    // CRITICAL: Check if we were hovering before chart recreation
    // This handles the case where chart is recreated while mouse is stationary over it
    // The external hoverStateRef preserves the hover state AND cursor position
    if (isHovering && tooltipEl && lastIdx != null) {
      log(`init: restoring hover state - idx=${lastIdx}, left=${lastLeft}, top=${lastTop}, isPinned=${isPinned}`);
      tooltipEl.style.display = "block";
      // Immediately update tooltip content with restored state
      // Use requestAnimationFrame to ensure uPlot is fully initialized
      requestAnimationFrame(() => {
        if (lastIdx != null) {
          updateTooltipContent(u, lastIdx);
        }
        // Re-apply pinned style after chart recreation (border, resize, close button)
        if (isPinned) {
          applyPinnedStyle();
        }
      });
    }
  }

  function updateTooltipContent(u: uPlot, idx: number) {
    if (!tooltipEl || !contentContainer) return;

    const xVal = u.data[0][idx];
    // If no valid x value, just return - don't hide (mouseleave handles that)
    if (xVal == null) return;

    // Format x value — show exact step for non-datetime axes
    const xFormatted = isDateTime
      ? smartDateFormatter(xVal, timeRange)
      : formatStepValue(xVal);

    // Gather series values
    const textColor = theme === "dark" ? "#fff" : "#000";
    const seriesItems: { name: string; value: number; color: string; hidden: boolean; rawValue?: number; isInterpolated: boolean; flagText?: string; rawFlagText?: string; dash?: number[] }[] = [];

    // First pass: collect raw (original) values and flags from hidden smoothing series
    const rawValues = new Map<string, number>();
    const rawFlags = new Map<string, string>();
    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      const yVal = u.data[i][idx];
      const lineData = lines[i - 1];
      if (series.show !== false && lineData?.hideFromLegend) {
        const labelText = typeof series.label === "string" ? series.label : "";
        if (labelText.endsWith(" (original)")) {
          const baseName = labelText.slice(0, -" (original)".length);
          if (yVal != null) {
            rawValues.set(baseName, yVal);
          } else {
            // Check if the raw value has a non-finite flag (NaN/Inf/-Inf)
            const xAtIdx = (u.data[0] as number[])[idx];
            const flag = lineData?.valueFlags?.get(xAtIdx);
            if (flag) {
              rawFlags.set(baseName, flag);
            }
          }
        }
      }
    }

    const xValues = u.data[0] as number[];

    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      if (series.show === false) continue;

      let yVal = u.data[i][idx] as number | null | undefined;
      let isInterpolated = false;

      // Check for non-finite value flag (NaN/Inf/-Inf) before interpolation
      const lineData = lines[i - 1];
      const xAtIdx = xValues[idx];
      const flag = lineData?.valueFlags?.get(xAtIdx);

      if (yVal == null && flag) {
        // This is a known non-finite value — show flag text instead of interpolating
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        const seriesColor = lineData?.color || `hsl(${((i - 1) * 137) % 360}, 70%, 50%)`;
        seriesItems.push({
          name: labelText,
          value: 0,
          color: seriesColor,
          hidden: lineData?.hideFromLegend || false,
          isInterpolated: false,
          flagText: flag,
          dash: lineData?.dash,
        });
        continue;
      }

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
          rawFlagText: rawFlags.get(labelText),
          dash: lineData?.dash,
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

    // Clear content container only — close button lives on tooltipEl outside this container
    isRebuilding = true;
    contentContainer.textContent = "";

    // Create header using safe DOM APIs (prevents XSS)
    // Header doubles as drag handle when pinned
    const header = document.createElement("div");
    header.setAttribute("data-tooltip-header", "true");
    header.style.cssText = `font-weight: bold; color: ${textColor}; padding: 2px 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px; font-size: 10px; cursor: ${isPinned ? "grab" : "default"}; user-select: none`;

    // First row: step/time label + series count
    const topRow = document.createElement("div");
    topRow.style.cssText = "display: flex; align-items: center; gap: 8px";

    const xLabel = document.createElement("span");
    const xAxisLabel = isDateTime
      ? xFormatted
      : xlabel && xlabel !== "step"
        ? `${xlabel} ${xFormatted}`
        : `Step ${xFormatted}`;
    xLabel.textContent = xAxisLabel;
    topRow.appendChild(xLabel);

    const countLabel = document.createElement("span");
    countLabel.style.cssText = "opacity: 0.6; font-weight: normal; font-size: 9px; flex-shrink: 0";
    countLabel.textContent = `${visibleItems.length} series`;
    topRow.appendChild(countLabel);

    header.appendChild(topRow);

    // Second row: chart title and/or subtitle (chip/pattern names)
    const infoText = [title, subtitle].filter(Boolean).join(" · ");
    if (infoText) {
      const infoRow = document.createElement("div");
      infoRow.style.cssText = `font-weight: normal; font-size: 9px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`;
      infoRow.textContent = infoText;
      header.appendChild(infoRow);
    }

    contentContainer.appendChild(header);

    // Create scrollable content area for all series
    const content = document.createElement("div");
    content.setAttribute("data-tooltip-content", "true");
    content.style.cssText = "overflow-y: auto; scrollbar-width: thin";

    // Add ALL rows using safe DOM APIs - scrolling handles overflow
    for (const s of visibleItems) {
      const isHighlighted = highlightedName !== null && s.name === highlightedName;
      content.appendChild(createTooltipRow(s.name, s.value, s.color, textColor, isHighlighted, s.rawValue, s.isInterpolated, s.flagText, s.rawFlagText, s.dash));
    }

    contentContainer.appendChild(content);
    isRebuilding = false;

    // Apply latest saved size from shared cache (picks up resizes from other pinned tooltips)
    applySavedSize(tooltipEl);

    // Position tooltip following the cursor with offset to top-right
    // Use viewport coordinates so tooltip can overflow chart boundaries
    const tooltipWidth = tooltipEl.offsetWidth || 200;

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

    // Set content max-height to fill full viewport (minus header/padding/border overhead)
    const maxContentHeight = window.innerHeight - 48;
    if (maxContentHeight > 0) {
      content.style.maxHeight = `${maxContentHeight}px`;
    }

    // Measure tooltip after content max-height is set
    const tooltipHeight = tooltipEl.offsetHeight || 100;

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

    // For non-active (synced) charts, HIDE the tooltip (unless pinned)
    // This prevents multiple tooltips from appearing on different charts
    // With synchronous ref tracking in chart-sync-context, this is now safe
    if (!isActive && !isPinned) {
      log(`setCursor - hiding tooltip (not active chart)`);
      tooltipEl.style.display = "none";
      return;
    }

    // If any other tooltip is pinned, suppress this chart's tooltip
    // This prevents a second tooltip from appearing when hovering after pinning
    if (!isPinned && isAnyTooltipPinnedGlobal()) {
      tooltipEl.style.display = "none";
      return;
    }

    // When pinned, update values to match synced cursor but keep position fixed.
    // Close button is safe — it lives on tooltipEl, outside contentContainer.
    if (isPinned) {
      const syncIdx = u.cursor.idx ?? lastIdx;
      if (syncIdx != null && tooltipEl) {
        const savedLeft = tooltipEl.style.left;
        const savedTop = tooltipEl.style.top;
        updateTooltipContent(u, syncIdx);
        // Restore pinned position (updateTooltipContent repositions based on cursor)
        tooltipEl.style.left = savedLeft;
        tooltipEl.style.top = savedTop;
      }
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
        log(`destroy called - isHovering=${isHovering}, isPinned=${isPinned}, hideTimeoutId=${hideTimeoutId !== null}`);
        // Cleanup event listeners
        const cleanup = (overEl as HTMLElement & { _tooltipCleanup?: () => void })?._tooltipCleanup;
        cleanup?.();

        // Cleanup resize observer
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }

        // Cleanup drag listeners
        document.removeEventListener("mousemove", handleDragMouseMove);
        document.removeEventListener("mouseup", handleDragMouseUp);
        if (tooltipEl) {
          tooltipEl.removeEventListener("mousedown", handleDragMouseDown);
        }

        // Remove tooltip element
        if (tooltipEl && tooltipEl.parentNode) {
          tooltipEl.parentNode.removeChild(tooltipEl);
        }

        if (safetyEntry) {
          unregisterSafetyEntry(safetyEntry);
          safetyEntry = null;
        }
      },
    },
  };
}
