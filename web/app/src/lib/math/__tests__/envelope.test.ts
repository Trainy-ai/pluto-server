import { describe, it, expect } from "vitest";
import { downsampleWithEnvelope } from "../downsample";
import { downsampleLTTB } from "../smoothing";

/**
 * Generate test data: smooth exponential decay with injected anomalies.
 * Mimics a real training loss curve (100k steps).
 */
function generateTestData(numPoints: number) {
  const x: number[] = [];
  const y: number[] = [];

  for (let step = 0; step < numPoints; step++) {
    x.push(step);
    y.push(2.5 * Math.exp(-step / 20000) + 0.15);
  }

  // Inject 3 anomalies
  const anomalies = [
    { step: 25000, value: 5.0 },   // spike: 2× surrounding (~1.4)
    { step: 52950, value: 3.0 },   // spike: 10× surrounding (~0.3)
    { step: 78500, value: 0.0 },   // dip: below surrounding (~0.17)
  ];

  for (const a of anomalies) {
    if (a.step < numPoints) {
      y[a.step] = a.value;
    }
  }

  return { x, y, anomalies };
}

describe("downsampleWithEnvelope", () => {
  it("returns original data when dataLength <= targetPoints", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 20, 30, 40, 50];
    const result = downsampleWithEnvelope(x, y, 10);

    expect(result.x).toEqual(x);
    expect(result.y).toEqual(y);
    expect(result.yMin).toEqual(y);
    expect(result.yMax).toEqual(y);
  });

  it("returns original data when targetPoints is 0 (no limit)", () => {
    const x = [1, 2, 3];
    const y = [10, 20, 30];
    const result = downsampleWithEnvelope(x, y, 0);
    expect(result.x).toEqual(x);
  });

  it("handles targetPoints < 3 by returning first and last", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 50, 5, 40, 30];
    const result = downsampleWithEnvelope(x, y, 2);
    expect(result.x).toEqual([1, 5]);
    expect(result.y).toEqual([10, 30]);
  });

  it("always includes first and last points", () => {
    const { x, y } = generateTestData(1000);
    const result = downsampleWithEnvelope(x, y, 100);

    expect(result.x[0]).toBe(x[0]);
    expect(result.x[result.x.length - 1]).toBe(x[x.length - 1]);
    expect(result.y[0]).toBe(y[0]);
    expect(result.y[result.y.length - 1]).toBe(y[y.length - 1]);
  });

  it("produces output of target length", () => {
    const { x, y } = generateTestData(10000);
    const result = downsampleWithEnvelope(x, y, 500);

    expect(result.x.length).toBe(500);
    expect(result.y.length).toBe(500);
    expect(result.yMin.length).toBe(500);
    expect(result.yMax.length).toBe(500);
  });

  it("yMin <= y <= yMax for every bucket", () => {
    const { x, y } = generateTestData(10000);
    const result = downsampleWithEnvelope(x, y, 200);

    for (let i = 0; i < result.x.length; i++) {
      expect(result.yMin[i]).toBeLessThanOrEqual(result.y[i]);
      expect(result.yMax[i]).toBeGreaterThanOrEqual(result.y[i]);
    }
  });
});

describe("anomaly preservation: envelope vs naive sampling", () => {
  const NUM_POINTS = 100000;
  const TARGET = 2000;
  const { x, y, anomalies } = generateTestData(NUM_POINTS);

  it("every-Nth naive sampling loses anomalies at non-aligned steps", () => {
    // Simple every-Nth downsampling with a stride that doesn't align with anomaly steps
    // Use stride=51 to avoid aligning with any anomaly (25000, 52950, 78500)
    const stride = 51;
    const naiveX: number[] = [];
    const naiveY: number[] = [];
    for (let i = 0; i < NUM_POINTS; i += stride) {
      naiveX.push(x[i]);
      naiveY.push(y[i]);
    }

    // Check if any anomaly value survived in the naive sample
    let anomaliesFound = 0;
    for (const a of anomalies) {
      // Check if any sampled point is the exact anomaly step
      if (naiveX.some((v) => v === a.step)) {
        anomaliesFound++;
      }
    }

    // stride=51 doesn't evenly divide any of 25000, 52950, 78500
    // so none of those exact steps will be sampled
    expect(anomaliesFound).toBe(0);
  });

  it("LTTB preserves shape but may not guarantee all anomaly values", () => {
    const lttbResult = downsampleLTTB(x, y, TARGET);

    let anomaliesPreserved = 0;
    for (const a of anomalies) {
      // Check if the exact anomaly value appears in the downsampled data
      if (lttbResult.y.some((v) => v === a.value)) {
        anomaliesPreserved++;
      }
    }

    // LTTB should preserve most anomalies (large triangles), but it's not guaranteed for all
    // The spike at step 52,950 (value=3.0) is modest and may be missed
    expect(anomaliesPreserved).toBeGreaterThanOrEqual(1);
  });

  it("min/max envelope ALWAYS preserves ALL anomalies", () => {
    const result = downsampleWithEnvelope(x, y, 500);

    for (const a of anomalies) {
      if (a.value > y[a.step - 1]) {
        // Spike — should appear in yMax
        const maxContains = result.yMax.some((v) => v >= a.value);
        expect(maxContains).toBe(true);
      } else {
        // Dip — should appear in yMin
        const minContains = result.yMin.some((v) => v <= a.value);
        expect(minContains).toBe(true);
      }
    }
  });

  it("envelope width shrinks on zoom into narrow range", () => {
    // Zoom into the anomaly at step 52,950 with a narrow window
    const zoomStart = 52900;
    const zoomEnd = 53000;
    const zoomX = x.slice(zoomStart, zoomEnd);
    const zoomY = y.slice(zoomStart, zoomEnd);

    const result = downsampleWithEnvelope(zoomX, zoomY, 50);

    // With only 100 raw points downsampled to 50, each bucket has ~2 points
    // The envelope should be very tight (nearly zero width) for smooth regions
    let narrowBuckets = 0;
    for (let i = 0; i < result.x.length; i++) {
      const width = result.yMax[i] - result.yMin[i];
      if (width < 0.01) {
        narrowBuckets++;
      }
    }

    // Most buckets should be very narrow (excluding the anomaly bucket)
    expect(narrowBuckets).toBeGreaterThan(result.x.length * 0.5);
  });
});
