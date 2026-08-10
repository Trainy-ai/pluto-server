import { describe, it, expect } from "vitest";
import { MAX_RUNS_PER_BATCH, resolveChartLimit } from "../batch-limits";

/** The app's shipped default for "Max series per chart". */
const DEFAULT_MAX_SERIES = 500;

describe("resolveChartLimit", () => {
  it("keeps the shared cap in step with the server", () => {
    // The server schemas hardcode 200 (histogram.schema.ts MAX_RUNS_PER_BATCH,
    // and the .max(200) on the graph procs). Drift here means charts request
    // more than the server accepts again.
    expect(MAX_RUNS_PER_BATCH).toBe(200);
  });

  describe("the bug this exists to prevent", () => {
    /**
     * 460 runs logging one metric is 460 series — comfortably under the 500
     * default — so the old maxSeries-only guard passed and the request went out
     * and was rejected. The run cap has to bind independently.
     */
    it("refuses 460 runs on a single-metric chart despite the 500 series default", () => {
      const limit = resolveChartLimit({
        metricCount: 1,
        seriesCount: 460,
        maxSeries: DEFAULT_MAX_SERIES,
      });
      expect(limit.overLimit).toBe(true);
      expect(limit.effectiveMaxSeries).toBe(200);
      expect(limit.isRunBound).toBe(true);
    });

    it("still refuses when the user turns the series limit off entirely", () => {
      // maxSeries 0 = "No limit (may be slow)" in settings. It cannot opt out
      // of the server's cap.
      const limit = resolveChartLimit({ metricCount: 1, seriesCount: 460, maxSeries: 0 });
      expect(limit.overLimit).toBe(true);
      expect(limit.effectiveMaxSeries).toBe(200);
      expect(limit.isRunBound).toBe(true);
    });
  });

  describe("boundaries", () => {
    it("allows exactly the cap on a single-metric chart", () => {
      const limit = resolveChartLimit({
        metricCount: 1,
        seriesCount: 200,
        maxSeries: DEFAULT_MAX_SERIES,
      });
      expect(limit.overLimit).toBe(false);
    });

    it("refuses one past it", () => {
      const limit = resolveChartLimit({
        metricCount: 1,
        seriesCount: 201,
        maxSeries: DEFAULT_MAX_SERIES,
      });
      expect(limit.overLimit).toBe(true);
    });

    it("treats a metric-less chart as one metric", () => {
      // metricNames falls back to [title], but guard against a 0 that would
      // otherwise make the ceiling 0 and refuse everything.
      expect(
        resolveChartLimit({ metricCount: 0, seriesCount: 10, maxSeries: 500 }),
      ).toMatchObject({ effectiveMaxSeries: 200, overLimit: false });
    });
  });

  describe("multi-metric charts", () => {
    /**
     * The run cap scales with metric count: 20 metrics × 200 runs is 4000
     * series and still only 200 runs per request, so the ceiling is 4000 —
     * not 200. Reporting 200 here would contradict the settings dropdown.
     */
    it("scales the run-derived ceiling by metric count", () => {
      const limit = resolveChartLimit({
        metricCount: 20,
        seriesCount: 5000,
        maxSeries: 0,
      });
      expect(limit.effectiveMaxSeries).toBe(4000);
      expect(limit.overLimit).toBe(true);
      expect(limit.isRunBound).toBe(true);
    });

    it("lets maxSeries bind when it is the tighter of the two", () => {
      // 20 metrics × 30 runs = 600 series: only 30 runs, so the server cap is
      // nowhere near — the user's 500 is what refuses it.
      const limit = resolveChartLimit({
        metricCount: 20,
        seriesCount: 600,
        maxSeries: DEFAULT_MAX_SERIES,
      });
      expect(limit.overLimit).toBe(true);
      expect(limit.effectiveMaxSeries).toBe(DEFAULT_MAX_SERIES);
      expect(limit.isRunBound).toBe(false);
    });

    /**
     * isRunBound drives which remedy the notice offers. With 3 metrics the run
     * ceiling is 600 but maxSeries is 500, so dropping to 200 runs still leaves
     * 600 series — "reduce to 200 runs" would be wrong advice here.
     */
    it("does not claim run-bound when maxSeries binds first", () => {
      const limit = resolveChartLimit({
        metricCount: 3,
        seriesCount: 750,
        maxSeries: DEFAULT_MAX_SERIES,
      });
      expect(limit.isRunBound).toBe(false);
      expect(limit.effectiveMaxSeries).toBe(DEFAULT_MAX_SERIES);
    });
  });

  it("permits an ordinary chart", () => {
    expect(
      resolveChartLimit({ metricCount: 5, seriesCount: 150, maxSeries: DEFAULT_MAX_SERIES }),
    ).toMatchObject({ overLimit: false, effectiveMaxSeries: DEFAULT_MAX_SERIES });
  });
});
