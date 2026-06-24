import { z } from "zod";

// Widget type enum.
//
// `"histogram"` is kept here for LEGACY PARSE ONLY. The UI no longer
// creates standalone histogram widgets — they live as entries inside
// `"distributions"` widgets. Saved dashboards from before the split
// still arrive on the wire with `type: "histogram"`, so this enum
// entry plus HistogramWidgetConfigSchema below must stay around so
// validation succeeds; migrateDashboardConfig (frontend) immediately
// converts them to a single-entry distributions widget on read. Once
// every saved dashboard has been opened-and-resaved (which rewrites
// it as `"distributions"` on disk), this enum entry, the schema, and
// the HistogramWidget component / "histogram" case in widget-renderer
// can all be deleted.
export const WidgetTypeSchema = z.enum([
  "chart",
  "scatter",
  "single-value",
  "histogram",
  "logs",
  "file-series",
  "file-group",
  // "distributions" hosts a list of mixed entries: categorical {bars}
  // rollups and numeric histograms. Replaces the older paths where
  // bars lived inside chart widgets and histograms lived inside
  // file-group widgets (or as standalone "histogram" widgets).
  "distributions",
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

// Optional bar-rollup config carried inside a chart widget. When set,
// the widget renders the categorical bar view (N sibling scalar
// metrics under a shared prefix, drawn as Step bars / Ridgeline /
// Heatmap) INSTEAD of the line chart that the other fields describe.
// This sits inside ChartWidgetConfig (rather than its own widget type)
// so the dashboard's Add Widget → Metrics flow can create EITHER a
// line chart OR a bar group depending on whether the user picks a
// metric name or a `prefix/{bars}` entry.
export const BarsConfigSchema = z.object({
  prefix: z.string(), // e.g. "training/dataset/"
  viewMode: z.enum(["step", "ridgeline", "heatmap"]).default("ridgeline"),
  depthAxis: z.enum(["step", "run"]).default("step"),
  binRange: z
    .object({
      start: z.number().int().min(1).max(10000),
      end: z.number().int().min(1).max(10000),
    })
    .optional(),
  // W&B-style "Ignore outliers" toggle. When true, the global maxFreq used
  // to normalize ridge heights / heatmap colors / step bars is Tukey-fenced
  // so one extreme step doesn't squish every other step's bars into a flat
  // baseline. Default true on the read side to match HistogramWidgetConfig.
  ignoreOutliers: z.boolean().default(true),
  // Transpose the Ridgeline/Heatmap views so STEP runs along the X axis
  // and the categorical bins stack vertically. Only meaningful when
  // viewMode ∈ {ridgeline, heatmap} AND depthAxis === "step"; the
  // settings popover disables the checkbox otherwise. Default false
  // (current orientation). Step mode + depthAxis="run" ignore this.
  stepsOnX: z.boolean().default(false),
});
export type BarsConfig = z.infer<typeof BarsConfigSchema>;

// Chart widget config (line graph OR bar group)
export const ChartWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  metrics: z.array(z.string()), // ["training/loss", "validation/loss"]
  // X-axis mode:
  //   "step"           → training step number (integer sequence, default)
  //   "absolute-time"  → wall-clock timestamp (DateTime)
  //   "relative-time"  → elapsed time since first data point
  //   "time"           → legacy alias for "absolute-time" (backward compat)
  //   "<metric-name>"  → any other string = custom metric (parametric curve, joined by step)
  xAxis: z.string().default("step"),
  yAxisScale: ScaleTypeSchema.default("linear"),
  xAxisScale: ScaleTypeSchema.default("linear"),
  aggregation: AggregationTypeSchema.default("LAST"),
  smoothing: SmoothingConfigSchema.optional(),
  maxPoints: z.number().positive().optional(), // Server-side bucketed downsampling
  showOriginal: z.boolean().default(false),
  // `bars` field removed — chart widgets are line-only. Categorical
  // {bars} rollups live in distributions widgets now. Legacy chart
  // widgets with a `bars` field round-trip through the union's
  // .passthrough() and migrateDashboardConfig splits them on read.
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

// Histogram widget view mode:
//   "step"       → existing single-step viewer with step navigator + animation (backward-compat default)
//   "ridgeline"  → joyplot of per-step distributions over training
//   "heatmap"    → 2D density map, Y=step, X=bin, color=freq
export const HistogramViewModeSchema = z.enum(["step", "ridgeline", "heatmap"]);
export type HistogramViewMode = z.infer<typeof HistogramViewModeSchema>;

// Histogram depth axis (Ridgeline/Heatmap only — Step mode ignores it):
//   "step" → ridges/rows = steps, panels side-by-side per run
//   "run"  → ridges/rows = runs, slider scrubs the current step
export const HistogramDepthAxisSchema = z.enum(["step", "run"]);
export type HistogramDepthAxis = z.infer<typeof HistogramDepthAxisSchema>;

// Histogram widget config — LEGACY PARSE ONLY. UI never creates this
// shape anymore; it lives as a `DistributionsEntry` (kind: "histogram")
// inside a distributions widget. Schema kept here so dashboards saved
// before the distributions split still validate on read;
// migrateDashboardConfig (frontend) rewrites them on the fly.
// Safe to delete once all dashboards have been opened-and-resaved.
export const HistogramWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  metric: z.string(),
  viewMode: HistogramViewModeSchema.default("step"),
  // W&B-style "Ignore outliers" toggle. When true, the X domain and
  // globalMaxFreq are clamped to 5th/95th-percentile fences computed
  // from per-step bin ranges; outlier steps still draw but clip at
  // the edges. Default true so a fresh widget renders cleanly out of
  // the box. See histogram-outlier-fences.ts for the math.
  ignoreOutliers: z.boolean().default(true),
  // Transpose Ridgeline/Heatmap views so STEP runs along the X axis
  // and bins stack vertically. Only meaningful when viewMode ∈
  // {ridgeline, heatmap} AND depthAxis === "step" (numeric histograms
  // currently force depthAxis=step at the view level when stepsOnX
  // would apply). Default false. Step viewMode ignores this.
  stepsOnX: z.boolean().default(false),
});
export type HistogramWidgetConfig = z.infer<typeof HistogramWidgetConfigSchema>;

