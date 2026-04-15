import { describe, it, expect } from "vitest";
import { computeEffectiveZoomBuckets } from "@/lib/chart-bucket-estimate";

describe("computeEffectiveZoomBuckets", () => {
  it("returns zoomBuckets when range is null (not zoomed)", () => {
    expect(computeEffectiveZoomBuckets(null, 500)).toBe(500);
  });

  it("returns step count for small ranges", () => {
    // 101 steps — well under zoomBuckets of 500
    expect(computeEffectiveZoomBuckets([100, 200], 500)).toBe(101);
  });

  it("caps at zoomBuckets for large ranges", () => {
    expect(computeEffectiveZoomBuckets([0, 50_000], 500)).toBe(500);
  });

  it("returns 1 for a single-step range", () => {
    expect(computeEffectiveZoomBuckets([42, 42], 500)).toBe(1);
  });

  it("returns zoomBuckets when range exactly equals zoomBuckets", () => {
    expect(computeEffectiveZoomBuckets([0, 499], 500)).toBe(500);
  });

  it("returns step count when range is just under zoomBuckets", () => {
    expect(computeEffectiveZoomBuckets([0, 498], 500)).toBe(499);
  });

  it("ignores the fallback zoomBuckets when range is smaller", () => {
    // Even if zoomBuckets is very large, the result is based on the range
    expect(computeEffectiveZoomBuckets([0, 9], 100_000)).toBe(10);
  });

  it("respects different resolution settings", () => {
    const range: [number, number] = [0, 50_000];
    // Each resolution caps the zoom bucket count
    expect(computeEffectiveZoomBuckets(range, 200)).toBe(200);
    expect(computeEffectiveZoomBuckets(range, 3000)).toBe(3000);
    expect(computeEffectiveZoomBuckets(range, 10_000)).toBe(10_000);
  });
});
