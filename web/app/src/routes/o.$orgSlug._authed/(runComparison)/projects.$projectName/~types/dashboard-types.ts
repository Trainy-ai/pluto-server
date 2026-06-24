// Dashboard view configuration types
// These types mirror the server-side types in web/server/lib/dashboard-types.ts

export type WidgetType =
  | "chart"
  | "scatter"
  | "single-value"
  | "histogram"
  | "logs"
  | "file-series"
  | "file-group"
  // `distributions` hosts a list of mixed entries: categorical {bars}
  // rollups and numeric histograms. Replaces the older paths where bars
  // lived inside chart widgets and histograms lived inside file-group
  // widgets. Legacy "histogram" widgets and legacy file-group widgets
  // with categoricalPrefixes / HISTOGRAM file entries are migrated into
  // distributions on read by migrateDashboardConfig.
  | "distributions";

export type AggregationType = "LAST" | "AVG" | "MIN" | "MAX" | "VARIANCE";

export type ScaleType = "linear" | "log";

export type HistogramViewMode = "step" | "ridgeline" | "heatmap";

export type SmoothingAlgorithm = "none" | "exponential" | "moving-average" | "gaussian";

export interface SmoothingConfig {
  algorithm: SmoothingAlgorithm;
  parameter?: number;
}

// Base widget config (shared by all widget types)
export interface BaseWidgetConfig {
  title?: string;
}

// One bar-rollup entry inside a chart widget. A widget can hold
// zero, one, or many; combined with `metrics` to mix line + bar
// views in a single stacked-scrollable widget.
export interface BarsConfig {
  prefix: string;
  viewMode: "step" | "ridgeline" | "heatmap";
  depthAxis: "step" | "run";
  binRange?: { start: number; end: number };
  // W&B-style "Ignore outliers" toggle. When true, the per-step maxFreq
  // values are Tukey-fenced so one extreme step doesn't dominate the
  // shared Y scale. Default true on the read side.
  ignoreOutliers?: boolean;
  // Transpose: when true (and viewMode is Ridgeline/Heatmap with
  // depthAxis=step), steps run along the X axis and bin labels stack
  // along Y. Default false. Step mode + depthAxis="run" ignore it.
  stepsOnX?: boolean;
}

// Chart widget config — pure line chart. Categorical {bars} rollups
// moved out into the new distributions widget; chart no longer carries
// a `bars` field. Legacy chart configs that still have one round-trip
// through the union (TypeScript marks it `unknown`) and the read-time
// migration in use-dashboard-config splits them.
export interface ChartWidgetConfig extends BaseWidgetConfig {
  metrics: string[];
  // X-axis mode:
  //   "step"           → training step number (integer sequence, default)
  //   "absolute-time"  → wall-clock timestamp (DateTime)
  //   "relative-time"  → elapsed time since first data point
  //   "time"           → legacy alias for "absolute-time" (backward compat)
  //   "<metric-name>"  → any other string = custom metric (parametric curve, joined by step)
  xAxis: string;
  yAxisScale: ScaleType;
  xAxisScale: ScaleType;
  aggregation: AggregationType;
  smoothing?: SmoothingConfig;
  maxPoints?: number;
  showOriginal: boolean;
}

// Scatter widget config
export interface ScatterWidgetConfig extends BaseWidgetConfig {
  xMetric: string;
  yMetric: string;
  xScale: ScaleType;
  yScale: ScaleType;
  xAggregation: AggregationType;
  yAggregation: AggregationType;
}

// Single value widget config
export interface SingleValueWidgetConfig extends BaseWidgetConfig {
  metric: string;
  aggregation: AggregationType;
  format?: string;
  prefix?: string;
  suffix?: string;
}

// Histogram widget config
//
// `viewMode` is populated by the server-side Zod default (`"step"` for legacy
// widgets) before reaching the frontend, but we declare it optional so that
// synthetic in-memory configs (tests, ad-hoc construction) compile without
// having to spell it out. Consumers should fall back to `"step"` when reading.
export interface HistogramWidgetConfig extends BaseWidgetConfig {
  metric: string;
  viewMode?: HistogramViewMode;
  // W&B-style "Ignore outliers" toggle. When true, X domain + globalMaxFreq
  // are clamped to 5th/95th percentile fences so outlier steps don't
  // squish the readable bulk. Default true on the read side.
  ignoreOutliers?: boolean;
  // Transpose: when true (Ridgeline/Heatmap modes), steps run along the
  // X axis and bin values stack along Y. Default false.
  stepsOnX?: boolean;
}

