// Dashboard view configuration types
// These types mirror the server-side types in web/server/lib/dashboard-types.ts

export type WidgetType = "chart" | "scatter" | "single-value" | "histogram" | "logs" | "file-series" | "file-group";

export type AggregationType = "LAST" | "AVG" | "MIN" | "MAX" | "VARIANCE";

export type ScaleType = "linear" | "log";

export type SmoothingAlgorithm = "none" | "exponential" | "moving-average" | "gaussian";

export interface SmoothingConfig {
  algorithm: SmoothingAlgorithm;
  parameter?: number;
}

// Base widget config (shared by all widget types)
export interface BaseWidgetConfig {
  title?: string;
}

// Chart widget config (line graph)
export interface ChartWidgetConfig extends BaseWidgetConfig {
  metrics: string[];
  xAxis: string;
  yAxisScale: ScaleType;
  xAxisScale: ScaleType;
  aggregation: AggregationType;
  smoothing?: SmoothingConfig;
  maxPoints?: number;
  showOriginal: boolean;
  /** Manual Y-axis minimum bound */
  yMin?: number;
  /** Manual Y-axis maximum bound */
  yMax?: number;
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
export interface HistogramWidgetConfig extends BaseWidgetConfig {
  metric: string;
}

// File group widget config (multiple files: histograms, images, videos, audio)
export interface FileGroupWidgetConfig extends BaseWidgetConfig {
  files: string[];
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
  | FileSeriesWidgetConfig;

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

// Section definition (simple container for widgets)
export interface Section {
  id: string;
  name: string;
  collapsed: boolean;
  widgets: Widget[];
  dynamicPattern?: string;
  dynamicPatternMode?: "search" | "regex";
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
export function generateId(): string {
  return crypto.randomUUID();
}
