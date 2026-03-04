import { describe, it, expect } from "vitest";
import { isPatternValue, resolveMetrics } from "../glob-utils";

/**
 * Tests for the logic that determines whether a chart widget should be
 * auto-hidden when its pattern-matched metrics resolve to nothing.
 *
 * The feature: pattern-only widgets (all metrics are glob/regex) are hidden
 * when they resolve to zero metrics or have no data. Mixed/literal widgets
 * always stay visible.
 */

describe("allPatternsOnly gate", () => {
  // This mirrors the logic in ChartWidget:
  //   const allPatternsOnly = metrics.length > 0 && metrics.every(isPatternValue);

  it("returns true when all metrics are glob patterns", () => {
    const metrics = ["glob:train/*", "glob:eval/*"];
    expect(metrics.every(isPatternValue)).toBe(true);
  });

  it("returns true when all metrics are regex patterns", () => {
    const metrics = ["regex:train/.*", "regex:eval/.*"];
    expect(metrics.every(isPatternValue)).toBe(true);
  });

  it("returns true for mixed glob and regex (both are patterns)", () => {
    const metrics = ["glob:train/*", "regex:eval/.*"];
    expect(metrics.every(isPatternValue)).toBe(true);
  });

  it("returns false when any metric is a literal", () => {
    const metrics = ["glob:train/*", "train/loss"];
    expect(metrics.every(isPatternValue)).toBe(false);
  });

  it("returns false when all metrics are literals", () => {
    const metrics = ["train/loss", "eval/accuracy"];
    expect(metrics.every(isPatternValue)).toBe(false);
  });

  it("returns false for empty metrics array (vacuous truth, but guarded by length check)", () => {
    const metrics: string[] = [];
    // The actual code uses: (metrics.length > 0) && metrics.every(isPatternValue)
    const allPatternsOnly = metrics.length > 0 && metrics.every(isPatternValue);
    expect(allPatternsOnly).toBe(false);
  });
});

describe("pattern resolution to zero metrics (hide scenario)", () => {
  it("glob pattern matching no available metrics resolves to empty", () => {
    const resolved = resolveMetrics(
      ["glob:nonexistent/*"],
      ["train/loss", "eval/accuracy"],
    );
    expect(resolved).toEqual([]);
  });

  it("regex pattern matching no available metrics resolves to empty", () => {
    const resolved = resolveMetrics(
      ["regex:^foobar/.*$"],
      ["train/loss", "eval/accuracy"],
    );
    expect(resolved).toEqual([]);
  });

  it("pattern resolving to metrics returns non-empty (widget stays visible)", () => {
    const resolved = resolveMetrics(
      ["glob:train/*"],
      ["train/loss", "train/accuracy", "eval/loss"],
    );
    expect(resolved).toEqual(["train/accuracy", "train/loss"]);
  });

  it("literal metric is always included even if not in available list", () => {
    // Literal names are included as-is — widget should never be hidden
    const resolved = resolveMetrics(
      ["train/loss"],
      [], // no available metrics at all
    );
    expect(resolved).toEqual(["train/loss"]);
  });

  it("mixed literal + pattern: literal keeps the list non-empty", () => {
    const resolved = resolveMetrics(
      ["train/loss", "glob:nonexistent/*"],
      ["eval/accuracy"],
    );
    // "train/loss" is literal → always included
    // "glob:nonexistent/*" → matches nothing
    expect(resolved).toEqual(["train/loss"]);
    expect(resolved.length).toBeGreaterThan(0);
  });
});
