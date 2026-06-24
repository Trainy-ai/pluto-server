import { describe, it, expect } from "vitest";
import { applyBinRange } from "../categorical-bin-range";

function makeRun(labels: string[], freq: number[]) {
  return {
    runId: "r1",
    runName: "run-1",
    color: "#ff0000",
    steps: [
      {
        step: 0,
        bars: {
          freq,
          labels,
          maxFreq: Math.max(0, ...freq),
          shape: "categorical" as const,
          type: "Histogram" as const,
        },
      },
    ],
  };
}

describe("applyBinRange", () => {
  it("returns input unchanged when range covers all bins", () => {
    const run = makeRun(["a", "b", "c"], [1, 2, 3]);
    const out = applyBinRange([run], 1, 3);
    expect(out[0].steps[0].bars.labels).toEqual(["a", "b", "c"]);
    expect(out[0].steps[0].bars.freq).toEqual([1, 2, 3]);
  });

  it("slices to the top-N when start=1 and end<total", () => {
    const run = makeRun(["a", "b", "c", "d"], [10, 9, 8, 7]);
    const out = applyBinRange([run], 1, 2);
    expect(out[0].steps[0].bars.labels).toEqual(["a", "b"]);
    expect(out[0].steps[0].bars.freq).toEqual([10, 9]);
    expect(out[0].steps[0].bars.maxFreq).toBe(10);
  });

  it("windows into the tail when start>1", () => {
    const run = makeRun(["a", "b", "c", "d", "e"], [5, 4, 3, 2, 1]);
    const out = applyBinRange([run], 3, 5);
    expect(out[0].steps[0].bars.labels).toEqual(["c", "d", "e"]);
    expect(out[0].steps[0].bars.freq).toEqual([3, 2, 1]);
    expect(out[0].steps[0].bars.maxFreq).toBe(3);
  });

  it("clamps end to total bins (the input-overflow bug)", () => {
    // User typed 300 into the end box for a 4-bin chart — should clamp
    // to 4, not silently fall back to a smaller window.
    const run = makeRun(["a", "b", "c", "d"], [4, 3, 2, 1]);
    const out = applyBinRange([run], 1, 300);
    expect(out[0].steps[0].bars.labels).toEqual(["a", "b", "c", "d"]);
  });

  it("clamps start to 1 when given 0 or negative", () => {
    const run = makeRun(["a", "b", "c"], [1, 1, 1]);
    const out = applyBinRange([run], 0, 2);
    expect(out[0].steps[0].bars.labels).toEqual(["a", "b"]);
  });

  it("forces a 1-wide window when start > end (degenerate input)", () => {
    const run = makeRun(["a", "b", "c"], [1, 2, 3]);
    const out = applyBinRange([run], 3, 1);
    // s clamps to 3, e clamps to max(s, end) = 3 → one bin
    expect(out[0].steps[0].bars.labels).toEqual(["c"]);
    expect(out[0].steps[0].bars.freq).toEqual([3]);
  });

  it("returns empty input unchanged", () => {
    expect(applyBinRange([], 1, 30)).toEqual([]);
  });

  it("handles runs with no steps", () => {
    const empty = {
      runId: "r",
      runName: "r",
      color: "#000",
      steps: [],
    };
    const out = applyBinRange([empty], 1, 30);
    expect(out).toEqual([empty]);
  });
});
