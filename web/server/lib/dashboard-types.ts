import { z } from "zod";

// Widget type enum
export const WidgetTypeSchema = z.enum([
  "chart",
  "scatter",
  "single-value",
  "histogram",
  "logs",
  "file-series",
  "file-group",
]);
export type WidgetType = z.infer<typeof WidgetTypeSchema>;

// Aggregation type enum
export const AggregationTypeSchema = z.enum([
  "LAST",
  "AVG",
  "MIN",
  "MAX",
  "VARIANCE",
]);
export type AggregationType = z.infer<typeof AggregationTypeSchema>;

// Scale type enum
export const ScaleTypeSchema = z.enum(["linear", "log"]);
export type ScaleType = z.infer<typeof ScaleTypeSchema>;

// Smoothing algorithm enum
export const SmoothingAlgorithmSchema = z.enum([
  "none",
  "exponential",
  "moving-average",
  "gaussian",
]);
export type SmoothingAlgorithm = z.infer<typeof SmoothingAlgorithmSchema>;

// Smoothing config
export const SmoothingConfigSchema = z.object({
  algorithm: SmoothingAlgorithmSchema,
  parameter: z.number().min(0).max(1).optional(),
});
export type SmoothingConfig = z.infer<typeof SmoothingConfigSchema>;

// Base widget config (shared by all widget types)
export const BaseWidgetConfigSchema = z.object({
  title: z.string().optional(),
});

// Chart widget config (line graph)
export const ChartWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  metrics: z.array(z.string()), // ["training/loss", "validation/loss"]
  xAxis: z.string().default("step"), // "step", "time", or specific metric name
  yAxisScale: ScaleTypeSchema.default("linear"),
  xAxisScale: ScaleTypeSchema.default("linear"),
  aggregation: AggregationTypeSchema.default("LAST"),
  smoothing: SmoothingConfigSchema.optional(),
  maxPoints: z.number().positive().optional(), // Downsampling with LTTB
  showOriginal: z.boolean().default(false),
  yMin: z.number().optional(), // Manual Y-axis minimum bound
  yMax: z.number().optional(), // Manual Y-axis maximum bound
});
export type ChartWidgetConfig = z.infer<typeof ChartWidgetConfigSchema>;

// Scatter widget config
export const ScatterWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  xMetric: z.string(),
  yMetric: z.string(),
  xScale: ScaleTypeSchema.default("linear"),
  yScale: ScaleTypeSchema.default("linear"),
  xAggregation: AggregationTypeSchema.default("LAST"),
  yAggregation: AggregationTypeSchema.default("LAST"),
});
export type ScatterWidgetConfig = z.infer<typeof ScatterWidgetConfigSchema>;

// Single value widget config
export const SingleValueWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  metric: z.string(),
  aggregation: AggregationTypeSchema.default("LAST"),
  format: z.string().optional(), // e.g., "0.0000" for precision
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});
export type SingleValueWidgetConfig = z.infer<typeof SingleValueWidgetConfigSchema>;

// Histogram widget config
export const HistogramWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  metric: z.string(),
});
export type HistogramWidgetConfig = z.infer<typeof HistogramWidgetConfigSchema>;

// File group widget config (multiple files: histograms, images, videos, audio)
export const FileGroupWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  files: z.array(z.string()), // literal names or "glob:..."/"regex:..." patterns
});
export type FileGroupWidgetConfig = z.infer<typeof FileGroupWidgetConfigSchema>;

// Logs widget config
export const LogsWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  logName: z.string(),
  maxLines: z.number().positive().default(100),
});
export type LogsWidgetConfig = z.infer<typeof LogsWidgetConfigSchema>;

// Media type enum for file series
export const MediaTypeSchema = z.enum(["IMAGE", "VIDEO", "AUDIO"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

// File series widget config (images, videos, audio)
export const FileSeriesWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  logName: z.string(),
  mediaType: MediaTypeSchema,
});
export type FileSeriesWidgetConfig = z.infer<typeof FileSeriesWidgetConfigSchema>;

