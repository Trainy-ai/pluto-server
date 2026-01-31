import { describe, it, expect } from "vitest";
import {
  extractMetricNames,
  matchMetricsByPattern,
} from "../pattern-matching-utils";
import type { GroupedMetrics, RunStatus } from "@/lib/grouping/types";

// Helper to create test GroupedMetrics
// Note: In real data, metric.name contains the FULL path (e.g., "training/dataset/favorita_sales").
// The groupName is just for UI grouping, not part of the metric identifier.
function createGroupedMetrics(
  groups: Array<{
    groupName: string;
    metrics: Array<{ name: string; type: "METRIC" | "HISTOGRAM" | "IMAGE" }>;
  }>
): GroupedMetrics {
  const result: GroupedMetrics = {};

  for (const group of groups) {
    result[group.groupName] = {
      groupName: group.groupName,
      metrics: group.metrics.map((m) => ({
        name: m.name, // Full metric path
        type: m.type,
        data: [
          {
            runId: "run-1",
            runName: "Test Run",
            color: "#ff0000",
            status: "COMPLETED" as RunStatus,
          },
        ],
      })),
    };
  }

  return result;
}

describe("extractMetricNames", () => {
  it("extracts metric names (full paths already in metric.name)", () => {
    const groupedMetrics = createGroupedMetrics([
      {
        groupName: "training/dataset",
        metrics: [
          // metric.name contains full path, groupName is just for UI grouping
          { name: "training/dataset/favorita_sales", type: "METRIC" },
          { name: "training/dataset/walmart_sales", type: "METRIC" },
        ],
      },
    ]);

    const names = extractMetricNames(groupedMetrics);

    expect(names).toContain("training/dataset/favorita_sales");
    expect(names).toContain("training/dataset/walmart_sales");
    expect(names).toHaveLength(2);
  });

  it("handles metrics without group name", () => {
    const groupedMetrics = createGroupedMetrics([
      {
        groupName: "",
        metrics: [{ name: "loss", type: "METRIC" }],
      },
    ]);

    const names = extractMetricNames(groupedMetrics);

    expect(names).toContain("loss");
    expect(names).toHaveLength(1);
  });

  it("only includes METRIC types by default", () => {
    const groupedMetrics = createGroupedMetrics([
      {
        groupName: "train",
        metrics: [
          { name: "train/loss", type: "METRIC" },
          { name: "train/samples", type: "IMAGE" },
          { name: "train/weights", type: "HISTOGRAM" },
        ],
      },
    ]);

    const names = extractMetricNames(groupedMetrics);

    expect(names).toContain("train/loss");
    expect(names).not.toContain("train/samples");
    expect(names).not.toContain("train/weights");
    expect(names).toHaveLength(1);
  });

  it("handles multiple groups with nested paths", () => {
    const groupedMetrics = createGroupedMetrics([
      {
        groupName: "training/dataset",
        metrics: [{ name: "training/dataset/favorita_sales", type: "METRIC" }],
      },
      {
        groupName: "training/model",
        metrics: [{ name: "training/model/loss", type: "METRIC" }],
      },
      {
        groupName: "eval",
        metrics: [{ name: "eval/accuracy", type: "METRIC" }],
      },
    ]);

    const names = extractMetricNames(groupedMetrics);

    expect(names).toContain("training/dataset/favorita_sales");
    expect(names).toContain("training/model/loss");
    expect(names).toContain("eval/accuracy");
    expect(names).toHaveLength(3);
  });

  it("returns sorted names", () => {
    const groupedMetrics = createGroupedMetrics([
      {
        groupName: "z_group",
        metrics: [{ name: "z_group/metric_a", type: "METRIC" }],
      },
      {
        groupName: "a_group",
        metrics: [{ name: "a_group/metric_b", type: "METRIC" }],
      },
    ]);

    const names = extractMetricNames(groupedMetrics);

    expect(names[0]).toBe("a_group/metric_b");
    expect(names[1]).toBe("z_group/metric_a");
  });

  it("handles empty groupedMetrics", () => {
    const names = extractMetricNames({});
    expect(names).toEqual([]);
  });

  it("handles groups with no metrics", () => {
    const groupedMetrics = createGroupedMetrics([
      {
        groupName: "empty_group",
        metrics: [],
      },
    ]);

    const names = extractMetricNames(groupedMetrics);
    expect(names).toEqual([]);
  });
});

describe("matchMetricsByPattern", () => {
  const testMetrics = [
    "training/dataset/favorita_sales",
    "training/dataset/walmart_sales",
    "training/model/loss",
    "training/model/accuracy",
    "eval/loss",
    "eval/accuracy",
    "loss",
  ];

  it("matches metrics with wildcard pattern", () => {
    const matches = matchMetricsByPattern("training/dataset/.*", testMetrics);

    expect(matches).toContain("training/dataset/favorita_sales");
    expect(matches).toContain("training/dataset/walmart_sales");
    expect(matches).toHaveLength(2);
  });

  it("matches metrics with prefix pattern", () => {
    const matches = matchMetricsByPattern("training/.*", testMetrics);

    expect(matches).toContain("training/dataset/favorita_sales");
    expect(matches).toContain("training/dataset/walmart_sales");
    expect(matches).toContain("training/model/loss");
    expect(matches).toContain("training/model/accuracy");
    expect(matches).toHaveLength(4);
  });

  it("matches metrics with suffix pattern", () => {
    const matches = matchMetricsByPattern(".*loss", testMetrics);

    expect(matches).toContain("training/model/loss");
    expect(matches).toContain("eval/loss");
    expect(matches).toContain("loss");
    expect(matches).toHaveLength(3);
  });

  it("matches exact metric names", () => {
    const matches = matchMetricsByPattern("^loss$", testMetrics);

    expect(matches).toContain("loss");
    expect(matches).toHaveLength(1);
  });

  it("returns empty array for non-matching pattern", () => {
    const matches = matchMetricsByPattern("nonexistent/.*", testMetrics);
    expect(matches).toEqual([]);
  });

  it("returns empty array for invalid regex", () => {
    const matches = matchMetricsByPattern("[invalid(regex", testMetrics);
    expect(matches).toEqual([]);
  });

  it("rejects dangerous patterns that could cause ReDoS", () => {
    // Patterns with excessive .* repetition
    expect(matchMetricsByPattern(".*.*.*.*", testMetrics)).toEqual([]);

    // Patterns with excessive .+ repetition
    expect(matchMetricsByPattern(".+.+.+.+", testMetrics)).toEqual([]);

    // Overly long patterns
    const longPattern = "a".repeat(101);
    expect(matchMetricsByPattern(longPattern, testMetrics)).toEqual([]);
  });

  it("returns empty array for empty pattern", () => {
    const matches = matchMetricsByPattern("", testMetrics);
    expect(matches).toEqual([]);
  });

  it("returns empty array for whitespace-only pattern", () => {
    const matches = matchMetricsByPattern("   ", testMetrics);
    expect(matches).toEqual([]);
  });

  it("handles complex regex patterns", () => {
    const matches = matchMetricsByPattern("(training|eval)/.*loss", testMetrics);

    expect(matches).toContain("training/model/loss");
    expect(matches).toContain("eval/loss");
    expect(matches).toHaveLength(2);
  });

  it("is case-sensitive by default", () => {
    const matches = matchMetricsByPattern("TRAINING/.*", testMetrics);
    expect(matches).toEqual([]);
  });
});
