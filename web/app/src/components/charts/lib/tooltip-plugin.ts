import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { formatAxisLabel, formatRelativeTimeValue, formatStepValue, smartDateFormatter } from "./format";
import { interpolateValue, isInsideDataGap, type TooltipInterpolation } from "@/lib/math/interpolation";

// ============================
// Tooltip Column Configuration
// ============================

/** Available columns for tooltip display */
export type TooltipColumnId = "name" | "value" | "run-name" | "run-id" | "metric";

export interface TooltipColumnConfig {
  id: TooltipColumnId;
  label: string;
  enabled: boolean;
}

const TOOLTIP_COLUMNS_KEY = "uplot-tooltip-columns";
const TOOLTIP_COL_WIDTHS_KEY = "uplot-tooltip-col-widths";

/** All available tooltip columns with defaults */
const ALL_COLUMNS: TooltipColumnConfig[] = [
  { id: "run-id", label: "Display ID", enabled: true },
  { id: "run-name", label: "Run Name", enabled: true },
  { id: "metric", label: "Metric", enabled: true },
  { id: "value", label: "Value", enabled: true },
  { id: "name", label: "Series Name", enabled: false },
];

/** Module-level cache for column config */
let cachedTooltipColumns: TooltipColumnConfig[] | null = (() => {
  try {
    const raw = localStorage.getItem(TOOLTIP_COLUMNS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Restore saved order AND enabled state, then append any new columns not in saved data
      const result: TooltipColumnConfig[] = [];
      for (const saved of parsed) {
        const def = ALL_COLUMNS.find((c) => c.id === saved.id);
        if (def) result.push({ ...def, enabled: saved.enabled });
      }
      // Append any columns added since last save
      for (const col of ALL_COLUMNS) {
        if (!result.find((r) => r.id === col.id)) result.push(col);
      }
      return result;
    }
  } catch {
    // ignore
  }
  return null;
})();

function getTooltipColumns(): TooltipColumnConfig[] {
  return cachedTooltipColumns ?? ALL_COLUMNS;
}

function saveTooltipColumns(columns: TooltipColumnConfig[]) {
  cachedTooltipColumns = columns;
  try {
    localStorage.setItem(TOOLTIP_COLUMNS_KEY, JSON.stringify(columns));
  } catch {
    // ignore
  }
  // Notify all tooltip instances to rebuild their settings UI
  document.dispatchEvent(new CustomEvent("tooltip-columns-changed"));
}

// ============================
// Column Width Persistence
// ============================

/** Default column widths in pixels */
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  "run-id": 70,
  "run-name": 110,
  "metric": 90,
  "value": 100,
  "name": 130,
};

/** Module-level cache for column widths */
let cachedColWidths: Record<string, number> = (() => {
  try {
    const raw = localStorage.getItem(TOOLTIP_COL_WIDTHS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_COL_WIDTHS, ...parsed };
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_COL_WIDTHS };
})();

function getColWidth(id: string): number {
  return cachedColWidths[id] ?? DEFAULT_COL_WIDTHS[id] ?? 80;
}

function saveColWidth(id: string, width: number) {
  cachedColWidths[id] = width;
  try {
    localStorage.setItem(TOOLTIP_COL_WIDTHS_KEY, JSON.stringify(cachedColWidths));
  } catch { /* ignore */ }
}

/** Build CSS grid-template-columns for a set of enabled columns.
 *  Format: "16px <col1>px <col2>px ..." (16px = color indicator) */
function buildGridTemplate(enabledColumns: TooltipColumnConfig[]): string {
  const parts = ["16px"]; // color indicator
  for (const col of enabledColumns) {
    parts.push(`${getColWidth(col.id)}px`);
  }
  return parts.join(" ");
}

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

/** Metadata for a tooltip row, used for column-based rendering */
interface TooltipRowData {
  name: string;
  value: number;
  color: string;
  isHighlighted: boolean;
  rawValue?: number;
  isInterpolated: boolean;
  flagText?: string;
  rawFlagText?: string;
  dash?: number[];
  runName?: string;
  runId?: string;
  metricName?: string;
  /** Non-finite flags present in this bucket (for bucketed data) */
  nonFiniteFlags?: Set<"NaN" | "Inf" | "-Inf">;
}

/** Append non-finite marker icons (△ ▽ ⊗) after the value text */
function appendNonFiniteIcons(
  parent: HTMLSpanElement,
  flags: Set<"NaN" | "Inf" | "-Inf">,
) {
  if (flags.has("Inf")) {
    const icon = document.createElement("span");
    icon.style.cssText = "margin-left: 3px; font-size: 10px; opacity: 0.85";
    icon.title = "+Infinity in this range";
    icon.textContent = "\u25b3"; // △
    parent.appendChild(icon);
  }
  if (flags.has("-Inf")) {
    const icon = document.createElement("span");
    icon.style.cssText = "margin-left: 3px; font-size: 10px; opacity: 0.85";
    icon.title = "-Infinity in this range";
    icon.textContent = "\u25bd"; // ▽
    parent.appendChild(icon);
  }
  if (flags.has("NaN")) {
    const icon = document.createElement("span");
    icon.style.cssText = "margin-left: 3px; color: #d4a017; font-size: 10px";
    icon.title = "NaN in this range";
    icon.textContent = "\u2297"; // ⊗
    parent.appendChild(icon);
  }
}

