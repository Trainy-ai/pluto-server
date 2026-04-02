import type { TooltipInterpolation } from "@/lib/math/interpolation";

export interface LineData {
  x: number[];
  y: (number | null)[];
  label: string;
  /** Unique identifier for this series (e.g. run ID). Used for highlighting when labels may not be unique. Falls back to label if not provided. */
  seriesId?: string;
  color?: string;
  /** uPlot dash pattern array, e.g. [10, 5] for dashed, [2, 4] for dotted. undefined = solid. */
  dash?: number[];
  hideFromLegend?: boolean;
  opacity?: number;
  /** If set, this series is an envelope boundary (min or max) for the named parent series */
  envelopeOf?: string;
  /** Whether this is the min or max boundary of an envelope */
  envelopeBound?: "min" | "max";
  /** Map from x-value to non-finite flag text ("NaN", "Inf", "-Inf") for tooltip display */
  valueFlags?: Map<number, string>;
  /** Map from x-value to set of non-finite flags found in the aggregation bucket.
   *  Used for rendering markers (△ for +Inf, ▽ for -Inf, ⊗ for NaN). */
  nonFiniteMarkers?: Map<number, Set<"NaN" | "Inf" | "-Inf">>;
  /** Human-readable run name (for tooltip column customization) */
  runName?: string;
  /** Run ID / external ID (for tooltip column customization) */
  runId?: string;
  /** Metric name this series is plotting (for tooltip column customization) */
  metricName?: string;
}


export interface LineChartProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: LineData[];
  isDateTime?: boolean;
  logXAxis?: boolean;
  logYAxis?: boolean;
  xlabel?: string;
  ylabel?: string;
  title?: string;
  /** Subtitle shown in tooltip header (e.g. chip/pattern names) */
  subtitle?: string;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  /** Sync key for cross-chart cursor sync */
  syncKey?: string;
  /** Tooltip interpolation mode for series with missing values at the hovered step */
  tooltipInterpolation?: TooltipInterpolation;
  /** Callback fired when zoom range changes. The parent can use this to trigger
   *  server re-fetch for full-resolution data in the zoomed range.
   *  Called with [xMin, xMax] on zoom, or null on zoom reset. */
  onZoomRangeChange?: (range: [number, number] | null) => void;
  /** Enable IQR-based outlier detection for Y-axis scaling (default: false) */
  outlierDetection?: boolean;
  /** When false, lines break at null/missing values instead of connecting across gaps (default: true) */
  spanGaps?: boolean;
  /** Enable Y-axis drag-to-zoom. When enabled, drag direction determines axis:
   *  horizontal drag zooms X, vertical drag zooms Y (adaptive mode). */
  yZoom?: boolean;
  /** Externally-stored Y zoom range. When provided, the chart initializes with this
   *  Y range instead of auto-scaling. Used to persist Y zoom across mini/fullscreen. */
  yZoomRange?: [number, number] | null;
  /** Called when the user drags to zoom the Y axis, or null when Y zoom is reset. */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
  /** Map of runId → forkStep for drawing vertical fork annotations */
  forkSteps?: Map<string, number>;
}

/** Ref handle exposed to parent components */
export interface LineChartUPlotRef {
  getChart: () => uPlot | null;
  resetZoom: () => void;
}

export const DEFAULT_SYNC_KEY = "uplot-global-sync";
