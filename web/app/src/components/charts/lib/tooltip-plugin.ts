import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { formatAbsoluteTimeTooltip, formatAxisLabel, formatRelativeTimeValue, formatStepValue } from "./format";
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
  "metric": 160,
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
  isHovering: () => boolean;
  hide: () => void;
}
const tooltipSafetyEntries = new Set<TooltipSafetyEntry>();

function sharedMouseMoveHandler(e: MouseEvent) {
  for (const entry of tooltipSafetyEntries) {
    if (entry.isPinned()) continue;
    if (entry.tooltipEl.style.display === "none") continue;
    // Skip if mouseenter has already set isHovering — the tooltip plugin's own
    // mouseenter/mouseleave handlers are authoritative. This safety net should
    // only catch cases where mouseleave was missed, not override active hover.
    if (entry.isHovering()) continue;
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
    // Width handled by fit-content
    el.style.height = cachedTooltipSize.height;
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

const ICON_STYLE = "margin-left: 3px; font-size: 10px; opacity: 0.85";

/** Append non-finite marker icons (△ ▽ ⊗) after the value text */
function appendNonFiniteIcons(
  parent: HTMLSpanElement,
  flags: Set<"NaN" | "Inf" | "-Inf">,
) {
  if (flags.has("Inf")) {
    const icon = document.createElement("span");
    icon.style.cssText = ICON_STYLE;
    icon.title = "+Infinity in this range";
    icon.textContent = "\u25b3"; // △
    parent.appendChild(icon);
  }
  if (flags.has("-Inf")) {
    const icon = document.createElement("span");
    icon.style.cssText = ICON_STYLE;
    icon.title = "-Infinity in this range";
    icon.textContent = "\u25bd"; // ▽
    parent.appendChild(icon);
  }
  if (flags.has("NaN")) {
    const icon = document.createElement("span");
    icon.style.cssText = ICON_STYLE;
    icon.title = "NaN in this range";
    icon.textContent = "\u2297"; // ⊗
    parent.appendChild(icon);
  }
}

/** Helper to format a value span with proper styling for flags/interpolation.
 *  IMPORTANT: Uses individual style properties instead of cssText to preserve
 *  grid-item overflow/divider styles set by createTooltipRow. */
function formatValueContent(
  valueSpan: HTMLSpanElement,
  data: TooltipRowData,
  textColor: string,
) {
  if (data.flagText) {
    valueSpan.style.color = "#e8a838";
    valueSpan.style.fontWeight = "600";
    valueSpan.style.fontStyle = "italic";
    valueSpan.style.opacity = "";
    valueSpan.textContent = data.flagText;
  } else if (data.rawFlagText) {
    valueSpan.style.color = textColor;
    valueSpan.style.fontWeight = "500";
    valueSpan.style.fontStyle = "";
    valueSpan.style.opacity = "";
    const smoothedText = document.createTextNode(`${formatAxisLabel(data.value)} (`);
    valueSpan.appendChild(smoothedText);
    const flagSpan = document.createElement("span");
    flagSpan.style.cssText = "color: #e8a838; font-style: italic";
    flagSpan.textContent = data.rawFlagText;
    valueSpan.appendChild(flagSpan);
    valueSpan.appendChild(document.createTextNode(")"));
  } else {
    valueSpan.style.color = textColor;
    valueSpan.style.fontWeight = "500";
    valueSpan.style.fontStyle = data.isInterpolated ? "italic" : "";
    valueSpan.style.opacity = data.isInterpolated ? "0.6" : "";
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
  row.style.cssText = `padding: 2px 4px; display: grid; grid-template-columns: ${buildGridTemplate(enabledColumns)}; align-items: center; gap: 6px; white-space: nowrap${data.isHighlighted ? "; background: rgba(59, 130, 246, 0.15); border-radius: 3px" : ""}`;

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
        nameSpan.style.cssText = `color: ${data.isHighlighted ? "#fff" : textColor}; min-width: 0; overflow: hidden; text-overflow: ellipsis${data.isHighlighted ? "; font-weight: 600" : ""}${divider}`;
        nameSpan.textContent = data.name;
        row.appendChild(nameSpan);
        break;
      }
      case "value": {
        const valueSpan = document.createElement("span");
        valueSpan.style.cssText = `min-width: 0; overflow: hidden; text-overflow: ellipsis${divider}`;
        formatValueContent(valueSpan, data, textColor);
        row.appendChild(valueSpan);
        break;
      }
      case "run-name": {
        const span = document.createElement("span");
        span.style.cssText = `color: ${textColor}; min-width: 0; overflow: hidden; text-overflow: ellipsis; opacity: 0.8${divider}`;
        span.textContent = data.runName ?? "";
        row.appendChild(span);
        break;
      }
      case "run-id": {
        const span = document.createElement("span");
        span.style.cssText = `color: ${textColor}; min-width: 0; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; font-size: 10px${divider}`;
        span.textContent = data.runId ?? "";
        row.appendChild(span);
        break;
      }
      case "metric": {
        const span = document.createElement("span");
        span.style.cssText = `color: ${textColor}; min-width: 0; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; font-size: 10px${divider}`;
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
  /** Ref to get currently highlighted run ID (for tooltip row matching) */
  highlightedRunIdRef?: { current: string | null };
  /** Ref to get currently highlighted series ID (for exact series matching in multi-metric) */
  highlightedSeriesIdRef?: { current: string | null };
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
  /** Callback when user hovers over a series row in the pinned tooltip.
   *  seriesIdx is the uPlot series index — use it directly instead of searching by label. */
  onSeriesHover?: (seriesLabel: string | null, runId: string | null, seriesIdx?: number) => void;
  /** Shared tooltip element from ChartSyncProvider (single instance for all charts) */
  sharedTooltipEl?: HTMLDivElement | null;
  /** Shared tooltip content container */
  sharedContentContainer?: HTMLDivElement | null;
  /** This chart's unique ID (for tracking which chart owns the tooltip) */
  chartId?: string;
  /** Ref tracking which chart currently owns the shared tooltip */
  activeTooltipChartRef?: { current: string | null };
  /** Move shared tooltip into a container (for fullscreen dialogs) */
  reparentTooltip?: (container: HTMLElement | null) => void;
}

export function tooltipPlugin(opts: TooltipPluginOpts): uPlot.Plugin {
  const { theme, isDateTime, lines, hoverStateRef, onHoverChange, isActiveChart, highlightedSeriesRef, highlightedRunIdRef, highlightedSeriesIdRef, tooltipInterpolation = "none", spanGaps = true, xlabel, title, subtitle, onSeriesHover, sharedTooltipEl, sharedContentContainer, chartId: pluginChartId, activeTooltipChartRef, reparentTooltip } = opts;
  const isSharedMode = !!sharedTooltipEl;

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
  // In shared mode, pin state lives on the shared tooltip element so all chart
  // instances see the same value. We use a property wrapper so all existing
  // `isPinned` reads/writes go through the shared state transparently.
  let _isPinnedLocal = hoverStateRef?.current.isPinned ?? false;
  const _pinState = {
    get isPinned(): boolean {
      if (isSharedMode && sharedTooltipEl) return !!(sharedTooltipEl as any)._isPinned;
      return _isPinnedLocal;
    },
    set isPinned(val: boolean) {
      _isPinnedLocal = val;
      if (isSharedMode && sharedTooltipEl) {
        (sharedTooltipEl as any)._isPinned = val;
        (sharedTooltipEl as any)._pinnedChartId = val ? pluginChartId : null;
        (sharedTooltipEl as any)._pinnedChartInstance = val ? null : undefined; // set in pinTooltip
      }
    },
    /** Which chartId owns the pin (shared mode only) */
    get pinnedChartId(): string | null {
      if (isSharedMode && sharedTooltipEl) return (sharedTooltipEl as any)._pinnedChartId ?? null;
      return _isPinnedLocal ? (pluginChartId ?? null) : null;
    },
  };
  let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pinTimerId: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** Timestamp of last unpin — prevents click event from immediately re-pinning.
   *  In shared mode, stored on the element so all instances see it. */
  let _lastUnpinTimeLocal = 0;
  const getLastUnpinTime = (): number => {
    if (isSharedMode && sharedTooltipEl) return (sharedTooltipEl as any)._lastUnpinTime ?? 0;
    return _lastUnpinTimeLocal;
  };
  const setLastUnpinTime = (t: number) => {
    _lastUnpinTimeLocal = t;
    if (isSharedMode && sharedTooltipEl) (sharedTooltipEl as any)._lastUnpinTime = t;
  };
  /** True while updateTooltipContent is rebuilding DOM — suppresses ResizeObserver localStorage writes */
  let isRebuilding = false;
  /** Last cursor index for which tooltip content was built — skip rebuild when unchanged */
  let lastContentIdx: number | null = null;
  /** Last highlighted series name when content was built — invalidate on highlight change */
  let lastContentHighlight: string | null = null;
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
    lastValueKey?: string;
    lastHighlight?: boolean;
    lastOrder?: number;
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
  /** Cached tooltip dimensions — avoids forced reflow on every cursor move */
  let cachedTipW = 200;
  let cachedTipH = 100;
  let cachedMaxH = 0;
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
  /** Saved series visibility before "Hide all" so "Show all" can restore it */
  let preHideAllState: boolean[] | null = null;
  /** Drag state for pinned tooltip */
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;
  /** Stored uPlot instance for event-driven re-renders */
  let chartInstance: uPlot | null = null;

  const handleDragMouseDown = (e: MouseEvent) => {
    if (!tooltipEl || !_pinState.isPinned) return;
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
      hoverStateRef.current = { isHovering, isPinned: _pinState.isPinned, lastIdx, lastLeft, lastTop };
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
    if (_pinState.isPinned && chartInstance && lastIdx != null) {
      updateTooltipContent(chartInstance, lastIdx);
    }
  };

  function init(u: uPlot) {
    chartInstance = u;
    overEl = u.over;

    if (isSharedMode && sharedTooltipEl && sharedContentContainer) {
      // Shared mode: reuse the single tooltip element from ChartSyncProvider.
      tooltipEl = sharedTooltipEl;
      contentContainer = sharedContentContainer;
      applySavedSize(tooltipEl);
      // Safety: ensure the shared element is in the DOM
      if (!tooltipEl.parentNode) {
        document.body.appendChild(tooltipEl);
      }
    } else {
      // Legacy mode: create own tooltip element (fallback when no context)
      tooltipEl = document.createElement("div");
      tooltipEl.className = "uplot-tooltip";
      tooltipEl.dataset.testid = "uplot-tooltip";
      tooltipEl.setAttribute("data-tooltip", "true");
      tooltipEl.style.cssText = `
        position: fixed;
        display: none;
        pointer-events: none;
        z-index: 9999;
        left: -9999px;
        top: -9999px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: ${theme === "dark" ? "#161619" : "#fff"};
        border: 1px solid ${theme === "dark" ? "#333" : "#e0e0e0"};
        border-radius: 4px;
        padding: 4px;
        width: fit-content;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      `;
      applySavedSize(tooltipEl);
      contentContainer = document.createElement("div");
      contentContainer.style.cssText = "display: flex; flex-direction: column; height: 100%; overflow: hidden";
      tooltipEl.appendChild(contentContainer);
      const dialogContent = overEl.closest("[data-slot='dialog-content']");
      (dialogContent || document.body).appendChild(tooltipEl);
    }

    // Following uPlot's official tooltips.html demo pattern EXACTLY:
    // mouseenter -> show tooltip (cancel any pending hide)
    // mouseleave -> hide tooltip (with small debounce to prevent spurious hides)
    // setCursor -> just update content, never control visibility
    const handleMouseEnter = () => {
      log(`mouseenter - was isHovering=${isHovering}, hideTimeoutId=${hideTimeoutId !== null}`);
      // Cancel any pending hide — in shared mode, the hide timer is stored on the
      // tooltip element so cross-chart mouseenter (different plugin instance) can cancel it.
      if (isSharedMode && tooltipEl) {
        const sharedTimer = (tooltipEl as any)._hideTimer as ReturnType<typeof setTimeout> | null;
        if (sharedTimer) {
          clearTimeout(sharedTimer);
          (tooltipEl as any)._hideTimer = null;
        }
      }
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
      // In shared mode, skip the pinned-global check since there's only one tooltip
      const suppressForPin = isSharedMode ? _pinState.isPinned : isAnyTooltipPinnedGlobal();
      if (tooltipEl && !suppressForPin) {
        // In shared mode, don't show if content is empty (e.g. after a chart
        // was destroyed and a new chart scrolled under the cursor). The next
        // setCursor will populate content and then show the tooltip.
        if (isSharedMode && contentContainer && !contentContainer.hasChildNodes()) {
          tooltipStructureDirty = true;
        } else {
          tooltipEl.style.display = "block";
        }
        log("  set display=block");
      }
    };

    const handleMouseLeave = () => {
      log(`mouseleave - isHovering=${isHovering}, _pinState.isPinned=${_pinState.isPinned}, pendingHide=${hideTimeoutId !== null}`);
      // When tooltip is pinned, keep it visible on mouseleave
      if (_pinState.isPinned) return;
      // Small debounce to prevent spurious mouseleave events from hiding tooltip
      if (hideTimeoutId !== null) {
        clearTimeout(hideTimeoutId);
      }
      const hideCallback = () => {
        log("  hide timeout fired - hiding tooltip");
        isHovering = false;
        lastIdx = null;
        lastContentIdx = null;
        lastContentHighlight = null;
        lastLeft = null;
        lastTop = null;
        syncHoverState();
        onHoverChange?.(false);
        if (tooltipEl) {
          tooltipEl.style.display = "none";
        }
        hideTimeoutId = null;
        if (isSharedMode && tooltipEl) (tooltipEl as any)._hideTimer = null;
      };
      hideTimeoutId = setTimeout(hideCallback, 50);
      // In shared mode, also store on the element so other instances can cancel it
      if (isSharedMode && tooltipEl) {
        (tooltipEl as any)._hideTimer = hideTimeoutId;
      }
    };

    overEl.addEventListener("mouseenter", handleMouseEnter);
    overEl.addEventListener("mouseleave", handleMouseLeave);

    // Safety net: shared module-level mousemove listener hides tooltip when mouse is
    // outside chart bounds. Uses a single document listener for all chart instances.
    // In shared mode, skip registering — only one tooltip exists and it's managed
    // by the active chart's mouseenter/mouseleave. Multiple safety entries for the
    // same element would cause the non-hovered charts to hide the active tooltip.
    if (isSharedMode) {
      safetyEntry = null;
    } else {
    safetyEntry = {
      overEl: overEl!,
      tooltipEl,
      isPinned: () => _pinState.isPinned,
      isHovering: () => isHovering,
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
    } // end else (non-shared mode)

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
      tooltipEl.style.overflow = "hidden";
      tooltipEl.style.cursor = "default";

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
          if (!_pinState.isPinned || isRebuilding) return;
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
          unpinTooltip(/* forceHide */ true);
        });
        tooltipEl.style.position = "fixed"; // keep fixed positioning
        tooltipEl.appendChild(closeBtn);
      }
    };

    /** Pin the tooltip at its current position */
    const pinTooltip = () => {
      if (!tooltipEl || !chartInstance) return;
      _pinState.isPinned = true;
      tooltipStructureDirty = true;
      cachedRows.clear();
      syncHoverState();
      // If inside a fullscreen dialog, move tooltip into the dialog so Radix's
      // focus scope allows the search input to receive keystrokes.
      // unpinTooltip() moves it back to body.
      if (isSharedMode && overEl) {
        const dialogContent = overEl.closest("[data-slot='dialog-content']");
        if (dialogContent && tooltipEl.parentElement !== dialogContent) {
          dialogContent.appendChild(tooltipEl);
        }
      }
      // Store pinned chart reference so destroy() can clean up if chart unmounts
      if (isSharedMode && sharedTooltipEl) {
        (sharedTooltipEl as any)._pinnedChartInstance = chartInstance;
      }
      applyPinnedStyle();
      // Ensure tooltip is visible (it may have been hidden by a prior mouseleave)
      tooltipEl.style.display = "block";
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
    const unpinTooltip = (forceHide = false) => {
      if (!tooltipEl) return;
      tooltipEl.removeAttribute("data-pinned");
      // Move tooltip back to body if it was reparented into a fullscreen dialog
      if (isSharedMode && tooltipEl.parentElement !== document.body) {
        document.body.appendChild(tooltipEl);
      }
      _pinState.isPinned = false;
      tooltipStructureDirty = true;
      cachedRows.clear();
      setLastUnpinTime(Date.now());
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
      // Apply saved size (keeps the pinned dimensions) or let content determine size
      if (cachedTooltipSize) {
        applySavedSize(tooltipEl);
      } else {
        tooltipEl.style.width = "";
        tooltipEl.style.height = "";
        tooltipEl.style.overflow = "";
      }
      // Remove close button
      const closeBtn = tooltipEl.querySelector("[data-tooltip-close]");
      if (closeBtn) {
        closeBtn.remove();
      }
      // Check if mouse is actually over a chart right now.
      // isHovering may be stale because handleMouseLeave returned early while pinned.
      // In shared mode, check all chart overlays (the user may have moved to a different chart).
      // When forceHide is set (e.g. a click hit something outside both the tooltip
      // AND any chart — like a menu/dialog trigger), skip the heuristic and hide
      // unconditionally. This avoids the bug where a Radix portal backdrop blocks
      // the :hover pseudo-class check and leaves the tooltip visible.
      let mouseOverAnyChart = false;
      if (!forceHide) {
        mouseOverAnyChart = overEl ? overEl.matches(":hover") : false;
        if (!mouseOverAnyChart && isSharedMode) {
          mouseOverAnyChart = !!document.querySelector(".u-over:hover");
        }
      }
      if (forceHide || !mouseOverAnyChart) {
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
      if (_pinState.isPinned) {
        unpinTooltip();
        return;
      }
      // Skip if we just unpinned — the mousedown handler may have unpinned,
      // and this click event from the same interaction would immediately re-pin
      if (Date.now() - getLastUnpinTime() < 300) return;
      // If tooltip isn't visible or has no content, don't pin
      if (!tooltipEl || tooltipEl.style.display === "none" || lastIdx == null) return;
      // Start a 200ms timer; if dblclick fires before, we cancel
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

    // Escape key unpins — explicit user dismissal, always hide.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && _pinState.isPinned) {
        unpinTooltip(/* forceHide */ true);
      }
    };

    // Click outside pinned tooltip unpins.
    // If the click also landed outside any chart overlay (e.g. on a toolbar
    // button or menu trigger that opens a dialog/popover), force-hide the
    // tooltip — the :hover heuristic in unpinTooltip can mis-fire when a
    // Radix portal backdrop covers the chart, leaving the tooltip stuck.
    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (!_pinState.isPinned || !tooltipEl) return;
      const target = e.target as Node;
      if (tooltipEl.contains(target)) return;
      const targetEl = target as HTMLElement | null;
      const clickedChart = !!targetEl && !!targetEl.closest?.(".u-over");
      unpinTooltip(/* forceHide */ !clickedChart);
    };

    overEl!.addEventListener("click", handleOverClick);
    overEl!.addEventListener("dblclick", handleOverDblClick);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("tooltip-columns-changed", handleColumnsChanged);

    // Expose a lightweight callback for cross-chart highlight refresh.
    // Called directly by highlightUPlotSeries (in chart-sync-context) inside its
    // rAF, so _crossHighlightRunId is already set when this runs.
    // Calls updateTooltipValues directly (not via scheduleTooltipUpdate) to avoid
    // rAF coalescing skipping the update when only the highlight changed.
    (u as any)._refreshTooltipHighlight = () => {
      if (!_pinState.isPinned || _pinState.pinnedChartId !== pluginChartId) return;
      if (!chartInstance || lastIdx == null || !cachedRowContainer) return;
      // Force the fast-path to re-evaluate by clearing the cached highlight
      lastContentHighlight = null;
      updateTooltipValues(chartInstance, lastIdx);
    };

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
      // If a mouseleave hide timer is pending, run it synchronously now so
      // isHovering=false gets persisted to hoverStateRef. Otherwise the next
      // chart recreation would see stale isHovering=true and re-show the
      // tooltip at the old cursor position. Don't run if the tooltip is
      // pinned — pinned state should survive recreation.
      if (hideTimeoutId !== null) {
        clearTimeout(hideTimeoutId);
        hideTimeoutId = null;
        if (!_pinState.isPinned) {
          isHovering = false;
          lastIdx = null;
          lastContentIdx = null;
          lastContentHighlight = null;
          lastLeft = null;
          lastTop = null;
          syncHoverState();
          if (tooltipEl && !isAnyTooltipPinnedGlobal()) {
            tooltipEl.style.display = "none";
          }
        }
      }
      if (pinTimerId !== null) {
        clearTimeout(pinTimerId);
        pinTimerId = null;
      }
    };

    // CRITICAL: Check if we were hovering before chart recreation
    // This handles the case where chart is recreated while mouse is stationary over it
    // The external hoverStateRef preserves the hover state AND cursor position.
    //
    // But only restore if a pointer is actually over a chart right now. Otherwise
    // we'd re-show a tooltip that the user thought was long gone — e.g. they
    // hovered, mouse-left, then clicked "Edit Dashboard" while the mouseleave
    // hide timer was still pending (cleanup now flushes that, but keep this as
    // a defensive net in case another path leaves stale state). Pinned tooltips
    // always restore (their whole purpose is to survive recreation).
    if (isHovering && tooltipEl && lastIdx != null) {
      const pointerOverAnyChart =
        !!document.querySelector(".u-over:hover") ||
        (overEl ? overEl.matches(":hover") : false);
      const shouldRestore = _pinState.isPinned || pointerOverAnyChart;
      if (!shouldRestore) {
        log(`init: skipping hover restore — pointer not over any chart`);
        isHovering = false;
        lastIdx = null;
        lastContentIdx = null;
        lastContentHighlight = null;
        lastLeft = null;
        lastTop = null;
        syncHoverState();
        if (tooltipEl && !isAnyTooltipPinnedGlobal()) {
          tooltipEl.style.display = "none";
        }
      } else {
        log(`init: restoring hover state - idx=${lastIdx}, left=${lastLeft}, top=${lastTop}, _pinState.isPinned=${_pinState.isPinned}`);
        tooltipEl.style.display = "block";
        // Immediately update tooltip content with restored state
        // Use requestAnimationFrame to ensure uPlot is fully initialized
        requestAnimationFrame(() => {
          if (lastIdx != null) {
            updateTooltipContent(u, lastIdx);
          }
          // Re-apply pinned style after chart recreation (border, resize, close button)
          if (_pinState.isPinned) {
            applyPinnedStyle();
          }
        });
      }
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
      ? formatAbsoluteTimeTooltip(xVal)
      : isRelTime
        ? formatRelativeTimeValue(xVal)
        : formatStepValue(xVal);

    // Gather series values
    const textColor = theme === "dark" ? "#fff" : "#000";
    const seriesItems: { name: string; value: number; color: string; hidden: boolean; seriesHidden: boolean; seriesIdx: number; rawValue?: number; isInterpolated: boolean; flagText?: string; rawFlagText?: string; dash?: number[]; runName?: string; runId?: string; sqid?: string; seriesId?: string; metricName?: string; nonFiniteFlags?: Set<"NaN" | "Inf" | "-Inf"> }[] = [];

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
      const isSeriesHidden = series.show === false;

      let yVal = isSeriesHidden ? null : u.data[i][idx] as number | null | undefined;
      let isInterpolated = false;

      // Check for non-finite value flag (NaN/Inf/-Inf) before interpolation
      const lineData = lines[i - 1];
      const xAtIdx = xValues[idx];
      const flag = isSeriesHidden ? undefined : lineData?.valueFlags?.get(xAtIdx);

      if (yVal == null && flag) {
        // This is a known non-finite value — show flag text instead of interpolating
        const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;
        const seriesColor = lineData?.color || `hsl(${((i - 1) * 137) % 360}, 70%, 50%)`;
        seriesItems.push({
          name: labelText,
          value: 0,
          color: seriesColor,
          hidden: lineData?.hideFromLegend || false,
          seriesHidden: isSeriesHidden,
          seriesIdx: i,
          isInterpolated: false,
          flagText: flag,
          dash: lineData?.dash,
          runName: lineData?.runName,
          runId: lineData?.runId,
          sqid: lineData?.seriesId?.split(':')[0],
          seriesId: lineData?.seriesId,
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
            seriesHidden: isSeriesHidden,
            seriesIdx: i,
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
          seriesHidden: isSeriesHidden,
          seriesIdx: i,
          rawValue: rawValues.get(labelText),
          isInterpolated,
          flagText: bucketFlagText,
          rawFlagText: rawFlags.get(labelText),
          dash: lineData?.dash,
          runName: lineData?.runName,
          runId: lineData?.runId,
          sqid: lineData?.seriesId?.split(':')[0],
          seriesId: lineData?.seriesId,
          metricName: lineData?.metricName,
          nonFiniteFlags: bucketFlags,
        });
      }
    }

    // Get highlighted series/run IDs for tooltip row matching.
    // In shared mode, prefer cross-chart highlight from the uPlot instance.
    const crossRunIdFull = isSharedMode ? ((u as any)._crossHighlightRunId as string | null ?? null) : null;
    const highlightedRunId = crossRunIdFull ?? (highlightedRunIdRef?.current ?? null);
    const highlightedSId = crossRunIdFull ?? (highlightedSeriesIdRef?.current ?? null);
    // Sort: visible series first (highlighted → value desc), hidden series at bottom
    seriesItems.sort((a, b) => {
      // Hidden-from-chart series always sort to the bottom
      if (a.seriesHidden !== b.seriesHidden) return a.seriesHidden ? 1 : -1;
      if (highlightedSId) {
        const aExact = a.seriesId === highlightedSId;
        const bExact = b.seriesId === highlightedSId;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
      }
      if (highlightedRunId) {
        const aRun = a.sqid === highlightedRunId;
        const bRun = b.sqid === highlightedRunId;
        if (aRun && !bRun) return -1;
        if (bRun && !aRun) return 1;
      }
      return b.value - a.value;
    });

    // Filter out hideFromLegend series (smoothing originals etc), keep seriesHidden ones
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
    header.style.cssText = `font-weight: bold; color: ${textColor}; padding: 3px 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px; font-size: 12px; cursor: ${_pinState.isPinned ? "grab" : "default"}; user-select: none; flex-shrink: 0`;

    // First row: step/time label + series count + settings button
    const topRow = document.createElement("div");
    topRow.style.cssText = `display: flex; align-items: center; gap: 8px${_pinState.isPinned ? "; padding-right: 18px" : ""}`;

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
    let shownCount = 0;
    let hiddenCount = 0;
    for (const s of visibleItems) { if (s.seriesHidden) hiddenCount++; else shownCount++; }
    countLabel.textContent = searchQuery
      ? `${filteredItems.length}/${visibleItems.length} series`
      : hiddenCount > 0
        ? `${shownCount}/${shownCount + hiddenCount} series`
        : `${shownCount} series`;
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

    // Search input and Hide all button
    // Shown in both pinned and unpinned for visual consistency.
    // In unpinned mode, pointer-events:none on tooltip prevents interaction.
    {
      const searchRow = document.createElement("div");
      searchRow.style.cssText = `padding: 2px 4px; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 2px; display: flex; align-items: center; gap: 4px; flex-shrink: 0`;
      const searchInput = document.createElement("input");
      searchInput.setAttribute("data-tooltip-search", "true");
      searchInput.type = "text";
      searchInput.placeholder = "Search series...";
      searchInput.value = searchInputRef?.value ?? "";
      searchInput.style.cssText = `flex: 1; min-width: 0; box-sizing: border-box; font-size: 10px; font-family: inherit; padding: 3px 6px; border: 1px solid ${theme === "dark" ? "#444" : "#ddd"}; border-radius: 3px; background: ${theme === "dark" ? "#222" : "#f5f5f5"}; color: ${textColor}; outline: none`;
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
        // Search changes visible rows — filter incrementally via row visibility
        if (lastIdx != null && cachedRows.size > 0) {
          const query = searchInput.value.toLowerCase();
          let visibleCount = 0;
          for (const [, entry] of cachedRows) {
            const matchesSearch = !query ||
              (entry.nameSpan?.textContent?.toLowerCase().includes(query)) ||
              (entry.runNameSpan?.textContent?.toLowerCase().includes(query)) ||
              (entry.runIdSpan?.textContent?.toLowerCase().includes(query)) ||
              (entry.metricSpan?.textContent?.toLowerCase().includes(query));
            entry.row.style.display = matchesSearch ? "grid" : "none";
            if (matchesSearch) visibleCount++;
          }
          if (cachedCountLabel) {
            cachedCountLabel.textContent = query
              ? `${visibleCount}/${cachedRows.size} series`
              : `${visibleCount} series`;
          }
        }
      });
      searchInput.addEventListener("mousedown", (e) => e.stopPropagation());
      searchInput.addEventListener("click", (e) => e.stopPropagation());
      searchInput.addEventListener("keydown", (e) => e.stopPropagation());
      searchRow.appendChild(searchInput);

      // "Hide all" / "Show all" toggle button
      const allVisible = u.series.slice(1).some((s) => s.show !== false);
      const toggleBtn = document.createElement("button");
      toggleBtn.textContent = allVisible ? "Hide all" : "Show all";
      toggleBtn.title = allVisible ? "Hide all series" : "Show all series";
      toggleBtn.style.cssText = `flex-shrink: 0; font-size: 9px; font-family: inherit; padding: 2px 6px; border: 1px solid ${theme === "dark" ? "#444" : "#ddd"}; border-radius: 3px; background: ${theme === "dark" ? "#333" : "#eee"}; color: ${textColor}; cursor: pointer; white-space: nowrap`;
      toggleBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const anyVisible = u.series.slice(1).some((s) => s.show !== false);
        u.batch(() => {
          if (anyVisible) {
            // "Hide all" — save current state first so "Show all" can restore it
            preHideAllState = u.series.map((s) => s.show !== false);
            for (let i = 1; i < u.series.length; i++) {
              u.setSeries(i, { show: false }, false);
            }
          } else if (preHideAllState) {
            // "Show all" — restore the pre-Hide-All state
            for (let i = 1; i < u.series.length; i++) {
              u.setSeries(i, { show: preHideAllState[i] ?? true }, false);
            }
            preHideAllState = null;
          } else {
            // No saved state — just show everything
            for (let i = 1; i < u.series.length; i++) {
              u.setSeries(i, { show: true }, false);
            }
          }
        });
        // Rebuild tooltip to reflect new state
        tooltipStructureDirty = true;
        cachedRows.clear();
        if (lastIdx != null) {
          if (tooltipEl) {
            savedPinnedLeft = tooltipEl.style.left;
            savedPinnedTop = tooltipEl.style.top;
          }
          updateTooltipContent(u, lastIdx);
          if (tooltipEl) {
            tooltipEl.style.left = savedPinnedLeft;
            tooltipEl.style.top = savedPinnedTop;
          }
        }
      });
      searchRow.appendChild(toggleBtn);

      contentContainer.appendChild(searchRow);

      if (searchInputRef?.focused) {
        requestAnimationFrame(() => {
          searchInput.focus();
          const pos = searchInputRef?.cursorPos ?? searchInput.value.length;
          searchInput.setSelectionRange(pos, pos);
        });
      }
    }

    // Neptune-style column header row with resize handles and +Add (when pinned)
    const enabledColumns = columns.filter((c) => c.enabled);
    const disabledColumns = columns.filter((c) => !c.enabled);
    const gridTemplate = buildGridTemplate(enabledColumns);

    // Wrapper holds the grid header + the +Add button in a flex row
    const columnHeaderWrapper = document.createElement("div");
    columnHeaderWrapper.setAttribute("data-tooltip-column-headers", "true");
    columnHeaderWrapper.style.cssText = `display: flex; align-items: center; border-bottom: 1px solid ${theme === "dark" ? "#333" : "#eee"}; margin-bottom: 1px; flex-shrink: 0`;

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

      const labelSpan = document.createElement("span");
      labelSpan.textContent = col.label;
      labelSpan.style.cssText = `color: ${textColor}; opacity: 0.6; font-size: 9px; font-weight: 600; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis`;
      cellWrapper.appendChild(labelSpan);

      // Drag-to-reorder (pinned only, when >1 column)
      if (_pinState.isPinned && enabledColumns.length > 1) {
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
      if (_pinState.isPinned) {
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

    contentContainer.appendChild(columnHeaderWrapper);

    // Create scrollable content area for all series
    const content = document.createElement("div");
    content.setAttribute("data-tooltip-content", "true");
    content.style.cssText = "overflow-y: auto; scrollbar-width: thin; display: flex; flex-direction: column; flex: 1; min-height: 0";
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
    let addedSeparator = false;
    for (const s of filteredItems) {
      const isHighlighted = highlightedSId !== null && s.seriesId === highlightedSId;

      // Add a subtle separator before the first hidden series
      if (s.seriesHidden && !addedSeparator && _pinState.isPinned) {
        addedSeparator = true;
        const sep = document.createElement("div");
        sep.style.cssText = `border-top: 1px dashed ${theme === "dark" ? "#444" : "#ccc"}; margin: 4px 4px 2px; opacity: 0.5`;
        content.appendChild(sep);
      }

      const row = createTooltipRow({
        name: s.name,
        value: s.value,
        color: s.seriesHidden ? (theme === "dark" ? "#555" : "#bbb") : s.color,
        isHighlighted: isHighlighted && !s.seriesHidden,
        rawValue: s.rawValue,
        isInterpolated: s.isInterpolated,
        flagText: s.seriesHidden ? "hidden" : s.flagText,
        rawFlagText: s.rawFlagText,
        dash: s.dash,
        runName: s.runName,
        runId: s.runId,
        metricName: s.metricName,
        nonFiniteFlags: s.nonFiniteFlags,
      }, textColor, columns, theme);

      // Grey out hidden series
      if (s.seriesHidden) {
        row.style.opacity = "0.4";
      }

      // Cache row element and key spans for incremental updates
      // Row children: [color indicator (index 0), ...enabled columns (index 1+)]
      const cacheEntry: {
        row: HTMLDivElement;
        valueSpan: HTMLSpanElement;
        nameSpan?: HTMLSpanElement;
        runNameSpan?: HTMLSpanElement;
        runIdSpan?: HTMLSpanElement;
        metricSpan?: HTMLSpanElement;
        lastValueKey?: string; // cached key to skip redundant DOM writes
        lastHighlight?: boolean;
        lastOrder?: number;
      } = {
        row,
        // valueSpan is always present (value column is always enabled by default)
        valueSpan: (valueColIdx >= 0 ? row.children[valueColIdx + 1] : row.children[1]) as HTMLSpanElement,
      };
      if (nameColIdx >= 0) cacheEntry.nameSpan = row.children[nameColIdx + 1] as HTMLSpanElement;
      if (runNameColIdx >= 0) cacheEntry.runNameSpan = row.children[runNameColIdx + 1] as HTMLSpanElement;
      if (runIdColIdx >= 0) cacheEntry.runIdSpan = row.children[runIdColIdx + 1] as HTMLSpanElement;
      if (metricColIdx >= 0) cacheEntry.metricSpan = row.children[metricColIdx + 1] as HTMLSpanElement;
      cachedRows.set(String(s.seriesIdx), cacheEntry);
      // Set initial CSS order for flex-based sorting in fast path
      row.style.order = String(filteredItems.indexOf(s));

      // Hover emphasis and click-to-toggle on tooltip rows (pinned only)
      if (_pinState.isPinned) {
        row.style.cursor = "pointer";
        if (onSeriesHover && !s.seriesHidden) {
          row.addEventListener("mouseenter", () => {
            onSeriesHover(s.name, s.runId ?? null, s.seriesIdx);
            row.style.background = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
          });
          row.addEventListener("mouseleave", () => {
            onSeriesHover(null, null, undefined);
            // Read current highlight state (not stale closure)
            const curHighlight = highlightedSeriesIdRef?.current === s.seriesId;
            row.style.background = curHighlight ? "rgba(59, 130, 246, 0.15)" : "";
          });
        } else if (s.seriesHidden) {
          row.addEventListener("mouseenter", () => {
            row.style.opacity = "0.7";
          });
          row.addEventListener("mouseleave", () => {
            row.style.opacity = "0.4";
          });
        }

        // Click toggles series visibility — full rebuild to get correct event listeners
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const currentlyShown = u.series[s.seriesIdx].show !== false;
          u.setSeries(s.seriesIdx, { show: !currentlyShown }, false);
          u.redraw();
          // Full rebuild so toggled row gets correct hover/click handlers
          tooltipStructureDirty = true;
          cachedRows.clear();
          if (lastIdx != null) {
            if (tooltipEl) {
              savedPinnedLeft = tooltipEl.style.left;
              savedPinnedTop = tooltipEl.style.top;
            }
            updateTooltipContent(u, lastIdx);
            if (tooltipEl) {
              tooltipEl.style.left = savedPinnedLeft;
              tooltipEl.style.top = savedPinnedTop;
            }
          }
        });
      }

      content.appendChild(row);
    }

    contentContainer.appendChild(content);
    // Store column config fingerprint so we can detect changes
    cachedColumnConfig = JSON.stringify(columns);
    tooltipStructureDirty = false;
    lastRenderedIdx = idx;
    lastContentHighlight = highlightedSId;
    isRebuilding = false;

    // Apply latest saved size from shared cache (picks up resizes from other pinned tooltips)
    applySavedSize(tooltipEl);

    // Re-measure dimensions after full rebuild (the only time we read layout)
    cachedTipW = tooltipEl.offsetWidth || 200;
    cachedTipH = tooltipEl.offsetHeight || 100;
    // Reset cached maxHeight so repositionTooltip re-applies it to the new content element
    cachedMaxH = 0;
    // Reposition tooltip (skip when pinned — caller handles position restoration)
    if (!_pinState.isPinned) {
      repositionTooltip(u);
    }
    // In shared mode, ensure tooltip is visible after successful content build.
    // mouseenter may have deferred display when content was empty.
    if (isSharedMode && isHovering && !_pinState.isPinned && tooltipEl.style.display === "none") {
      tooltipEl.style.display = "block";
    }
  }

  /**
   * Reposition the tooltip element to follow the cursor without rebuilding content.
   * Extracted so setCursor can reposition cheaply when cursor idx hasn't changed.
   */
  function repositionTooltip(u: uPlot) {
    if (!tooltipEl) return;

    // Use cached dimensions — avoids forced reflow on every cursor move.
    // Dimensions are re-measured after full rebuilds via measureTooltipSize().
    const tooltipWidth = cachedTipW;

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

    // Set content max-height only when viewport size changes (avoids write→read thrashing)
    const maxContentHeight = window.innerHeight - 48;
    if (maxContentHeight > 0 && maxContentHeight !== cachedMaxH) {
      cachedMaxH = maxContentHeight;
      const contentEl = tooltipEl.querySelector<HTMLElement>("[data-tooltip-content]");
      if (contentEl) {
        contentEl.style.maxHeight = `${maxContentHeight}px`;
      }
    }

    const tooltipHeight = cachedTipH;

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

    // In shared mode, read cross-chart highlight directly from the uPlot instance.
    // Both updateTooltipValues and highlightUPlotSeries run inside rAF, so the
    // value is always current — no extra events or listeners needed.
    const crossRunId = isSharedMode ? ((u as any)._crossHighlightRunId as string | null ?? null) : null;
    const highlightedSId = crossRunId ?? (highlightedSeriesIdRef?.current ?? null);
    const highlightedRunId = crossRunId ?? (highlightedRunIdRef?.current ?? null);

    // Skip if nothing changed (same index AND same highlight)
    if (idx === lastRenderedIdx && highlightedSId === lastContentHighlight) return;

    const xVal = u.data[0][idx];
    if (xVal == null) return;

    const textColor = theme === "dark" ? "#fff" : "#000";

    // Update header x-value label
    if (cachedHeaderLabel) {
      const isRelTime = xlabel === "relative time";
      const xFormatted = isDateTime
        ? formatAbsoluteTimeTooltip(xVal)
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
    const searchQuery = searchInputRef?.value?.toLowerCase() ?? "";

    // Track which cached rows got updated (to hide stale ones and count visible)
    const updatedKeys = new Set<string>();
    // Collect items for sorting — matches full-rebuild sort fields
    const sortItems: { name: string; idx: number; value: number; isHighlighted: boolean; seriesHidden: boolean; seriesId?: string; sqid?: string }[] = [];

    for (let i = 1; i < u.series.length; i++) {
      const series = u.series[i];
      const isSeriesHidden = series.show === false;
      const lineData = lines[i - 1];

      // Skip series with no line data (bands, envelopes) and hideFromLegend (smoothing originals)
      if (!lineData || lineData.hideFromLegend) continue;

      const labelText = typeof series.label === "string" ? series.label : `Series ${i}`;

      // Apply search filter — hide non-matching rows
      if (searchQuery) {
        const matchesSearch =
          labelText.toLowerCase().includes(searchQuery) ||
          (lineData?.runName && lineData.runName.toLowerCase().includes(searchQuery)) ||
          (lineData?.runId && lineData.runId.toLowerCase().includes(searchQuery)) ||
          (lineData?.metricName && lineData.metricName.toLowerCase().includes(searchQuery));
        if (!matchesSearch) {
          const cached = cachedRows.get(String(i));
          if (cached) cached.row.style.display = "none";
          continue;
        }
      }

      const cached = cachedRows.get(String(i));
      if (!cached) {
        // Series not in cache — need a full rebuild
        tooltipStructureDirty = true;
        cachedRows.clear();
        updateTooltipContent(u, idx);
        return;
      }

      // Match by exact seriesId first. Only fall back to runId prefix matching
      // for cross-chart highlights (crossRunId set) — otherwise multi-metric
      // charts highlight ALL series for a run instead of just the hovered one.
      const isHighlighted = !isSeriesHidden && highlightedSId !== null && (
        lineData?.seriesId === highlightedSId ||
        (crossRunId !== null && highlightedRunId !== null && lineData?.seriesId?.split(':')[0] === highlightedRunId)
      );
      const sqid = lineData?.seriesId?.split(':')[0];

      // Handle hidden series — show greyed out row with "hidden" text,
      // but only if the series has data at this step. Series that ended
      // before this step (null data) should not appear in the tooltip.
      if (isSeriesHidden && u.data[i][idx] != null) {
        const vk = "hidden";
        if (cached.lastValueKey !== vk) {
          cached.valueSpan.textContent = "";
          formatValueContent(cached.valueSpan, {
            name: labelText, value: 0, color: theme === "dark" ? "#555" : "#bbb",
            isHighlighted: false, isInterpolated: false, flagText: "hidden",
          }, textColor);
          cached.row.style.opacity = "0.4";
          cached.lastValueKey = vk;
        }
        cached.row.style.background = "";
        cached.row.style.display = "grid";
        updatedKeys.add(String(i));
        sortItems.push({ name: labelText, idx: i, value: 0, isHighlighted: false, seriesHidden: true, seriesId: lineData?.seriesId, sqid });
        continue;
      }

      // Reset opacity for visible series
      if (cached.lastValueKey === "hidden") cached.row.style.opacity = "";

      let yVal = u.data[i][idx] as number | null | undefined;
      let isInterpolated = false;
      const xAtIdx = xValues[idx];
      const flag = lineData?.valueFlags?.get(xAtIdx);

      // Non-finite value flag (NaN/Inf/-Inf)
      if (yVal == null && flag) {
        const vk = `flag:${flag}`;
        if (cached.lastValueKey !== vk) {
          cached.valueSpan.textContent = "";
          formatValueContent(cached.valueSpan, {
            name: labelText, value: 0, color: lineData?.color || "",
            isHighlighted, isInterpolated: false, flagText: flag,
            dash: lineData?.dash, runName: lineData?.runName, runId: lineData?.runId, metricName: lineData?.metricName,
          }, textColor);
          cached.row.style.background = isHighlighted ? "rgba(59, 130, 246, 0.15)" : "";
          cached.lastValueKey = vk;
          cached.lastHighlight = isHighlighted;
        } else if (cached.lastHighlight !== isHighlighted) {
          cached.row.style.background = isHighlighted ? "rgba(59, 130, 246, 0.15)" : "";
          cached.lastHighlight = isHighlighted;
        }
        cached.row.style.display = "grid";
        updatedKeys.add(String(i));
        sortItems.push({ name: labelText, idx: i, value: 0, isHighlighted, seriesHidden: false, seriesId: lineData?.seriesId, sqid });
        continue;
      }

      // Non-finite bucket markers (bucketed data path)
      if (yVal == null && lineData?.nonFiniteMarkers) {
        const bucketFlags = lineData.nonFiniteMarkers.get(xAtIdx);
        if (bucketFlags && bucketFlags.size > 0) {
          const parts: string[] = [];
          if (bucketFlags.has("NaN")) parts.push("NaN");
          if (bucketFlags.has("Inf")) parts.push("+Inf");
          if (bucketFlags.has("-Inf")) parts.push("-Inf");
          const vk = `bucket:${parts.join(',')}`;
          if (cached.lastValueKey !== vk) {
            cached.valueSpan.textContent = "";
            formatValueContent(cached.valueSpan, {
              name: labelText, value: 0, color: lineData.color || "",
              isHighlighted, isInterpolated: false, flagText: parts.join(", "),
              dash: lineData.dash, runName: lineData.runName, runId: lineData.runId, metricName: lineData.metricName,
            }, textColor);
            cached.row.style.background = isHighlighted ? "rgba(59, 130, 246, 0.15)" : "";
            cached.lastValueKey = vk;
            cached.lastHighlight = isHighlighted;
          } else if (cached.lastHighlight !== isHighlighted) {
            cached.row.style.background = isHighlighted ? "rgba(59, 130, 246, 0.15)" : "";
            cached.lastHighlight = isHighlighted;
          }
          cached.row.style.display = "grid";
          updatedKeys.add(String(i));
          sortItems.push({ name: labelText, idx: i, value: 0, isHighlighted, seriesHidden: false, seriesId: lineData?.seriesId, sqid });
          continue;
        }
      }

      // Interpolation
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
        const bucketFlags = lineData?.nonFiniteMarkers?.get(xAtIdx);
        let bucketFlagText: string | undefined;
        if (bucketFlags && bucketFlags.size > 0) {
          if (bucketFlags.has("NaN")) bucketFlagText = "NaN";
          else if (bucketFlags.has("Inf")) bucketFlagText = "+Inf";
          else if (bucketFlags.has("-Inf")) bucketFlagText = "-Inf";
        }

        // Build a cache key to skip redundant DOM writes
        const rawVal = rawValues.get(labelText);
        const rawFlag = rawFlags.get(labelText);
        const vk = `${yVal}|${isInterpolated ? 1 : 0}|${bucketFlagText ?? ""}|${rawVal ?? ""}|${rawFlag ?? ""}`;
        if (cached.lastValueKey !== vk) {
          cached.valueSpan.textContent = "";
          formatValueContent(cached.valueSpan, {
            name: labelText, value: yVal, color: lineData?.color || "",
            isHighlighted, rawValue: rawVal,
            isInterpolated, rawFlagText: rawFlag,
            flagText: bucketFlagText,
            dash: lineData?.dash, runName: lineData?.runName, runId: lineData?.runId, metricName: lineData?.metricName,
            nonFiniteFlags: bucketFlags,
          }, textColor);
          cached.row.style.background = isHighlighted ? "rgba(59, 130, 246, 0.15)" : "";
          cached.lastValueKey = vk;
          cached.lastHighlight = isHighlighted;
        } else if (cached.lastHighlight !== isHighlighted) {
          cached.row.style.background = isHighlighted ? "rgba(59, 130, 246, 0.15)" : "";
          cached.lastHighlight = isHighlighted;
        }
        cached.row.style.display = "grid";
        updatedKeys.add(String(i));
        sortItems.push({ name: labelText, idx: i, value: yVal, isHighlighted, seriesHidden: false, seriesId: lineData?.seriesId, sqid });
      } else {
        // No value at this index — hide the row
        cached.row.style.display = "none";
      }
    }

    // Hide cached rows that weren't updated (series no longer present)
    for (const [key, entry] of cachedRows) {
      if (!updatedKeys.has(key)) {
        entry.row.style.display = "none";
      }
    }

    // Sort rows: matches full-rebuild sort logic (hidden → bottom, highlighted → top, then by value)
    sortItems.sort((a, b) => {
      if (a.seriesHidden !== b.seriesHidden) return a.seriesHidden ? 1 : -1;
      if (highlightedSId) {
        const aExact = a.seriesId === highlightedSId;
        const bExact = b.seriesId === highlightedSId;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
      }
      if (highlightedRunId) {
        const aRun = a.sqid === highlightedRunId;
        const bRun = b.sqid === highlightedRunId;
        if (aRun && !bRun) return -1;
        if (bRun && !aRun) return 1;
      }
      return b.value - a.value;
    });
    for (let i = 0; i < sortItems.length; i++) {
      const cached = cachedRows.get(String(sortItems[i].idx));
      if (cached && cached.lastOrder !== i) {
        cached.row.style.order = String(i);
        cached.lastOrder = i;
      }
    }

    // Update count label — match full-rebuild logic
    if (cachedCountLabel) {
      let shownCount = 0;
      let hiddenCount = 0;
      for (const s of sortItems) { if (s.seriesHidden) hiddenCount++; else shownCount++; }
      cachedCountLabel.textContent = searchQuery
        ? `${sortItems.length}/${updatedKeys.size} series`
        : hiddenCount > 0
          ? `${shownCount}/${shownCount + hiddenCount} series`
          : `${shownCount} series`;
    }

    lastRenderedIdx = idx;
    lastContentHighlight = highlightedSId;

    // Reposition tooltip (skip when pinned — position is locked)
    if (!_pinState.isPinned) {
      repositionTooltip(u);
    }
  }

  /** Track last highlighted series for dirty detection */
  let lastHighlightedSeriesId: string | null = null;

  /** Schedule a tooltip update, using rAF coalescing for the fast path */
  function scheduleTooltipUpdate(u: uPlot, idx: number) {
    // Check if column config changed since last build
    const currentColumnConfig = JSON.stringify(getTooltipColumns());
    if (cachedColumnConfig !== currentColumnConfig) {
      tooltipStructureDirty = true;
      cachedRows.clear();
    }

    // Track highlighted series — fast path handles highlight changes incrementally
    const currentHighlight = highlightedSeriesIdRef?.current ?? null;
    if (currentHighlight !== lastHighlightedSeriesId) {
      lastHighlightedSeriesId = currentHighlight;
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

  /** Track which chart last owned the shared tooltip for dirty detection */
  let lastActiveChartId: string | null = pluginChartId ?? null;

  function setCursor(u: uPlot) {
    if (!tooltipEl || !overEl) return;

    // ── Ultra-fast early return for non-active charts (shared mode) ──
    // In shared mode, only the active chart (or the pinned chart) processes setCursor.
    // This is the critical performance optimization: N-1 charts do a single
    // comparison and return, with zero DOM access or state checks.
    if (isSharedMode) {
      if (_pinState.isPinned) {
        // When pinned, only the chart that owns the pin should process
        if (_pinState.pinnedChartId !== pluginChartId) return;
      } else {
        // Don't process unless mouseenter has fired on this chart.
        // Prevents showing empty/stale tooltip when charts mount under a
        // stationary mouse (e.g. after scrolling) and receive cursor sync.
        if (!isHovering) return;
        const isActive = isActiveChart?.() ?? true;
        if (!isActive) return; // Zero work — no DOM access, no state mutation
      }
    }

    // Check if this chart is the one being directly hovered
    // This prevents synced charts from showing tooltips
    const isActive = isActiveChart?.() ?? true; // Default to true if no context

    // In shared mode, detect chart switch → force full rebuild
    if (isSharedMode && pluginChartId && !_pinState.isPinned) {
      if (activeTooltipChartRef && activeTooltipChartRef.current !== pluginChartId) {
        activeTooltipChartRef.current = pluginChartId;
        tooltipStructureDirty = true;
        cachedRows.clear();
        lastRenderedIdx = null;
      }
    }

    // For non-active (synced) charts, HIDE the tooltip (unless pinned)
    // This prevents multiple tooltips from appearing on different charts
    // With synchronous ref tracking in chart-sync-context, this is now safe
    if (!isActive && !_pinState.isPinned) {
      log(`setCursor - hiding tooltip (not active chart)`);
      tooltipEl.style.display = "none";
      return;
    }

    // If any other tooltip is pinned, suppress this chart's tooltip
    // This prevents a second tooltip from appearing when hovering after pinning
    if (!_pinState.isPinned && !isSharedMode && isAnyTooltipPinnedGlobal()) {
      tooltipEl.style.display = "none";
      return;
    }

    // When pinned, update values to match synced cursor but keep position fixed.
    // Close button is safe — it lives on tooltipEl, outside contentContainer.
    if (_pinState.isPinned) {
      const syncIdx = u.cursor.idx ?? lastIdx;
      // Track highlighted series — detect changes for fast-path highlight update.
      // Check both local focus (highlightedSeriesIdRef) and cross-chart highlight
      // (_crossHighlightRunId) so the pinned tooltip updates when hovering other charts.
      const localHighlight = highlightedSeriesIdRef?.current ?? null;
      const crossHighlightRunId = (u as any)._crossHighlightRunId as string | null ?? null;
      // Use cross-chart run ID if it differs from local (user moved to another chart)
      const pinnedHighlightCheck = crossHighlightRunId ?? localHighlight;
      const highlightChanged = pinnedHighlightCheck !== lastHighlightedSeriesId;
      if (highlightChanged) {
        lastHighlightedSeriesId = pinnedHighlightCheck;
        // Sync the local refs so fast-path row highlighting picks up cross-chart changes
        if (crossHighlightRunId && highlightedRunIdRef) {
          highlightedRunIdRef.current = crossHighlightRunId;
        }
        if (crossHighlightRunId && highlightedSeriesIdRef) {
          highlightedSeriesIdRef.current = crossHighlightRunId;
        }
      }
      const indexChanged = syncIdx != null && syncIdx !== lastIdx;
      const needsUpdate = indexChanged || tooltipStructureDirty || highlightChanged;
      // Only rebuild when cursor moves to a different step, highlight changed
      // (vertical mouse movement), OR structure is dirty.
      // Rebuilding on every setCursor call destroys row DOM elements,
      // breaking mouseenter/mouseleave handlers and stealing search focus.
      if (needsUpdate && tooltipEl) {
        if (indexChanged) lastIdx = syncIdx!;
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
        scheduleTooltipUpdate(u, lastIdx!);
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
    // Highlight changes are handled incrementally in the fast path
    const currentHighlightCheck = highlightedSeriesIdRef?.current ?? null;
    const highlightChanged = currentHighlightCheck !== lastHighlightedSeriesId;
    if (highlightChanged) {
      lastHighlightedSeriesId = currentHighlightCheck;
    }
    if (displayIdx === lastRenderedIdx && !tooltipStructureDirty && !highlightChanged) return;

    scheduleTooltipUpdate(u, displayIdx);
  }

  return {
    hooks: {
      init,
      setCursor,
      destroy(u: uPlot) {
        log(`destroy called - isHovering=${isHovering}, _pinState.isPinned=${_pinState.isPinned}, hideTimeoutId=${hideTimeoutId !== null}`);
        // If this chart owned the pinned tooltip, unpin and hide it
        if (isSharedMode && _pinState.pinnedChartId === pluginChartId) {
          _pinState.isPinned = false;
          // Move tooltip back to body BEFORE the dialog unmounts — otherwise
          // the tooltip element gets removed with the dialog content and
          // non-fullscreen charts can never show it again.
          reparentTooltip?.(null);
          if (tooltipEl) {
            tooltipEl.removeAttribute("data-pinned");
            tooltipEl.style.display = "none";
            tooltipEl.style.pointerEvents = "none";
            tooltipEl.style.border = `1px solid ${theme === "dark" ? "#333" : "#e0e0e0"}`;
            tooltipEl.style.resize = "none";
            const closeBtn = tooltipEl.querySelector("[data-tooltip-close]");
            if (closeBtn) closeBtn.remove();
          }
        }
        // Clear stale content and reset active chart so the next chart that mounts
        // under the cursor can take over cleanly without flashing old data.
        if (isSharedMode) {
          if (contentContainer) contentContainer.textContent = "";
          if (tooltipEl) tooltipEl.style.display = "none";
          if (activeTooltipChartRef && activeTooltipChartRef.current === pluginChartId) {
            activeTooltipChartRef.current = null;
          }
          tooltipStructureDirty = true;
          cachedRows.clear();
          lastRenderedIdx = null;
          isHovering = false;
        }
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

        // Remove tooltip element (skip in shared mode — element is owned by the context)
        if (!isSharedMode && tooltipEl && tooltipEl.parentNode) {
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