// File group widget config (multiple files: images, videos, audio).
// HISTOGRAM file entries and `{bars}` prefix entries used to live here too
// — they're in distributions widgets now. Legacy file-group configs that
// still carry `categoricalPrefixes`, `viewModes`, `depthAxes`, `binRanges`,
// or the per-entry `ignoreOutliers` / `stepsOnX` maps round-trip through
// the union's .passthrough(); migrateDashboardConfig lifts them out into a
// distributions widget on read.
export const FileGroupWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  files: z.array(z.string()), // literal names or "glob:..."/"regex:..." patterns
});
export type FileGroupWidgetConfig = z.infer<typeof FileGroupWidgetConfigSchema>;

// ─── Distributions widget ───────────────────────────────────────────
//
// A single distributions widget hosts a list of mixed entries:
// categorical {bars} rollups (kind="bars") and numeric histograms
// (kind="histogram"). Renderer dispatches per-entry. Replaces the
// historic paths where bars lived inside chart widgets and histograms
// lived inside file-group widgets. The two entry shapes deliberately
// reuse `BarsConfigSchema` and the existing histogram fields, tagged
// with a discriminator so legacy migration is straightforward.

export const DistributionsBarsEntrySchema = BarsConfigSchema.extend({
  kind: z.literal("bars"),
});
export type DistributionsBarsEntry = z.infer<typeof DistributionsBarsEntrySchema>;

export const DistributionsHistogramEntrySchema = z.object({
  kind: z.literal("histogram"),
  metric: z.string(),
  viewMode: HistogramViewModeSchema.default("ridgeline"),
  ignoreOutliers: z.boolean().default(true),
  stepsOnX: z.boolean().default(false),
});
export type DistributionsHistogramEntry = z.infer<
  typeof DistributionsHistogramEntrySchema
>;

export const DistributionsEntrySchema = z.discriminatedUnion("kind", [
  DistributionsBarsEntrySchema,
  DistributionsHistogramEntrySchema,
]);
export type DistributionsEntry = z.infer<typeof DistributionsEntrySchema>;

export const DistributionsWidgetConfigSchema = BaseWidgetConfigSchema.extend({
  entries: z.array(DistributionsEntrySchema),
});
export type DistributionsWidgetConfig = z.infer<
  typeof DistributionsWidgetConfigSchema
>;

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

// Clean union type without passthrough index signatures
type WidgetConfigType =
  | z.infer<typeof ChartWidgetConfigSchema>
  | z.infer<typeof ScatterWidgetConfigSchema>
  | z.infer<typeof SingleValueWidgetConfigSchema>
  | z.infer<typeof HistogramWidgetConfigSchema>
  | z.infer<typeof FileGroupWidgetConfigSchema>
  | z.infer<typeof LogsWidgetConfigSchema>
  | z.infer<typeof FileSeriesWidgetConfigSchema>
  | z.infer<typeof DistributionsWidgetConfigSchema>;

