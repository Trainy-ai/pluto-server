import { describe, it, expect } from "vitest";
import { computeEffectiveZoomBuckets, MAX_BUCKETS } from "@/lib/chart-bucket-estimate";

describe("computeEffectiveZoomBuckets", () => {
  it("returns zoomBuckets when range is null (not zoomed)", () => {
    expect(computeEffectiveZoomBuckets(null, 500)).toBe(500);
  });

  it("returns step count for small ranges", () => {
    // 100 steps (201-101+1 = 101) — well under MAX_BUCKETS
    expect(computeEffectiveZoomBuckets([100, 200], 500)).toBe(101);
  });

  it("caps at MAX_BUCKETS for large ranges", () => {
    expect(computeEffectiveZoomBuckets([0, 50_000], 500)).toBe(MAX_BUCKETS);
  });

  it("returns 1 for a single-step range", () => {
    expect(computeEffectiveZoomBuckets([42, 42], 500)).toBe(1);
  });

  it("returns MAX_BUCKETS when range exactly equals MAX_BUCKETS", () => {
    expect(computeEffectiveZoomBuckets([0, MAX_BUCKETS - 1], 500)).toBe(MAX_BUCKETS);
  });

  it("returns step count when range is just under MAX_BUCKETS", () => {
    const range: [number, number] = [0, MAX_BUCKETS - 2];
    expect(computeEffectiveZoomBuckets(range, 500)).toBe(MAX_BUCKETS - 1);
  });

  it("ignores the fallback zoomBuckets when range is present", () => {
    // Even if zoomBuckets is very large, the result is based on the range
    expect(computeEffectiveZoomBuckets([0, 9], 100_000)).toBe(10);
  });
});
