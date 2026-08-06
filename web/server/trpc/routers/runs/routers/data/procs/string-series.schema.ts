import { z } from "zod";

/**
 * ClickHouse `dataType` marking a non-numeric (string) time series in
 * `mlop_data`.
 *
 * The metric path is Float64, so `log("phase", "warmup")` had nowhere to live
 * and migrated wandb runs lost their string series entirely (only the final
 * value survived, in `runs.config`). Rows land here instead: one per (logName,
 * step), `data` holding the raw string value.
 *
 * Chosen over a new table because `mlop_data` already carries `dataType` +
 * `data String`, and the Rust ingest treats `dataType` as an opaque string
 * (validated non-empty only) — so this needs no ClickHouse migration and no
 * ingest change.
 */
export const STRING_SERIES_DATA_TYPE = "string-series";

export const stringSeriesInput = z.object({
  runId: z.string(),
  projectName: z.string(),
  logName: z.string(),
  stepCap: z.number().int().positive().max(10_000).optional(),
});


/**
 * Compact wire shape: parallel `steps` / `values` arrays.
 *
 * One short string per step, rather than any expanded numeric encoding: the
 * consumer (`StringSeriesChart`) plots a staircase by mapping each value to its
 * index in `canonicalLabels`, which is a trivial client-side lookup. Sending a
 * per-step vector over the label set instead would put steps x labels
 * mostly-zero numbers on the wire — 10k steps over 20 distinct values is
 * 200,000 numbers in place of 10,000 short strings.
 *
 * `canonicalLabels` is still computed server-side: the ordering has to be
 * identical across runs in a multi-run view, which the client cannot decide on
 * its own.
 */
export interface StringSeriesQueryResult {
  /** Sampled steps, ascending. Parallel to `values`. */
  steps: number[];
  /**
   * Wall-clock time per sample, as ClickHouse DateTime64(3) text. Parallel to
   * `steps`.
   *
   * Carried so the chart can offer the absolute / relative time X axes every
   * numeric metric has. It was omitted originally and the setting silently did
   * nothing on a string metric — the column was in `mlop_data` all along, the
   * query just never selected it.
   */
  times: string[];
  /** Raw value at each step in `steps`. */
  values: string[];
  /** Distinct values in first-appearance order — the category axis. */
  canonicalLabels: string[];
  truncated: boolean;
  totalSteps: number;
}