// Union of all widget configs.
// IMPORTANT: FileSeriesWidgetConfigSchema must come BEFORE LogsWidgetConfigSchema
// because both share `logName`. Zod's union tries schemas in order and strips
// unknown fields on match — if LogsWidgetConfig matches first (logName present,
// maxLines gets default), it strips `mediaType`, causing the superRefine to fail.
// Placing file-series first ensures `mediaType` (required) fails for logs configs,
// so Zod correctly falls through to LogsWidgetConfig.
export const WidgetConfigSchema = z.union([
  ChartWidgetConfigSchema,
  ScatterWidgetConfigSchema,
  SingleValueWidgetConfigSchema,
  FileGroupWidgetConfigSchema,
  HistogramWidgetConfigSchema,
  FileSeriesWidgetConfigSchema,
  LogsWidgetConfigSchema,
]);
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// Widget position and size in the grid
export const WidgetLayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().positive().default(6), // Width in grid units (out of 12)
  h: z.number().int().positive().default(4), // Height in grid units
  minW: z.number().int().positive().optional(),
  minH: z.number().int().positive().optional(),
  maxW: z.number().int().positive().optional(),
  maxH: z.number().int().positive().optional(),
});
export type WidgetLayout = z.infer<typeof WidgetLayoutSchema>;

// Complete widget definition
export const WidgetSchema = z.object({
  id: z.string(),
  type: WidgetTypeSchema,
  config: WidgetConfigSchema,
  layout: WidgetLayoutSchema,
}).superRefine((widget, ctx) => {
  let schema: z.ZodTypeAny;
  switch (widget.type) {
    case "chart":
      schema = ChartWidgetConfigSchema;
      break;
    case "scatter":
      schema = ScatterWidgetConfigSchema;
      break;
    case "single-value":
      schema = SingleValueWidgetConfigSchema;
      break;
    case "histogram":
      schema = HistogramWidgetConfigSchema;
      break;
    case "file-group":
      schema = FileGroupWidgetConfigSchema;
      break;
    case "logs":
      schema = LogsWidgetConfigSchema;
      break;
    case "file-series":
      schema = FileSeriesWidgetConfigSchema;
      break;
    default:
      return;
  }
  const result = schema.safeParse(widget.config);
  if (!result.success) {
    result.error.issues.forEach((issue) => {
      ctx.addIssue({
        ...issue,
        path: ["config", ...issue.path],
      });
    });
  }
});
export type Widget = z.infer<typeof WidgetSchema>;

// Section definition (simple container for widgets)
export const SectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  collapsed: z.boolean().default(false),
  widgets: z.array(WidgetSchema).default([]),
  dynamicPattern: z.string().optional(),
  dynamicPatternMode: z.enum(["search", "regex"]).optional(),
});
export type Section = z.infer<typeof SectionSchema>;

// Complete dashboard view config
export const DashboardViewConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  sections: z.array(SectionSchema).default([]),
  // Global settings
  settings: z.object({
    gridCols: z.number().int().positive().default(12),
    rowHeight: z.number().int().positive().default(80),
    compactType: z.enum(["vertical", "horizontal", "none"]).default("vertical"),
  }).default({}),
});
export type DashboardViewConfig = z.infer<typeof DashboardViewConfigSchema>;

// Helper to create default configs for each widget type
export const createDefaultWidgetConfig = (type: WidgetType): WidgetConfig => {
  switch (type) {
    case "chart":
      return {
        metrics: [],
        xAxis: "step",
        yAxisScale: "linear",
        xAxisScale: "linear",
        aggregation: "LAST",
        showOriginal: false,
      };
    case "scatter":
      return {
        xMetric: "",
        yMetric: "",
        xScale: "linear",
        yScale: "linear",
        xAggregation: "LAST",
        yAggregation: "LAST",
      };
    case "single-value":
      return {
        metric: "",
        aggregation: "LAST",
      };
    case "histogram":
      return {
        metric: "",
      };
    case "file-group":
      return {
        files: [],
      };
    case "logs":
      return {
        logName: "",
        maxLines: 100,
      };
    case "file-series":
      return {
        logName: "",
        mediaType: "IMAGE",
      };
  }
};

// Helper to create an empty dashboard config
export const createEmptyDashboardConfig = (): DashboardViewConfig => ({
  version: 1,
  sections: [],
  settings: {
    gridCols: 12,
    rowHeight: 80,
    compactType: "vertical",
  },
});

// Helper to generate unique IDs
export const generateId = () => {
  return crypto.randomUUID();
};