// Histogram depth axis (Ridgeline / Heatmap only — Step mode ignores it):
//   "step" → ridges/rows = steps, panels side-by-side per run
//   "run"  → ridges/rows = runs, slider scrubs the current step
export type HistogramDepthAxis = "step" | "run";

// File group widget config — images, videos, audio. Numeric histogram
// file entries and {bars} prefix entries moved into distributions
// widgets. Legacy file-group configs that still carry the histogram /
// {bars} metadata round-trip through the union (TypeScript marks the
// extra fields `unknown`) and migrateDashboardConfig lifts them out.
export interface FileGroupWidgetConfig extends BaseWidgetConfig {
  files: string[];
}

// ─── Distributions widget ───────────────────────────────────────────
//
// A distributions widget holds a list of mixed entries:
//   • {bars} rollups (categorical, sourced from a scalar prefix)
//   • Numeric histograms (sourced from a `mlop_data` histogram metric)
// Entries are tagged with `kind` so the renderer dispatches the right
// view component per entry. Replaces the older paths where bars lived
// inside chart widgets and histograms lived inside file-group widgets.

export interface DistributionsBarsEntry {
  kind: "bars";
  prefix: string;
  viewMode: HistogramViewMode;
  depthAxis: HistogramDepthAxis;
  binRange?: { start: number; end: number };
  ignoreOutliers?: boolean;
  stepsOnX?: boolean;
}

export interface DistributionsHistogramEntry {
  kind: "histogram";
  metric: string;
  viewMode: HistogramViewMode;
  ignoreOutliers?: boolean;
  stepsOnX?: boolean;
}

export type DistributionsEntry =
  | DistributionsBarsEntry
  | DistributionsHistogramEntry;

export interface DistributionsWidgetConfig extends BaseWidgetConfig {
  entries: DistributionsEntry[];
}

// Logs widget config
export interface LogsWidgetConfig extends BaseWidgetConfig {
  logName: string;
  maxLines: number;
}

// Media widget config (images, videos, audio)
export interface FileSeriesWidgetConfig extends BaseWidgetConfig {
  logName: string;
  mediaType: "IMAGE" | "VIDEO" | "AUDIO";
}

// Union of all widget configs
export type WidgetConfig =
  | ChartWidgetConfig
  | ScatterWidgetConfig
  | SingleValueWidgetConfig
  | HistogramWidgetConfig
  | FileGroupWidgetConfig
  | LogsWidgetConfig
  | FileSeriesWidgetConfig
  | DistributionsWidgetConfig;

// Widget position and size in the grid
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

// Complete widget definition
export interface Widget {
  id: string;
  type: WidgetType;
  config: WidgetConfig;
  layout: WidgetLayout;
}

// Section definition (container for widgets, optionally a "folder" with child sections)
// A section with `children` is a folder that can group other sections and/or hold its own widgets.
// Max 1 level of nesting: children cannot themselves have children.
// Dynamic patterns are only allowed on leaf sections (no children).
export interface Section {
  id: string;
  name: string;
  collapsed: boolean;
  widgets: Widget[];
  dynamicPattern?: string;
  dynamicPatternMode?: "search" | "regex";
  // Suffixes that combine into one widget per shared prefix. Loose: metrics
  // whose final segment isn't in this list still appear as standalone widgets.
  dynamicGroupBy?: string[];
  // Optional prefix allowlist. If set, only metrics whose prefix is in the
  // list participate in combined-widget generation; metrics with other
  // prefixes still render as standalone widgets. Empty/unset = all participate.
  dynamicGroupPrefixes?: string[];
  // Optional regex applied to each metric path. When set, REPLACES the
  // literal prefix-allowlist mode (regex wins). Capture-group tuples define
  // buckets; metrics with the same captured tuple combine into one widget.
  // Zero captures = match-anything filter → one big combined widget.
  dynamicGroupPrefixRegex?: string;
  // Per-metric Step/Ridgeline/Heatmap viewMode override for dynamically-
  // generated widgets (applies to both numeric histogram entries and
  // `{bars}` prefix entries). Field name kept for on-disk backwards-compat.
  histogramViewModes?: Record<string, HistogramViewMode>;
  children?: Section[];
}

// Dashboard settings
export interface DashboardSettings {
  gridCols: number;
  rowHeight: number;
  compactType: "vertical" | "horizontal" | "none";
}

// Complete dashboard view config
export interface DashboardViewConfig {
  version: number;
  sections: Section[];
  settings: DashboardSettings;
}

// Helper to create an empty dashboard config
export function createEmptyDashboardConfig(): DashboardViewConfig {
  return {
    version: 1,
    sections: [],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: "vertical",
    },
  };
}

// Helper to generate unique IDs
export { generateUuid as generateId } from "@/lib/uuid";