/** Helper to format a value span with proper styling for flags/interpolation */
function formatValueContent(
  valueSpan: HTMLSpanElement,
  data: TooltipRowData,
  textColor: string,
) {
  if (data.flagText) {
    valueSpan.style.cssText = `color: #e8a838; font-weight: 600; flex-shrink: 0; font-style: italic`;
    valueSpan.textContent = data.flagText;
  } else if (data.rawFlagText) {
    valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0`;
    const smoothedText = document.createTextNode(`${formatAxisLabel(data.value)} (`);
    valueSpan.appendChild(smoothedText);
    const flagSpan = document.createElement("span");
    flagSpan.style.cssText = "color: #e8a838; font-style: italic";
    flagSpan.textContent = data.rawFlagText;
    valueSpan.appendChild(flagSpan);
    valueSpan.appendChild(document.createTextNode(")"));
  } else {
    valueSpan.style.cssText = `color: ${textColor}; font-weight: 500; flex-shrink: 0${data.isInterpolated ? "; opacity: 0.6; font-style: italic" : ""}`;
    if (data.rawValue != null && data.rawValue !== data.value) {
      valueSpan.textContent = `${formatAxisLabel(data.value)} (${formatAxisLabel(data.rawValue)})`;
    } else {
      valueSpan.textContent = data.isInterpolated ? `~${formatAxisLabel(data.value)}` : formatAxisLabel(data.value);
    }
  }
  // Append non-finite marker icons if this bucket contains NaN/Inf
  if (data.nonFiniteFlags && data.nonFiniteFlags.size > 0) {
    appendNonFiniteIcons(valueSpan, data.nonFiniteFlags);
  }
}

/** Helper to safely create tooltip row using DOM APIs (prevents XSS) */
function createTooltipRow(
  data: TooltipRowData,
  textColor: string,
  columns: TooltipColumnConfig[],
  theme: string = "dark",
): HTMLDivElement {
  const enabledColumns = columns.filter((c) => c.enabled);
  const row = document.createElement("div");
  row.style.cssText = `padding: 2px 4px; display: grid; grid-template-columns: ${buildGridTemplate(enabledColumns)}; align-items: center; gap: 6px; white-space: nowrap${data.isHighlighted ? "; background: rgba(255,255,255,0.05)" : ""}`;

  // Colored line indicator — SVG with dash pattern matching the chart line
  if (data.dash && data.dash.length > 0) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "6");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "3");
    line.setAttribute("x2", "16");
    line.setAttribute("y2", "3");
    line.setAttribute("stroke", data.color);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", scaleDash(data.dash, 0.4));
    svg.appendChild(line);
    row.appendChild(svg);
  } else {
    const colorLine = document.createElement("span");
    colorLine.style.cssText = `width: 12px; height: 3px; border-radius: 1px; background: ${data.color}`;
    row.appendChild(colorLine);
  }

  const dividerColor = theme === "dark" ? "#333" : "#ddd";
  for (let ci = 0; ci < enabledColumns.length; ci++) {
    const col = enabledColumns[ci];
    const isLast = ci === enabledColumns.length - 1;
    const divider = isLast ? "" : `; border-right: 1px solid ${dividerColor}; padding-right: 4px`;
    switch (col.id) {
      case "name": {
        const nameSpan = document.createElement("span");
        nameSpan.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis${data.isHighlighted ? "; font-weight: 600" : ""}${divider}`;
        nameSpan.textContent = data.name;
        row.appendChild(nameSpan);
        break;
      }
      case "value": {
        const valueSpan = document.createElement("span");
        valueSpan.style.cssText = `overflow: hidden; text-overflow: ellipsis${divider}`;
        formatValueContent(valueSpan, data, textColor);
        row.appendChild(valueSpan);
        break;
      }
      case "run-name": {
        const span = document.createElement("span");
        span.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis; opacity: 0.8${divider}`;
        span.textContent = data.runName ?? "";
        row.appendChild(span);
        break;
      }
      case "run-id": {
        const span = document.createElement("span");
        span.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; font-size: 10px${divider}`;
        span.textContent = data.runId ?? "";
        row.appendChild(span);
        break;
      }
      case "metric": {
        const span = document.createElement("span");
        span.style.cssText = `color: ${textColor}; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; font-size: 10px${divider}`;
        span.textContent = data.metricName ?? "";
        row.appendChild(span);
        break;
      }
    }
  }

  return row;
}

/* Settings panel replaced by Neptune-style column headers with +Add dropdown */

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
  /** When false, lines break at gaps — tooltip should not interpolate across large gaps */
  spanGaps?: boolean;
  /** X-axis label (e.g. "step", "absolute time", "relative time (seconds)", or a metric name) */
  xlabel?: string;
  /** Chart/metric title shown in tooltip header */
  title?: string;
  /** Additional subtitle (e.g. chip/pattern names) shown below title in tooltip header */
  subtitle?: string;
  /** Callback when user hovers over a series row in the pinned tooltip */
  onSeriesHover?: (seriesLabel: string | null, runId: string | null) => void;
}

