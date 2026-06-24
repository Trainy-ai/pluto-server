import { z } from "zod";

export const HISTOGRAM_STEP_CAP_HARD_MAX = 5000;

// Minimum number of suffixes a path prefix must have to qualify for the
// `prefix/{bars}` entry in the Add-Widget Metrics dropdown.
// blah/blog/1 + blah/blog/2 alone (2 suffixes) is not enough —
// at least 3 children are required to surface the rollup option.
export const BARS_MIN_SUFFIXES = 3;

export const histogramInput = z.object({
  runId: z.string(),
  projectName: z.string(),
  logName: z.string(),
  stepCap: z.number().int().positive().max(HISTOGRAM_STEP_CAP_HARD_MAX).optional(),
});

// Existing uniform/numeric histogram payload (from `pluto.Histogram(samples)`
// in mlop_data with dataType='histogram'). Bins are described by min/max/num
// with uniform spacing.
export const histogramSchema = z.object({
  freq: z.array(z.number().int()),
  bins: z.object({
    min: z.number(),
    max: z.number(),
    num: z.number().int(),
  }),
  shape: z.literal("uniform"),
  type: z.literal("Histogram"),
  maxFreq: z.number().int(),
});

export const histogramDataRow = z.object({
  logName: z.string(),
  time: z.string().transform((str) => new Date(str.replace(" ", "T") + "Z")),
  step: z.coerce.number(),
  histogramData: z.string().transform((str) => {
    const parsed = JSON.parse(str);
    return histogramSchema.parse(parsed);
  }),
});

export type HistogramDataRow = z.infer<typeof histogramDataRow>;

export interface HistogramQueryResult {
  rows: HistogramDataRow[];
  truncated: boolean;
  totalSteps: number;
}

// Bars-data payload powering the `{bars}` widget. Server-side rollup of
// scalar metrics under a path prefix — each bar is a named category
// (the suffix after the prefix) rather than a numeric range. `freq[i]`
// and `labels[i]` are aligned. `shape: "categorical"` and `type:
// "Histogram"` are wire-format discriminators inherited from the
// numeric histogram payload so the shared canvas primitives
// (`drawCategoricalBars` / Ridgeline / Heatmap) can treat both shapes
// uniformly — `{bars}` is a bin-shaped payload, not real histogram data.
export const barsDataSchema = z.object({
  freq: z.array(z.number()),
  labels: z.array(z.string()),
  shape: z.literal("categorical"),
  type: z.literal("Histogram"),
  maxFreq: z.number(),
});

export const barsDataRow = z.object({
  step: z.coerce.number(),
  bars: barsDataSchema,
});

export type BarsDataRow = z.infer<typeof barsDataRow>;

export interface BarsDataQueryResult {
  rows: BarsDataRow[];
  truncated: boolean;
  totalSteps: number;
  // Canonical label ordering used in every row's `labels` array. Sorted by
  // max-value across the run, descending. Stable across steps and across
  // runs in a multi-run query.
  canonicalLabels: string[];
}

export const barsDataInput = z.object({
  runId: z.string(),
  projectName: z.string(),
  pathPrefix: z.string().min(1),
  stepCap: z.number().int().positive().max(HISTOGRAM_STEP_CAP_HARD_MAX).optional(),
});

// Batched variant of barsDataInput: one query for many runs instead of one
// per run. Additive — the single-run `barsData` proc/input is unchanged.
export const barsDataBatchInput = z.object({
  runIds: z.array(z.string()).min(1),
  projectName: z.string(),
  pathPrefix: z.string().min(1),
  stepCap: z.number().int().positive().max(HISTOGRAM_STEP_CAP_HARD_MAX).optional(),
});

// Batched bars-data result, keyed by the ENCODED runId the caller passed in.
// Runs with no qualifying data under the prefix (or below the suffix
// threshold) are omitted — callers look up `result[runId]` and treat a
// missing entry as "no data", exactly like the single-run empty result.
export type BarsDataBatchResult = Record<string, BarsDataQueryResult>;

// runId is OPTIONAL: when present the proc scopes to a single run; when
// omitted it scopes to all runs in the project (parity with the
// distinctFileLogNames pattern used by the Files dropdown). The project-
// wide variant is what lights up `{bars}` entries before the user has
// selected any runs on a fresh dashboard.
export const eligiblePrefixesInput = z.object({
  runId: z.string().optional(),
  projectName: z.string(),
});

export const eligiblePrefixEntry = z.object({
  prefix: z.string(),
  suffixCount: z.number().int().positive(),
});

export type EligiblePrefixEntry = z.infer<typeof eligiblePrefixEntry>;