// Union of all widget configs
// IMPORTANT: .passthrough() prevents z.union from stripping unknown keys when
// an earlier schema matches (e.g. LogsWidgetConfig matches file-series data
// because both have `logName`, which would strip `mediaType`). The superRefine
// on WidgetSchema handles authoritative type-specific validation.
// The type cast preserves clean TS types while keeping passthrough runtime behavior.
export const WidgetConfigSchema = z.union([
  ChartWidgetConfigSchema.passthrough(),
  ScatterWidgetConfigSchema.passthrough(),
  SingleValueWidgetConfigSchema.passthrough(),
  FileGroupWidgetConfigSchema.passthrough(),
  HistogramWidgetConfigSchema.passthrough(),
  LogsWidgetConfigSchema.passthrough(),
  FileSeriesWidgetConfigSchema.passthrough(),
  DistributionsWidgetConfigSchema.passthrough(),
]) as unknown as z.ZodType<WidgetConfigType, z.ZodTypeDef, WidgetConfigType>;
export type WidgetConfig = WidgetConfigType;

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
    case "distributions":
      schema = DistributionsWidgetConfigSchema;
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

// Section definition (container for widgets, optionally a "folder" with child sections)
// A section with `children` is a folder that can group other sections and/or hold its own widgets.
// Max 1 level of nesting: children cannot themselves have children.
// Dynamic patterns are only allowed on leaf sections (no children).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive schema needs a loose type annotation;
// the runtime Zod validation guarantees the output matches Section.
export const SectionSchema: z.ZodType<Section, z.ZodTypeDef, any> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    collapsed: z.boolean().default(false),
    widgets: z.array(WidgetSchema).default([]),
    dynamicPattern: z.string().optional(),
    dynamicPatternMode: z.enum(["search", "regex"]).optional(),
    // Suffixes (final path segment after last `/`) whose metrics combine into
    // one widget per shared prefix. e.g. ["min", "max", "mean"] groups
    // `foo/bar/{min,max,mean}` into a single widget keyed on `foo/bar`.
    // Metrics whose final segment isn't in this list still appear as their
    // own standalone widgets (loose semantics — nothing is hidden).
    dynamicGroupBy: z.array(z.string()).optional(),
    // Optional prefix allowlist (each entry is a full path before the last `/`).
    // If set, only metrics whose prefix is in the list participate in
    // combined-widget generation; metrics with other prefixes still render as
    // standalone widgets. If empty/unset, all matched prefixes participate.
    dynamicGroupPrefixes: z.array(z.string()).optional(),
    // Optional regex applied to each metric path. When set, REPLACES the
    // literal prefix-allowlist mode (regex wins). Each unique tuple of
    // capture-group values defines a bucket. A pattern with zero capture
    // groups treats the regex as a "match anything" filter and bucks all
    // matching metrics into a single combined widget. Useful when more than
    // one path segment varies independently (e.g. dataset and stat name in
    // `validation/<dataset>/original/<stat>`).
    dynamicGroupPrefixRegex: z.string().optional(),
    // Per-metric Step/Ridgeline/Heatmap viewMode overrides for
    // dynamically-generated widgets in this section (applies to both
    // numeric histogram entries AND `{bars}` prefix entries — both share
    // the same view-mode set). Dynamic widgets don't exist in widgets[] —
    // they're regenerated from `dynamicPattern` on every render — so any
    // user preference has to live on the section itself, keyed by the
    // metric/file name. Read-side fallback is "ridgeline" when a metric
    // isn't in the map. Other section types (static, folder) ignore this
    // field. Field name kept as `histogramViewModes` for on-disk
    // backwards-compat.
    histogramViewModes: z.record(z.string(), HistogramViewModeSchema).optional(),
    children: z.array(z.lazy(() => SectionSchema)).optional(),
  }).superRefine((section, ctx) => {
    // Folders (sections with children) cannot have dynamic patterns
    if (section.children && section.dynamicPattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Folder sections cannot have a dynamic pattern",
        path: ["dynamicPattern"],
      });
    }
    // Enforce max 1 level of nesting
    if (section.children) {
      for (let i = 0; i < section.children.length; i++) {
        const child = section.children[i] as Section;
        if (child.children && child.children.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Child sections cannot have their own children (max 1 level of nesting)",
            path: ["children", i, "children"],
          });
        }
      }
    }
  })
);

export interface Section {
  id: string;
  name: string;
  collapsed: boolean;
  widgets: Widget[];
  dynamicPattern?: string;
  dynamicPatternMode?: "search" | "regex";
  dynamicGroupBy?: string[];
  dynamicGroupPrefixes?: string[];
  dynamicGroupPrefixRegex?: string;
  histogramViewModes?: Record<string, HistogramViewMode>;
  children?: Section[];
}

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
        viewMode: "ridgeline",
        ignoreOutliers: true,
        stepsOnX: false,
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
    case "distributions":
      return {
        entries: [],
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