export function tooltipPlugin(opts: TooltipPluginOpts): uPlot.Plugin {
  const { theme, isDateTime, timeRange, lines, hoverStateRef, onHoverChange, isActiveChart, highlightedSeriesRef, tooltipInterpolation = "none", spanGaps = true, xlabel, title, subtitle, onSeriesHover } = opts;

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

  /** Cached tooltip row elements for incremental updates */
  let cachedRows: Map<string, {
    row: HTMLDivElement;
    valueSpan: HTMLSpanElement;
    nameSpan?: HTMLSpanElement;
    runNameSpan?: HTMLSpanElement;
    runIdSpan?: HTMLSpanElement;
    metricSpan?: HTMLSpanElement;
  }> = new Map();
  /** Track the column config that rows were built with */
  let cachedColumnConfig: string = "";
  /** Track whether rows need full rebuild */
  let tooltipStructureDirty = true;
  /** The header x-value label element */
  let cachedHeaderLabel: HTMLSpanElement | null = null;
  /** The series count label element */
  let cachedCountLabel: HTMLSpanElement | null = null;
  /** The scrollable body container for rows */
  let cachedRowContainer: HTMLDivElement | null = null;
  /** rAF id for coalesced tooltip updates */
  let tooltipRafId: number | null = null;
  /** Last cursor index that was actually rendered */
  let lastRenderedIdx: number | null = null;
  /** Pending index for rAF-coalesced updates */
  let pendingIdx: number | null = null;
  /** Search state for pinned tooltip */
  const searchInputRef: { value: string; focused: boolean; cursorPos: number } | null = { value: "", focused: false, cursorPos: 0 };
  /** Whether +Add column dropdown is currently open */
  let addColumnDropdownOpen = false;
  /** Saved pinned position for re-renders */
  let savedPinnedLeft = "0px";
  let savedPinnedTop = "0px";
  /** Drag state for pinned tooltip */
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;
  /** Stored uPlot instance for event-driven re-renders */
  let chartInstance: uPlot | null = null;

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

  /** Close the +Add dropdown if open (remove from body since it's appended there) */
  const closeAddDropdown = () => {
    addColumnDropdownOpen = false;
    const existing = document.querySelector("[data-tooltip-add-dropdown]");
    if (existing) existing.remove();
  };

  /** Re-render pinned tooltip when column settings change in another instance */
  const handleColumnsChanged = () => {
    tooltipStructureDirty = true;
    cachedRows.clear();
    if (isPinned && chartInstance && lastIdx != null) {
      updateTooltipContent(chartInstance, lastIdx);
    }
  };

  function init(u: uPlot) {
    chartInstance = u;
    overEl = u.over;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "uplot-tooltip";
    tooltipEl.dataset.testid = "uplot-tooltip";
    tooltipEl.setAttribute("data-tooltip", "true");
    tooltipEl.style.cssText = `
      position: fixed;
      display: none;
      pointer-events: none;
      z-index: 9999;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      background: ${theme === "dark" ? "#161619" : "#fff"};
      border: 1px solid ${theme === "dark" ? "#333" : "#e0e0e0"};
      border-radius: 4px;
      padding: 4px;
      max-width: 340px;
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
      tooltipEl.setAttribute("data-pinned", "true");
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
      if (!tooltipEl || !chartInstance) return;
      isPinned = true;
      tooltipStructureDirty = true;
      cachedRows.clear();
      syncHoverState();
      applyPinnedStyle();
      // Rebuild content with pinned UI (search input, settings button)
      if (lastIdx != null) {
        savedPinnedLeft = tooltipEl.style.left;
        savedPinnedTop = tooltipEl.style.top;
        updateTooltipContent(chartInstance, lastIdx);
        tooltipEl.style.left = savedPinnedLeft;
        tooltipEl.style.top = savedPinnedTop;
      }
      log("tooltip pinned");
    };

    /** Unpin the tooltip and restore normal following behavior */
    const unpinTooltip = () => {
      if (!tooltipEl) return;
      tooltipEl.removeAttribute("data-pinned");
      isPinned = false;
      tooltipStructureDirty = true;
      cachedRows.clear();
      lastUnpinTime = Date.now();
      // Reset UI state but preserve search query (filter stays active when unpinned)
      if (searchInputRef) {
        searchInputRef.focused = false;
        searchInputRef.cursorPos = 0;
      }
      closeAddDropdown();
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
        tooltipEl.style.maxWidth = "340px";
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
    document.addEventListener("tooltip-columns-changed", handleColumnsChanged);

    // Store cleanup function on the element for later removal
    (overEl as HTMLElement & { _tooltipCleanup?: () => void })._tooltipCleanup = () => {
      overEl?.removeEventListener("mouseenter", handleMouseEnter);
      overEl?.removeEventListener("mouseleave", handleMouseLeave);
      overEl?.removeEventListener("click", handleOverClick);
      overEl?.removeEventListener("dblclick", handleOverDblClick);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("tooltip-columns-changed", handleColumnsChanged);
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

    // Format x value — show exact step for non-datetime axes, human-readable time for relative time
    const isRelTime = xlabel === "relative time";
    const xFormatted = isDateTime
      ? smartDateFormatter(xVal, timeRange)
      : isRelTime
        ? formatRelativeTimeValue(xVal)
        : formatStepValue(xVal);

    // Gather series values
    const textColor = theme === "dark" ? "#fff" : "#000";
    const seriesItems: { name: string; value: number; color: string; hidden: boolean; rawValue?: number; isInterpolated: boolean; flagText?: string; rawFlagText?: string; dash?: number[]; runName?: string; runId?: string; metricName?: string; nonFiniteFlags?: Set<"NaN" | "Inf" | "-Inf"> }[] = [];

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
          runName: lineData?.runName,
          runId: lineData?.runId,
          metricName: lineData?.metricName,
        });
        continue;
      }

      // Handle all-non-finite buckets (bucketed data path): value is null but
      // nonFiniteMarkers has flags — show descriptive flag text instead of "0"
      if (yVal == null && lineData?.nonFiniteMarkers) {
        const bucketFlags = lineData.nonFiniteMarkers.get(xAtIdx);
        if (bucketFlags && bucketFlags.size > 0) {
          const parts: string[] = [];
          if (bucketFlags.has("NaN")) parts.push("NaN");
          if (bucketFlags.has("Inf")) parts.push("+Inf");
          if (bucketFlags.has("-Inf")) parts.push("-Inf");
          const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
          const seriesColor = lineData.color || `hsl(${((i - 1) * 137) % 360}, 70%, 50%)`;
          seriesItems.push({
            name: labelText,
            value: 0,
            color: seriesColor,
            hidden: lineData.hideFromLegend || false,
            isInterpolated: false,
            flagText: parts.join(", "),
            dash: lineData.dash,
            runName: lineData.runName,
            runId: lineData.runId,
            metricName: lineData.metricName,
          });
          continue;
        }
      }

      // If value is null and interpolation is enabled, try to interpolate.
      // When spanGaps is false (skip missing values), don't interpolate across
      // large data gaps — only interpolate small alignment gaps where a series
      // logged at slightly different steps than the shared x-axis.
      if (yVal == null && tooltipInterpolation !== "none") {
        // When spanGaps is false (skip missing values), don't interpolate
        // across large data gaps — only across small alignment mismatches.
        const yData = u.data[i] as (number | null | undefined)[];
        if (!spanGaps && isInsideDataGap(yData, idx)) {
          // Inside a real data gap — skip interpolation
        } else {
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
      }

      if (yVal != null) {
        // Handle label which can be string or HTMLElement
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        // Get color from lineData (series.stroke is a function, not a string)
        const seriesColor = lineData?.color || `hsl(${((i - 1) * 137) % 360}, 70%, 50%)`;
        // Check for non-finite markers in this bucket (bucketed data path)
        const bucketFlags = lineData?.nonFiniteMarkers?.get(xAtIdx);
        // For mixed buckets (finite average + non-finite values), show the
        // dominant flag as prominent text so it's immediately obvious.
        let bucketFlagText: string | undefined;
        if (bucketFlags && bucketFlags.size > 0) {
          if (bucketFlags.has("NaN")) bucketFlagText = "NaN";
          else if (bucketFlags.has("Inf")) bucketFlagText = "+Inf";
          else if (bucketFlags.has("-Inf")) bucketFlagText = "-Inf";
        }
        seriesItems.push({
          name: labelText,
          value: yVal,
          color: seriesColor,
          hidden: lineData?.hideFromLegend || false,
          rawValue: rawValues.get(labelText),
          isInterpolated,
          flagText: bucketFlagText,
          rawFlagText: rawFlags.get(labelText),
          dash: lineData?.dash,
          runName: lineData?.runName,
          runId: lineData?.runId,
          metricName: lineData?.metricName,
          nonFiniteFlags: bucketFlags,
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

    // Get current column configuration
    const columns = getTooltipColumns();

    // Apply search filter if active
    const searchQuery = searchInputRef?.value?.toLowerCase() ?? "";
    const filteredItems = searchQuery
      ? visibleItems.filter((s) =>
          s.name.toLowerCase().includes(searchQuery) ||
          (s.runName && s.runName.toLowerCase().includes(searchQuery)) ||
          (s.runId && s.runId.toLowerCase().includes(searchQuery)) ||
          (s.metricName && s.metricName.toLowerCase().includes(searchQuery))
        )
      : visibleItems;

    // Clear content container only — close button lives on tooltipEl outside this container
    // Also remove any body-appended dropdown from previous render
    closeAddDropdown();
    isRebuilding = true;
    contentContainer.textContent = "";

    // Create header using safe DOM APIs (prevents XSS)
    // Header doubles as drag handle when pinned
    const header = document.createElement("div");
    header.setAttribute("data-tooltip-header", "true");
    header.style.cssText = `font-weight: bold; color: ${textColor}; padding: 3px 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px; font-size: 12px; cursor: ${isPinned ? "grab" : "default"}; user-select: none`;

    // First row: step/time label + series count + settings button
    const topRow = document.createElement("div");
    topRow.style.cssText = `display: flex; align-items: center; gap: 8px${isPinned ? "; padding-right: 18px" : ""}`;

    const xLabel = document.createElement("span");
    const xAxisLabel = isDateTime
      ? xFormatted
      : isRelTime
        ? xFormatted
        : xlabel && xlabel !== "step"
          ? `${xlabel} ${xFormatted}`
          : `Step ${xFormatted}`;
    xLabel.textContent = xAxisLabel;
    cachedHeaderLabel = xLabel;
    topRow.appendChild(xLabel);

    const countLabel = document.createElement("span");
    countLabel.style.cssText = "opacity: 0.6; font-weight: normal; font-size: 10px; flex-shrink: 0";
    countLabel.textContent = searchQuery
      ? `${filteredItems.length}/${visibleItems.length} series`
      : `${visibleItems.length} series`;
    cachedCountLabel = countLabel;
    topRow.appendChild(countLabel);

    header.appendChild(topRow);

    // Second row: chart title and/or subtitle (chip/pattern names)
    const infoText = [title, subtitle].filter(Boolean).join(" · ");
    if (infoText) {
      const infoRow = document.createElement("div");
      infoRow.style.cssText = `font-weight: normal; font-size: 10px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`;
      infoRow.textContent = infoText;
      header.appendChild(infoRow);
    }

    contentContainer.appendChild(header);

    // Search input (pinned only, but filter persists when unpinned)
    if (isPinned) {
      const searchRow = document.createElement("div");
      searchRow.style.cssText = `padding: 2px 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px`;
      const searchInput = document.createElement("input");
      searchInput.setAttribute("data-tooltip-search", "true");
      searchInput.type = "text";
      searchInput.placeholder = "Search series...";
      searchInput.value = searchInputRef?.value ?? "";
      searchInput.style.cssText = `width: 100%; box-sizing: border-box; font-size: 10px; font-family: inherit; padding: 3px 6px; border: 1px solid ${theme === "dark" ? "#444" : "#ddd"}; border-radius: 3px; background: ${theme === "dark" ? "#222" : "#f5f5f5"}; color: ${textColor}; outline: none`;
      searchInput.addEventListener("input", () => {
        if (searchInputRef) {
          searchInputRef.value = searchInput.value;
          searchInputRef.focused = true;
          searchInputRef.cursorPos = searchInput.selectionStart ?? searchInput.value.length;
        }
        if (tooltipEl) {
          savedPinnedLeft = tooltipEl.style.left;
          savedPinnedTop = tooltipEl.style.top;
        }
        // Search changes visible rows — need full rebuild
        tooltipStructureDirty = true;
        cachedRows.clear();
        if (lastIdx != null) {
          updateTooltipContent(u, lastIdx);
          if (tooltipEl) {
            tooltipEl.style.left = savedPinnedLeft;
            tooltipEl.style.top = savedPinnedTop;
          }
        }
      });
      searchInput.addEventListener("mousedown", (e) => e.stopPropagation());
      searchInput.addEventListener("click", (e) => e.stopPropagation());
      searchInput.addEventListener("keydown", (e) => e.stopPropagation());
      searchRow.appendChild(searchInput);
      contentContainer.appendChild(searchRow);

      if (searchInputRef?.focused) {
        requestAnimationFrame(() => {
          searchInput.focus();
          const pos = searchInputRef?.cursorPos ?? searchInput.value.length;
          searchInput.setSelectionRange(pos, pos);
        });
      }
    } else if (searchQuery) {
      // When unpinned but a search filter is active, show a compact indicator
      const filterRow = document.createElement("div");
      filterRow.style.cssText = `padding: 2px 4px; font-size: 9px; color: ${textColor}; opacity: 0.6; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 1px; display: flex; align-items: center; gap: 4px`;
      filterRow.textContent = `\u{1F50D} "${searchInputRef?.value}" — ${filteredItems.length}/${visibleItems.length}`;
      contentContainer.appendChild(filterRow);
    }

    // Neptune-style column header row with resize handles and +Add (when pinned)
    const enabledColumns = columns.filter((c) => c.enabled);
    const disabledColumns = columns.filter((c) => !c.enabled);
    const gridTemplate = buildGridTemplate(enabledColumns);

    // Wrapper holds the grid header + the +Add button in a flex row
    const columnHeaderWrapper = document.createElement("div");
    columnHeaderWrapper.setAttribute("data-tooltip-column-headers", "true");
    columnHeaderWrapper.style.cssText = `display: flex; align-items: center; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 1px`;

    // Grid row for column labels (matches data row grid)
    const columnHeaderRow = document.createElement("div");
    columnHeaderRow.style.cssText = `flex: 1; min-width: 0; padding: 2px 4px; display: grid; grid-template-columns: ${gridTemplate}; align-items: center; gap: 6px; white-space: nowrap`;

    // Color indicator spacer (matches data row's 16px first column)
    const indicatorSpacer = document.createElement("span");
    columnHeaderRow.appendChild(indicatorSpacer);

    for (let ci = 0; ci < enabledColumns.length; ci++) {
      const col = enabledColumns[ci];
      // Each header cell is a container with label, optional ×, and optional resize handle
      const isLastCol = ci === enabledColumns.length - 1;
      const dividerStyle = isLastCol ? "" : `; border-right: 1px solid ${theme === "dark" ? "#333" : "#ddd"}; padding-right: 4px`;
      const cellWrapper = document.createElement("span");
      cellWrapper.style.cssText = `display: inline-flex; align-items: center; gap: 2px; position: relative; overflow: hidden${dividerStyle}`;

      // Drag grip icon (pinned only, when >1 enabled column)
      if (isPinned && enabledColumns.length > 1) {
        const grip = document.createElement("span");
        grip.textContent = "\u2261"; // ≡ hamburger icon
        grip.style.cssText = `color: ${textColor}; opacity: 0.25; font-size: 10px; cursor: grab; flex-shrink: 0; line-height: 1`;
        grip.addEventListener("mouseenter", () => { grip.style.opacity = "0.7"; });
        grip.addEventListener("mouseleave", () => { grip.style.opacity = "0.25"; });
        cellWrapper.appendChild(grip);
      }

      const labelSpan = document.createElement("span");
      labelSpan.textContent = col.label;
      labelSpan.style.cssText = `color: ${textColor}; opacity: 0.6; font-size: 9px; font-weight: 600; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis`;
      cellWrapper.appendChild(labelSpan);

      // "x" remove button — only when pinned and more than 1 column enabled
      if (isPinned && enabledColumns.length > 1) {
        const removeBtn = document.createElement("button");
        removeBtn.style.cssText = `border: none; background: transparent; color: ${theme === "dark" ? "#666" : "#999"}; cursor: pointer; font-size: 10px; padding: 0; line-height: 1; flex-shrink: 0; opacity: 0.5`;
        removeBtn.textContent = "\u00d7";
        removeBtn.title = `Remove ${col.label}`;
        removeBtn.addEventListener("mouseenter", () => { removeBtn.style.opacity = "1"; });
        removeBtn.addEventListener("mouseleave", () => { removeBtn.style.opacity = "0.5"; });
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const updated = getTooltipColumns().map((c) =>
            c.id === col.id ? { ...c, enabled: false } : c,
          );
          saveTooltipColumns(updated);
          if (tooltipEl) {
            savedPinnedLeft = tooltipEl.style.left;
            savedPinnedTop = tooltipEl.style.top;
          }
          if (lastIdx != null) {
            updateTooltipContent(u, lastIdx);
            if (tooltipEl) {
              tooltipEl.style.left = savedPinnedLeft;
              tooltipEl.style.top = savedPinnedTop;
            }
          }
        });
        removeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        cellWrapper.appendChild(removeBtn);
      }

      // Drag-to-reorder (pinned only, when >1 column)
      if (isPinned && enabledColumns.length > 1) {
        cellWrapper.draggable = true;
        cellWrapper.dataset.colId = col.id;
        cellWrapper.style.cursor = "grab";
        cellWrapper.addEventListener("dragstart", (e) => {
          e.dataTransfer!.effectAllowed = "move";
          e.dataTransfer!.setData("text/plain", col.id);
          cellWrapper.style.opacity = "0.4";
        });
        cellWrapper.addEventListener("dragend", () => {
          cellWrapper.style.opacity = "1";
          // Clear all drop indicators
          for (const child of columnHeaderRow.children) {
            (child as HTMLElement).style.borderLeft = "";
            (child as HTMLElement).style.borderRight = "";
          }
        });
        cellWrapper.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer!.dropEffect = "move";
          // Show drop indicator
          const rect = cellWrapper.getBoundingClientRect();
          const mid = rect.left + rect.width / 2;
          cellWrapper.style.borderLeft = e.clientX < mid ? `2px solid ${theme === "dark" ? "#5b9bf0" : "#3b82f6"}` : "";
          cellWrapper.style.borderRight = e.clientX >= mid ? `2px solid ${theme === "dark" ? "#5b9bf0" : "#3b82f6"}` : "";
        });
        cellWrapper.addEventListener("dragleave", () => {
          cellWrapper.style.borderLeft = "";
          cellWrapper.style.borderRight = "";
        });
        cellWrapper.addEventListener("drop", (e) => {
          e.preventDefault();
          cellWrapper.style.borderLeft = "";
          cellWrapper.style.borderRight = "";
          const draggedId = e.dataTransfer!.getData("text/plain") as TooltipColumnId;
          if (draggedId === col.id) return;
          // Determine drop position (before or after this cell)
          const rect = cellWrapper.getBoundingClientRect();
          const dropAfter = e.clientX >= rect.left + rect.width / 2;
          // Reorder in full columns array
          const allCols = [...getTooltipColumns()];
          const dragIdx = allCols.findIndex((c) => c.id === draggedId);
          const targetIdx = allCols.findIndex((c) => c.id === col.id);
          if (dragIdx < 0 || targetIdx < 0) return;
          const [dragged] = allCols.splice(dragIdx, 1);
          const insertIdx = allCols.findIndex((c) => c.id === col.id);
          allCols.splice(dropAfter ? insertIdx + 1 : insertIdx, 0, dragged);
          saveTooltipColumns(allCols);
          if (tooltipEl) {
            savedPinnedLeft = tooltipEl.style.left;
            savedPinnedTop = tooltipEl.style.top;
          }
          if (lastIdx != null) {
            updateTooltipContent(u, lastIdx);
            if (tooltipEl) {
              tooltipEl.style.left = savedPinnedLeft;
              tooltipEl.style.top = savedPinnedTop;
            }
          }
        });
      }

      // Resize handle on the right edge of each column (pinned only)
      if (isPinned) {
        const resizeHandle = document.createElement("div");
        resizeHandle.style.cssText = `position: absolute; right: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 1`;
        // Visual indicator on hover
        resizeHandle.addEventListener("mouseenter", () => {
          resizeHandle.style.background = theme === "dark" ? "rgba(91,155,240,0.4)" : "rgba(59,130,246,0.3)";
        });
        resizeHandle.addEventListener("mouseleave", () => {
          if (!resizeHandle.dataset.dragging) resizeHandle.style.background = "";
        });

        const colId = col.id;
        resizeHandle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          resizeHandle.dataset.dragging = "true";
          resizeHandle.style.background = theme === "dark" ? "rgba(91,155,240,0.6)" : "rgba(59,130,246,0.5)";
          const startX = e.clientX;
          const startWidth = getColWidth(colId);

          const onMouseMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const newWidth = Math.max(30, startWidth + delta);
            saveColWidth(colId, newWidth);
            // Live-update all grid rows in this tooltip
            const newTemplate = buildGridTemplate(enabledColumns);
            columnHeaderRow.style.gridTemplateColumns = newTemplate;
            const contentEl = contentContainer?.querySelector("[data-tooltip-content]");
            if (contentEl) {
              for (const child of contentEl.children) {
                (child as HTMLElement).style.gridTemplateColumns = newTemplate;
              }
            }
          };

          const onMouseUp = () => {
            delete resizeHandle.dataset.dragging;
            resizeHandle.style.background = "";
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
          };

          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        });

        cellWrapper.appendChild(resizeHandle);
      }

      columnHeaderRow.appendChild(cellWrapper);
    }

    columnHeaderWrapper.appendChild(columnHeaderRow);

    // "+Add" button (pinned only, when there are disabled columns to add)
    if (isPinned && disabledColumns.length > 0) {
      const addBtn = document.createElement("button");
      addBtn.setAttribute("data-tooltip-add-col", "true");
      addBtn.style.cssText = `border: 1px solid ${theme === "dark" ? "#444" : "#ddd"}; background: transparent; color: ${theme === "dark" ? "#888" : "#666"}; cursor: pointer; font-size: 9px; padding: 2px 6px; line-height: 1; border-radius: 3px; flex-shrink: 0; white-space: nowrap`;
      addBtn.textContent = "+ Add";
      addBtn.addEventListener("mouseenter", () => {
        addBtn.style.borderColor = theme === "dark" ? "#666" : "#bbb";
        addBtn.style.color = theme === "dark" ? "#fff" : "#000";
      });
      addBtn.addEventListener("mouseleave", () => {
        addBtn.style.borderColor = theme === "dark" ? "#444" : "#ddd";
        addBtn.style.color = theme === "dark" ? "#888" : "#666";
      });
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Toggle dropdown (lives on document.body)
        const existingDropdown = document.querySelector("[data-tooltip-add-dropdown]");
        if (existingDropdown) {
          existingDropdown.remove();
          addColumnDropdownOpen = false;
          return;
        }
        addColumnDropdownOpen = true;
        const dropdown = document.createElement("div");
        dropdown.setAttribute("data-tooltip-add-dropdown", "true");
        dropdown.setAttribute("data-tooltip-settings", "true");
        dropdown.style.cssText = `position: absolute; z-index: 10000; background: ${theme === "dark" ? "#1e1e22" : "#fff"}; border: 1px solid ${theme === "dark" ? "#444" : "#ddd"}; border-radius: 4px; padding: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 120px`;

        for (const col of disabledColumns) {
          const item = document.createElement("div");
          item.style.cssText = `padding: 4px 8px; font-size: 10px; color: ${textColor}; cursor: pointer; border-radius: 2px; white-space: nowrap`;
          item.textContent = `+ ${col.label}`;
          item.addEventListener("mouseenter", () => {
            item.style.background = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)";
          });
          item.addEventListener("mouseleave", () => {
            item.style.background = "";
          });
          item.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const updated = getTooltipColumns().map((c) =>
              c.id === col.id ? { ...c, enabled: true } : c,
            );
            saveTooltipColumns(updated);
            addColumnDropdownOpen = false;
            if (tooltipEl) {
              savedPinnedLeft = tooltipEl.style.left;
              savedPinnedTop = tooltipEl.style.top;
            }
            if (lastIdx != null) {
              updateTooltipContent(u, lastIdx);
              if (tooltipEl) {
                tooltipEl.style.left = savedPinnedLeft;
                tooltipEl.style.top = savedPinnedTop;
              }
            }
          });
          item.addEventListener("mousedown", (ev) => ev.stopPropagation());
          dropdown.appendChild(item);
        }

        // Position dropdown below the +Add button using fixed positioning on body
        // (avoids clipping from tooltip overflow: auto)
        const btnRect = addBtn.getBoundingClientRect();
        dropdown.style.position = "fixed";
        dropdown.style.left = `${btnRect.left}px`;
        dropdown.style.top = `${btnRect.bottom + 2}px`;

        // Close dropdown on click outside
        const closeDropdown = (ev: MouseEvent) => {
          if (!dropdown.contains(ev.target as Node) && ev.target !== addBtn) {
            dropdown.remove();
            addColumnDropdownOpen = false;
            document.removeEventListener("mousedown", closeDropdown, true);
          }
        };
        document.addEventListener("mousedown", closeDropdown, true);

        document.body.appendChild(dropdown);
      });
      addBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      columnHeaderWrapper.appendChild(addBtn);
    }

    contentContainer.appendChild(columnHeaderWrapper);

    // Create scrollable content area for all series
    const content = document.createElement("div");
    content.setAttribute("data-tooltip-content", "true");
    content.style.cssText = "overflow-y: auto; scrollbar-width: thin";
    cachedRowContainer = content;

    // Determine column span indices for caching (child 0 = color indicator, then enabled columns)
    const valueColIdx = enabledColumns.findIndex((c) => c.id === "value");
    const nameColIdx = enabledColumns.findIndex((c) => c.id === "name");
    const runNameColIdx = enabledColumns.findIndex((c) => c.id === "run-name");
    const runIdColIdx = enabledColumns.findIndex((c) => c.id === "run-id");
    const metricColIdx = enabledColumns.findIndex((c) => c.id === "metric");

    // Clear row cache before rebuilding
    cachedRows.clear();

    // Add ALL rows using safe DOM APIs - scrolling handles overflow
    for (const s of filteredItems) {
      const isHighlighted = highlightedName !== null && s.name === highlightedName;
      const row = createTooltipRow({
        name: s.name,
        value: s.value,
        color: s.color,
        isHighlighted,
        rawValue: s.rawValue,
        isInterpolated: s.isInterpolated,
        flagText: s.flagText,
        rawFlagText: s.rawFlagText,
        dash: s.dash,
        runName: s.runName,
        runId: s.runId,
        metricName: s.metricName,
        nonFiniteFlags: s.nonFiniteFlags,
      }, textColor, columns, theme);

      // Cache row element and key spans for incremental updates
      // Row children: [color indicator (index 0), ...enabled columns (index 1+)]
      const cacheEntry: {
        row: HTMLDivElement;
        valueSpan: HTMLSpanElement;
        nameSpan?: HTMLSpanElement;
        runNameSpan?: HTMLSpanElement;
        runIdSpan?: HTMLSpanElement;
        metricSpan?: HTMLSpanElement;
      } = {
        row,
        // valueSpan is always present (value column is always enabled by default)
        valueSpan: (valueColIdx >= 0 ? row.children[valueColIdx + 1] : row.children[1]) as HTMLSpanElement,
      };
      if (nameColIdx >= 0) cacheEntry.nameSpan = row.children[nameColIdx + 1] as HTMLSpanElement;
      if (runNameColIdx >= 0) cacheEntry.runNameSpan = row.children[runNameColIdx + 1] as HTMLSpanElement;
      if (runIdColIdx >= 0) cacheEntry.runIdSpan = row.children[runIdColIdx + 1] as HTMLSpanElement;
      if (metricColIdx >= 0) cacheEntry.metricSpan = row.children[metricColIdx + 1] as HTMLSpanElement;
      cachedRows.set(s.name, cacheEntry);

      // Hover emphasis on tooltip rows (pinned only — unpinned has pointer-events: none)
      if (isPinned && onSeriesHover) {
        row.style.cursor = "pointer";
        row.addEventListener("mouseenter", () => {
          onSeriesHover(s.name, s.runId ?? null);
          row.style.background = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
        });
        row.addEventListener("mouseleave", () => {
          onSeriesHover(null, null);
          row.style.background = isHighlighted ? "rgba(255,255,255,0.05)" : "";
        });
      }

      content.appendChild(row);
    }

    contentContainer.appendChild(content);
    // Store column config fingerprint so we can detect changes
    cachedColumnConfig = JSON.stringify(columns);
    tooltipStructureDirty = false;
    lastRenderedIdx = idx;
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

  /** Fast-path: update only the values in cached tooltip rows without recreating DOM */
  function updateTooltipValues(u: uPlot, idx: number) {
    if (!tooltipEl || !contentContainer || !cachedRowContainer) return;
    if (idx === lastRenderedIdx) return;

    const xVal = u.data[0][idx];
    if (xVal == null) return;

    const textColor = theme === "dark" ? "#fff" : "#000";

    // Update header x-value label
    if (cachedHeaderLabel) {
      const isRelTime = xlabel === "relative time";
      const xFormatted = isDateTime
        ? smartDateFormatter(xVal, timeRange)
        : isRelTime
          ? formatRelativeTimeValue(xVal)
          : formatStepValue(xVal);
      const xAxisLabel = isDateTime
        ? xFormatted
        : isRelTime
          ? xFormatted
          : xlabel && xlabel !== "step"
            ? `${xlabel} ${xFormatted}`
            : `Step ${xFormatted}`;
      cachedHeaderLabel.textContent = xAxisLabel;
    }

    // Gather series values (same logic as updateTooltipContent)
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
    const highlightedName = highlightedSeriesRef?.current ?? null;
    const searchQuery = searchInputRef?.value?.toLowerCase() ?? "";

    // Track which cached rows got updated (to hide stale ones and count visible)
    const updatedKeys = new Set<string>();
    // Collect items for sorting
    const sortItems: { name: string; value: number; isHighlighted: boolean }[] = [];

    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      if (series.show === false) continue;

      let yVal = u.data[i][idx] as number | null | undefined;
      let isInterpolated = false;

      const lineData = lines[i - 1];
      const xAtIdx = xValues[idx];
      const flag = lineData?.valueFlags?.get(xAtIdx);

      if (yVal == null && flag) {
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        const cached = cachedRows.get(labelText);
        if (cached) {
          // Update value span with flag text
          cached.valueSpan.textContent = "";
          formatValueContent(cached.valueSpan, {
            name: labelText,
            value: 0,
            color: lineData?.color || "",
            isHighlighted: highlightedName !== null && labelText === highlightedName,
            isInterpolated: false,
            flagText: flag,
            dash: lineData?.dash,
            runName: lineData?.runName,
            runId: lineData?.runId,
            metricName: lineData?.metricName,
          }, textColor);
          cached.row.style.display = "";
          updatedKeys.add(labelText);
          sortItems.push({ name: labelText, value: 0, isHighlighted: highlightedName !== null && labelText === highlightedName });
        }
        continue;
      }

      if (yVal == null && tooltipInterpolation !== "none") {
        const yData = u.data[i] as (number | null | undefined)[];
        if (!spanGaps && isInsideDataGap(yData, idx)) {
          // Inside a real data gap — skip interpolation
        } else {
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
      }

      if (yVal != null) {
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        if (lineData?.hideFromLegend) continue;

        // Apply search filter
        if (searchQuery) {
          const matchesSearch =
            labelText.toLowerCase().includes(searchQuery) ||
            (lineData?.runName && lineData.runName.toLowerCase().includes(searchQuery)) ||
            (lineData?.runId && lineData.runId.toLowerCase().includes(searchQuery)) ||
            (lineData?.metricName && lineData.metricName.toLowerCase().includes(searchQuery));
          if (!matchesSearch) continue;
        }

        const cached = cachedRows.get(labelText);
        if (cached) {
          const isHighlighted = highlightedName !== null && labelText === highlightedName;
          // Update only the value span content
          cached.valueSpan.textContent = "";
          formatValueContent(cached.valueSpan, {
            name: labelText,
            value: yVal,
            color: lineData?.color || "",
            isHighlighted,
            rawValue: rawValues.get(labelText),
            isInterpolated,
            rawFlagText: rawFlags.get(labelText),
            dash: lineData?.dash,
            runName: lineData?.runName,
            runId: lineData?.runId,
            metricName: lineData?.metricName,
          }, textColor);
          // Update highlight background
          cached.row.style.background = isHighlighted ? "rgba(255,255,255,0.05)" : "";
          cached.row.style.display = "";
          updatedKeys.add(labelText);
          sortItems.push({ name: labelText, value: yVal, isHighlighted });
        } else {
          // Series not in cache — need a full rebuild
          tooltipStructureDirty = true;
          cachedRows.clear();
          updateTooltipContent(u, idx);
          return;
        }
      }
    }

    // Hide rows that no longer have data at this index
    for (const [key, entry] of cachedRows) {
      if (!updatedKeys.has(key)) {
        entry.row.style.display = "none";
      }
    }

    // Sort rows: highlighted first, then by value descending
    // Use CSS order property to avoid DOM reflows from insertBefore
    sortItems.sort((a, b) => {
      if (highlightedName) {
        if (a.isHighlighted && !b.isHighlighted) return -1;
        if (b.isHighlighted && !a.isHighlighted) return 1;
      }
      return b.value - a.value;
    });
    for (let i = 0; i < sortItems.length; i++) {
      const cached = cachedRows.get(sortItems[i].name);
      if (cached) {
        cached.row.style.order = String(i);
      }
    }

    // Update count label
    if (cachedCountLabel) {
      const visibleCount = updatedKeys.size;
      const totalVisible = sortItems.length;
      cachedCountLabel.textContent = searchQuery
        ? `${totalVisible}/${visibleCount} series`
        : `${visibleCount} series`;
    }

    lastRenderedIdx = idx;

    // Reposition tooltip
    const tooltipWidth = tooltipEl.offsetWidth || 200;
    const cursorLeft = (u.cursor.left != null && u.cursor.left >= 0) ? u.cursor.left : (lastLeft ?? 0);
    const cursorTop = (u.cursor.top != null && u.cursor.top >= 0) ? u.cursor.top : (lastTop ?? 0);
    const chartRect = u.over.getBoundingClientRect();
    const viewportX = chartRect.left + cursorLeft;
    const viewportY = chartRect.top + cursorTop;
    const offsetX = 15;
    const offsetY = 10;
    const tooltipHeight = tooltipEl.offsetHeight || 100;
    let left = viewportX + offsetX;
    let top = viewportY - tooltipHeight - offsetY;
    if (left + tooltipWidth > window.innerWidth - 10) {
      left = viewportX - tooltipWidth - offsetX;
    }
    if (top < 10) {
      top = viewportY + offsetY;
    }
    left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
    top = Math.max(10, Math.min(top, window.innerHeight - tooltipHeight - 10));
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  /** Schedule a tooltip update, using rAF coalescing for the fast path */
  function scheduleTooltipUpdate(u: uPlot, idx: number) {
    // Check if column config changed since last build
    const currentColumnConfig = JSON.stringify(getTooltipColumns());
    if (cachedColumnConfig !== currentColumnConfig) {
      tooltipStructureDirty = true;
      cachedRows.clear();
    }

    if (tooltipStructureDirty) {
      // Structure changes need immediate render (they're infrequent)
      updateTooltipContent(u, idx);
      return;
    }
    // Coalesce rapid cursor moves into one update per frame
    pendingIdx = idx;
    if (tooltipRafId === null) {
      tooltipRafId = requestAnimationFrame(() => {
        tooltipRafId = null;
        if (pendingIdx !== null) {
          updateTooltipValues(u, pendingIdx);
        }
      });
    }
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
      // Only rebuild tooltip DOM when cursor moves to a different data point.
      // Rebuilding on every setCursor call (even same index) destroys row DOM
      // elements, breaking mouseenter/mouseleave handlers for hover emphasis
      // and stealing focus from the search input.
      if (syncIdx != null && syncIdx !== lastIdx && tooltipEl) {
        lastIdx = syncIdx;
        syncHoverState();
        savedPinnedLeft = tooltipEl.style.left;
        savedPinnedTop = tooltipEl.style.top;
        // Capture search input state before DOM rebuild (only needed for full rebuilds)
        if (tooltipStructureDirty) {
          const activeSearch = tooltipEl.querySelector<HTMLInputElement>("[data-tooltip-search]");
          if (activeSearch && searchInputRef) {
            searchInputRef.value = activeSearch.value;
            searchInputRef.focused = document.activeElement === activeSearch;
            searchInputRef.cursorPos = activeSearch.selectionStart ?? activeSearch.value.length;
          }
        }
        scheduleTooltipUpdate(u, syncIdx);
        // Restore pinned position (updateTooltipContent repositions based on cursor)
        tooltipEl.style.left = savedPinnedLeft;
        tooltipEl.style.top = savedPinnedTop;
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

    // Phase 2: same-index guard — cursor didn't move to a new data point
    if (displayIdx === lastRenderedIdx && !tooltipStructureDirty) return;

    scheduleTooltipUpdate(u, displayIdx);
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

        // Remove any body-appended dropdown
        closeAddDropdown();

        // Remove tooltip element
        if (tooltipEl && tooltipEl.parentNode) {
          tooltipEl.parentNode.removeChild(tooltipEl);
        }

        if (safetyEntry) {
          unregisterSafetyEntry(safetyEntry);
          safetyEntry = null;
        }

        // Cleanup incremental tooltip update state
        if (tooltipRafId !== null) {
          cancelAnimationFrame(tooltipRafId);
          tooltipRafId = null;
        }
        cachedRows.clear();
        cachedHeaderLabel = null;
        cachedCountLabel = null;
        cachedRowContainer = null;
        lastRenderedIdx = null;
        pendingIdx = null;
        tooltipStructureDirty = true;

        chartInstance = null;
      },
    },
  };
}
