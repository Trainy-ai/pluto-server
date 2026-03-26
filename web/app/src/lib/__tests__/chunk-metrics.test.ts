import { describe, it, expect } from "vitest";

/**
 * Tests for the metric chunking logic used by multi-metric batch queries.
 * The frontend splits large metric arrays into chunks of MULTI_METRIC_CHUNK
 * to stay within tRPC URL length limits, then reassembles the responses.
 */

const MULTI_METRIC_CHUNK = 25;

function chunkMetrics(metricNames: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < metricNames.length; i += MULTI_METRIC_CHUNK) {
    chunks.push(metricNames.slice(i, i + MULTI_METRIC_CHUNK));
  }
  return chunks;
}

type MultiMetricResponse = Record<string, Record<string, { step: number; value: number }[]>>;

function mergeChunkResponses(
  responses: (MultiMetricResponse | undefined)[],
): Map<string, Record<string, { step: number; value: number }[]>> {
  const map = new Map<string, Record<string, { step: number; value: number }[]>>();
  for (const data of responses) {
    if (data) {
      for (const [logName, runData] of Object.entries(data)) {
        map.set(logName, runData);
      }
    }
  }
  return map;
}

describe("metric chunking", () => {
  it("returns empty array for empty input", () => {
    expect(chunkMetrics([])).toEqual([]);
  });

  it("returns single chunk for <= 25 metrics", () => {
    const metrics = Array.from({ length: 10 }, (_, i) => `metric_${i}`);
    const chunks = chunkMetrics(metrics);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(10);
  });

  it("returns exactly 1 chunk for 25 metrics", () => {
    const metrics = Array.from({ length: 25 }, (_, i) => `metric_${i}`);
    const chunks = chunkMetrics(metrics);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(25);
  });

  it("splits 95 metrics into 4 chunks (25, 25, 25, 20)", () => {
    const metrics = Array.from({ length: 95 }, (_, i) => `train/metric_${i}`);
    const chunks = chunkMetrics(metrics);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toHaveLength(25);
    expect(chunks[1]).toHaveLength(25);
    expect(chunks[2]).toHaveLength(25);
    expect(chunks[3]).toHaveLength(20);
  });

  it("preserves all metrics across chunks (no loss, no duplication)", () => {
    const metrics = Array.from({ length: 95 }, (_, i) => `m_${i}`);
    const chunks = chunkMetrics(metrics);
    const flattened = chunks.flat();
    expect(flattened).toEqual(metrics);
  });

  it("preserves metric order across chunks", () => {
    const metrics = ["z_last", "a_first", "m_middle"];
    const chunks = chunkMetrics(metrics);
    expect(chunks.flat()).toEqual(["z_last", "a_first", "m_middle"]);
  });
});

describe("chunk response merging", () => {
  it("merges multiple chunk responses into single map", () => {
    const chunk1: MultiMetricResponse = {
      "train/loss": { run1: [{ step: 0, value: 1.0 }] },
      "train/acc": { run1: [{ step: 0, value: 0.5 }] },
    };
    const chunk2: MultiMetricResponse = {
      "eval/loss": { run1: [{ step: 0, value: 0.8 }] },
    };

    const merged = mergeChunkResponses([chunk1, chunk2]);
    expect(merged.size).toBe(3);
    expect(merged.get("train/loss")).toBeDefined();
    expect(merged.get("train/acc")).toBeDefined();
    expect(merged.get("eval/loss")).toBeDefined();
  });

  it("handles undefined responses (still loading)", () => {
    const chunk1: MultiMetricResponse = {
      "train/loss": { run1: [{ step: 0, value: 1.0 }] },
    };

    const merged = mergeChunkResponses([chunk1, undefined, undefined]);
    expect(merged.size).toBe(1);
    expect(merged.get("train/loss")).toBeDefined();
  });

  it("handles all undefined responses", () => {
    const merged = mergeChunkResponses([undefined, undefined]);
    expect(merged.size).toBe(0);
  });

  it("preserves multi-run data within each metric", () => {
    const response: MultiMetricResponse = {
      "train/loss": {
        run1: [{ step: 0, value: 1.0 }],
        run2: [{ step: 0, value: 0.9 }],
      },
    };

    const merged = mergeChunkResponses([response]);
    const lossData = merged.get("train/loss")!;
    expect(Object.keys(lossData)).toEqual(["run1", "run2"]);
    expect(lossData.run1[0].value).toBe(1.0);
    expect(lossData.run2[0].value).toBe(0.9);
  });
});
