import { describe, it, expect } from "vitest";
import {
  translateZoomToStepRange,
  type TimeStepMapping,
} from "../zoom-translate";
import { interpolate } from "@/components/charts/context/chart-sync-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TimeStepMapping from a single run's step/time arrays */
function singleRunMapping(
  runId: string,
  steps: number[],
  relTimeSecs: number[],
): TimeStepMapping {
  const map: TimeStepMapping = new Map();
  map.set(runId, { relTimeSecs, steps });
  return map;
}

/** Build a TimeStepMapping from multiple runs */
function multiRunMapping(
  entries: Array<{
    runId: string;
    steps: number[];
    relTimeSecs: number[];
  }>,
): TimeStepMapping {
  const map: TimeStepMapping = new Map();
  for (const { runId, steps, relTimeSecs } of entries) {
    map.set(runId, { relTimeSecs, steps });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Step mode
// ---------------------------------------------------------------------------

describe("translateZoomToStepRange — Step mode", () => {
  it("passes through integer step ranges unchanged", () => {
    expect(translateZoomToStepRange([100, 500], "Step")).toEqual([100, 500]);
  });

  it("floors min and ceils max for fractional steps", () => {
    expect(translateZoomToStepRange([100.3, 499.7], "Step")).toEqual([
      100, 500,
    ]);
  });

  it("returns null when range is null", () => {
    expect(translateZoomToStepRange(null, "Step")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Relative Time mode — single run
// ---------------------------------------------------------------------------

describe("translateZoomToStepRange — Relative Time, single run", () => {
  // Simulate a 1-hour training run: steps 0..10000 over 3600 seconds
  const mapping = singleRunMapping(
    "run-1",
    [0, 2500, 5000, 7500, 10000],
    [0, 900, 1800, 2700, 3600],
  );

  it("translates seconds to step range", () => {
    // Zoom to first 15 minutes (0–900s) → steps 0–2500
    const result = translateZoomToStepRange([0, 900], "Relative Time", mapping);
    expect(result).toEqual([0, 2500]);
  });

  it("translates mid-range seconds to steps", () => {
    // Zoom to 15min–45min (900–2700s) → steps 2500–7500
    const result = translateZoomToStepRange(
      [900, 2700],
      "Relative Time",
      mapping,
    );
    expect(result).toEqual([2500, 7500]);
  });

  it("interpolates between mapping points", () => {
    // Zoom to 450s (halfway between 0 and 900s) → step 1250 (halfway between 0 and 2500)
    // and 1350s (halfway between 900 and 1800s) → step 3750
    const result = translateZoomToStepRange(
      [450, 1350],
      "Relative Time",
      mapping,
    );
    expect(result).toEqual([Math.floor(1250), Math.ceil(3750)]);
  });

  it("clamps to first step when seconds are below data range", () => {
    // Zoom starts before data (negative seconds)
    const result = translateZoomToStepRange(
      [-100, 900],
      "Relative Time",
      mapping,
    );
    // -100 clamps to step 0 (first mapping point)
    expect(result![0]).toBe(0);
    expect(result![1]).toBe(2500);
  });

  it("clamps to last step when seconds exceed data range", () => {
    // Zoom extends beyond data (5000s, but run only goes to 3600s)
    const result = translateZoomToStepRange(
      [2700, 5000],
      "Relative Time",
      mapping,
    );
    expect(result![0]).toBe(7500);
    expect(result![1]).toBe(10000); // clamped to last step
  });

  it("returns null when mapping is empty", () => {
    const emptyMapping: TimeStepMapping = new Map();
    expect(
      translateZoomToStepRange([0, 900], "Relative Time", emptyMapping),
    ).toBeNull();
  });

  it("returns null when mapping is not provided", () => {
    expect(translateZoomToStepRange([0, 900], "Relative Time")).toBeNull();
    expect(
      translateZoomToStepRange([0, 900], "Relative Time", null),
    ).toBeNull();
  });

  it("returns null when range is null", () => {
    expect(translateZoomToStepRange(null, "Relative Time", mapping)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Relative Time mode — multi-run (comparison view)
// ---------------------------------------------------------------------------

describe("translateZoomToStepRange — Relative Time, multi-run", () => {
  it("takes the widest step range across runs", () => {
    // Run A: 10000 steps in 3600s (fast run)
    // Run B: 5000 steps in 3600s (slow run)
    const mapping = multiRunMapping([
      {
        runId: "run-a",
        steps: [0, 5000, 10000],
        relTimeSecs: [0, 1800, 3600],
      },
      {
        runId: "run-b",
        steps: [0, 2500, 5000],
        relTimeSecs: [0, 1800, 3600],
      },
    ]);

    // Zoom to first 30 minutes (0–1800s)
    // Run A: 0–1800s → steps 0–5000
    // Run B: 0–1800s → steps 0–2500
    // Should take the widest: [0, 5000]
    const result = translateZoomToStepRange(
      [0, 1800],
      "Relative Time",
      mapping,
    );
    expect(result).toEqual([0, 5000]);
  });

  it("handles runs with different time spans", () => {
    // Run A: 10000 steps in 1 hour
    // Run B: 200000 steps in 48 hours
    const mapping = multiRunMapping([
      {
        runId: "run-a",
        steps: [0, 10000],
        relTimeSecs: [0, 3600],
      },
      {
        runId: "run-b",
        steps: [0, 200000],
        relTimeSecs: [0, 172800],
      },
    ]);

    // Zoom to 0–1800s (first 30 min)
    // Run A: 0–1800s → steps 0–5000 (interpolated midpoint)
    // Run B: 0–1800s → steps 0–2083.33 (interpolated)
    const result = translateZoomToStepRange(
      [0, 1800],
      "Relative Time",
      mapping,
    );
    expect(result![0]).toBe(0);
    // widest max: run A gives 5000
    expect(result![1]).toBe(5000);
  });

  it("handles runs with non-uniform step-time relationship", () => {
    // Run with pauses: first 1000 steps take 10s, next 1000 take 3590s
    const mapping = singleRunMapping(
      "paused-run",
      [0, 1000, 2000],
      [0, 10, 3600],
    );

    // Zoom to 0–10s should map to 0–1000 steps (the fast initial phase)
    const result = translateZoomToStepRange(
      [0, 10],
      "Relative Time",
      mapping,
    );
    expect(result).toEqual([0, 1000]);

    // Zoom to 10–3600s should map to 1000–2000 steps (the slow phase)
    const result2 = translateZoomToStepRange(
      [10, 3600],
      "Relative Time",
      mapping,
    );
    expect(result2).toEqual([1000, 2000]);
  });

  it("skips runs with empty data in the mapping", () => {
    const mapping = multiRunMapping([
      {
        runId: "run-a",
        steps: [0, 5000, 10000],
        relTimeSecs: [0, 1800, 3600],
      },
      {
        runId: "run-empty",
        steps: [],
        relTimeSecs: [],
      },
    ]);

    const result = translateZoomToStepRange(
      [0, 1800],
      "Relative Time",
      mapping,
    );
    // Should still work using run-a's mapping
    expect(result).toEqual([0, 5000]);
  });
});

// ---------------------------------------------------------------------------
// Roundtrip: step → time → step
// ---------------------------------------------------------------------------

describe("translateZoomToStepRange — roundtrip consistency", () => {
  it("step → interpolate → Relative Time → translateZoomToStepRange roundtrips", () => {
    // Simulate: user zooms on a Step chart to [200, 800]
    // syncXScale translates to relative-time seconds via interpolate
    // Then useZoomRefetch translates back to steps via translateZoomToStepRange
    const steps = [0, 250, 500, 750, 1000];
    const relTimeSecs = [0, 15, 30, 45, 60];

    // Step 1: step → time (as done by syncXScale)
    const timeMin = interpolate(steps, relTimeSecs, 200);
    const timeMax = interpolate(steps, relTimeSecs, 800);

    // Step 2: time → step (as done by translateZoomToStepRange)
    const mapping = singleRunMapping("run-1", steps, relTimeSecs);
    const result = translateZoomToStepRange(
      [timeMin, timeMax],
      "Relative Time",
      mapping,
    );

    // Should approximately recover the original step range
    // Floor/ceil rounding means [200, 800] → [200, 800]
    expect(result![0]).toBe(200);
    expect(result![1]).toBe(800);
  });

  it("time → interpolate → Step → translateZoomToStepRange is identity", () => {
    // Simulate: user zooms on a Relative Time chart to [12, 48] seconds
    // syncXScale translates to steps via interpolate
    // Then useZoomRefetch on the step chart just passes through
    const steps = [0, 250, 500, 750, 1000];
    const relTimeSecs = [0, 15, 30, 45, 60];

    // Step 1: time → step (as done by syncXScale)
    const stepMin = interpolate(relTimeSecs, steps, 12);
    const stepMax = interpolate(relTimeSecs, steps, 48);

    // Step 2: step pass-through (as done by translateZoomToStepRange in Step mode)
    const result = translateZoomToStepRange([stepMin, stepMax], "Step");

    expect(result![0]).toBe(Math.floor(stepMin));
    expect(result![1]).toBe(Math.ceil(stepMax));

    // Verify the step values are approximately [200, 800]
    expect(result![0]).toBe(200);
    expect(result![1]).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// Unsupported modes
// ---------------------------------------------------------------------------

describe("translateZoomToStepRange — unsupported modes", () => {
  it("returns null for Absolute Time", () => {
    expect(
      translateZoomToStepRange([1000, 2000], "Absolute Time"),
    ).toBeNull();
  });

  it("returns null for custom metric name", () => {
    expect(
      translateZoomToStepRange([0.1, 0.5], "learning_rate"),
    ).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(translateZoomToStepRange([0, 100], "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real-world scenario: user complaint — can't zoom below 2hrs on long runs
// ---------------------------------------------------------------------------

describe("translateZoomToStepRange — long run deep zoom", () => {
  it("translates a 5-minute zoom on a 48-hour run", () => {
    // Simulates the user's scenario: 48-hour run, wants to zoom to first 5 minutes
    // Steps 0–200000 over 172800 seconds (48 hours)
    const mapping = singleRunMapping(
      "long-run",
      [0, 50000, 100000, 150000, 200000],
      [0, 43200, 86400, 129600, 172800],
    );

    // Zoom to first 5 minutes (0–300 seconds)
    const result = translateZoomToStepRange(
      [0, 300],
      "Relative Time",
      mapping,
    );

    // 300s out of 43200s (first segment) → step = 300/43200 * 50000 ≈ 347
    expect(result).not.toBeNull();
    expect(result![0]).toBe(0);
    expect(result![1]).toBeGreaterThan(0);
    expect(result![1]).toBeLessThan(1000); // should be a narrow step range
  });

  it("translates a 1-hour zoom on a 48-hour run", () => {
    const mapping = singleRunMapping(
      "long-run",
      [0, 50000, 100000, 150000, 200000],
      [0, 43200, 86400, 129600, 172800],
    );

    // Zoom to first hour (0–3600 seconds)
    const result = translateZoomToStepRange(
      [0, 3600],
      "Relative Time",
      mapping,
    );

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0);
    // 3600s / 43200s * 50000 ≈ 4167 steps
    expect(result![1]).toBeGreaterThan(4000);
    expect(result![1]).toBeLessThan(5000);
  });
});
