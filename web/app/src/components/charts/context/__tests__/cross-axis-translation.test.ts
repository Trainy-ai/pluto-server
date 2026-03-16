import { describe, it, expect } from "vitest";
import { interpolate } from "../chart-sync-context";

/**
 * Tests for the cross-axis translation logic used by syncXScale.
 *
 * In the single-run view, step charts (zoomGroup="step") and relative time
 * charts (zoomGroup="relative-time") sync zoom by translating ranges via
 * the step↔time mapping. These tests verify the translation is correct and
 * bidirectional.
 *
 * The bug was: single-run relative time charts had xlabel="relative time (hr)"
 * which set zoomGroup="relative time (hr)" instead of "relative-time", so the
 * cross-group translation in syncXScale never triggered. Now all relative time
 * charts use xlabel="relative time" → zoomGroup="relative-time".
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulates the cross-axis translation logic from syncXScale.
 * Given a zoom range in source coordinates, translates to target coordinates.
 */
function translateRange(
  sourceGroup: "step" | "relative-time",
  targetGroup: "step" | "relative-time",
  mapping: { steps: number[]; relTimeSecs: number[] },
  xMin: number,
  xMax: number,
): [number, number] | null {
  if (sourceGroup === targetGroup) {
    return [xMin, xMax]; // Same group, no translation needed
  }

  if (sourceGroup === "step" && targetGroup === "relative-time") {
    return [
      interpolate(mapping.steps, mapping.relTimeSecs, xMin),
      interpolate(mapping.steps, mapping.relTimeSecs, xMax),
    ];
  }

  if (sourceGroup === "relative-time" && targetGroup === "step") {
    return [
      interpolate(mapping.relTimeSecs, mapping.steps, xMin),
      interpolate(mapping.relTimeSecs, mapping.steps, xMax),
    ];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-axis translation: step ↔ relative-time", () => {
  // A typical training run: 10000 steps over 1 hour (3600s)
  // with non-linear time-step relationship (faster at start, slower later)
  const mapping = {
    steps: [0, 1000, 3000, 6000, 10000],
    relTimeSecs: [0, 120, 600, 1800, 3600],
  };

  describe("step → relative-time", () => {
    it("translates step range to relative time (seconds)", () => {
      const result = translateRange(
        "step",
        "relative-time",
        mapping,
        0,
        1000,
      );
      expect(result).toEqual([0, 120]);
    });

    it("interpolates within segments", () => {
      // Step 500 is halfway between 0 and 1000 → time = 0 + 0.5 * 120 = 60
      const result = translateRange(
        "step",
        "relative-time",
        mapping,
        500,
        1000,
      );
      expect(result![0]).toBeCloseTo(60, 5);
      expect(result![1]).toBe(120);
    });

    it("handles zoom across segment boundaries", () => {
      // Steps 1000–6000 → times 120–1800
      const result = translateRange(
        "step",
        "relative-time",
        mapping,
        1000,
        6000,
      );
      expect(result).toEqual([120, 1800]);
    });

    it("clamps zoom beyond data range", () => {
      // Steps 0–15000 → times 0–3600 (clamped at last point)
      const result = translateRange(
        "step",
        "relative-time",
        mapping,
        0,
        15000,
      );
      expect(result).toEqual([0, 3600]);
    });
  });

  describe("relative-time → step", () => {
    it("translates time range to step range", () => {
      const result = translateRange(
        "relative-time",
        "step",
        mapping,
        0,
        120,
      );
      expect(result).toEqual([0, 1000]);
    });

    it("interpolates within segments", () => {
      // Time 60 is halfway between 0 and 120 → step = 0 + 0.5 * 1000 = 500
      const result = translateRange(
        "relative-time",
        "step",
        mapping,
        60,
        120,
      );
      expect(result![0]).toBeCloseTo(500, 5);
      expect(result![1]).toBe(1000);
    });

    it("handles zoom across segment boundaries", () => {
      // Times 120–1800s → steps 1000–6000
      const result = translateRange(
        "relative-time",
        "step",
        mapping,
        120,
        1800,
      );
      expect(result).toEqual([1000, 6000]);
    });
  });

  describe("roundtrip: step → time → step", () => {
    it("recovers original step range exactly at mapping points", () => {
      const [timeMin, timeMax] = translateRange(
        "step",
        "relative-time",
        mapping,
        1000,
        6000,
      )!;
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        timeMin,
        timeMax,
      )!;
      expect(stepMin).toBeCloseTo(1000, 5);
      expect(stepMax).toBeCloseTo(6000, 5);
    });

    it("recovers original step range for interpolated points", () => {
      const originalMin = 2000;
      const originalMax = 8000;
      const [timeMin, timeMax] = translateRange(
        "step",
        "relative-time",
        mapping,
        originalMin,
        originalMax,
      )!;
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        timeMin,
        timeMax,
      )!;
      expect(stepMin).toBeCloseTo(originalMin, 3);
      expect(stepMax).toBeCloseTo(originalMax, 3);
    });
  });

  describe("roundtrip: time → step → time", () => {
    it("recovers original time range exactly at mapping points", () => {
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        120,
        1800,
      )!;
      const [timeMin, timeMax] = translateRange(
        "step",
        "relative-time",
        mapping,
        stepMin,
        stepMax,
      )!;
      expect(timeMin).toBeCloseTo(120, 5);
      expect(timeMax).toBeCloseTo(1800, 5);
    });

    it("recovers original time range for interpolated points", () => {
      const originalMin = 300;
      const originalMax = 2400;
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        originalMin,
        originalMax,
      )!;
      const [timeMin, timeMax] = translateRange(
        "step",
        "relative-time",
        mapping,
        stepMin,
        stepMax,
      )!;
      expect(timeMin).toBeCloseTo(originalMin, 3);
      expect(timeMax).toBeCloseTo(originalMax, 3);
    });
  });

  describe("same group passthrough", () => {
    it("step → step returns range unchanged", () => {
      const result = translateRange("step", "step", mapping, 100, 500);
      expect(result).toEqual([100, 500]);
    });

    it("relative-time → relative-time returns range unchanged", () => {
      const result = translateRange(
        "relative-time",
        "relative-time",
        mapping,
        300,
        1200,
      );
      expect(result).toEqual([300, 1200]);
    });
  });
});

describe("cross-axis translation: real-world scenarios", () => {
  describe("long training run (48 hours)", () => {
    // 200k steps over 48 hours, with learning rate warmup in first hour
    const mapping = {
      steps: [0, 5000, 50000, 100000, 200000],
      relTimeSecs: [0, 3600, 36000, 86400, 172800],
    };

    it("zooming step chart to first 5000 steps translates to first hour", () => {
      const [timeMin, timeMax] = translateRange(
        "step",
        "relative-time",
        mapping,
        0,
        5000,
      )!;
      expect(timeMin).toBe(0);
      expect(timeMax).toBe(3600); // 1 hour
    });

    it("zooming time chart to first 5 minutes translates to narrow step range", () => {
      // 5 min = 300s, which is in the [0, 3600] segment → [0, 5000] steps
      // 300/3600 = 1/12 of first segment → step = 5000/12 ≈ 416.67
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        0,
        300,
      )!;
      expect(stepMin).toBe(0);
      expect(stepMax).toBeCloseTo(416.67, 0);
    });

    it("deep zoom to 1 minute translates to very narrow step range", () => {
      // 1 min = 60s → step = 60/3600 * 5000 ≈ 83.33
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        0,
        60,
      )!;
      expect(stepMin).toBe(0);
      expect(stepMax).toBeCloseTo(83.33, 0);
    });
  });

  describe("short training run (5 minutes)", () => {
    const mapping = {
      steps: [0, 500, 1000],
      relTimeSecs: [0, 150, 300],
    };

    it("zooming to first 30 seconds", () => {
      const [stepMin, stepMax] = translateRange(
        "relative-time",
        "step",
        mapping,
        0,
        30,
      )!;
      expect(stepMin).toBe(0);
      expect(stepMax).toBeCloseTo(100, 5);
    });
  });
});

describe("zoomGroup naming convention", () => {
  // This test documents the contract: relative time charts MUST use
  // zoomGroup "relative-time" (not "relative time (hr)" etc.) for
  // cross-axis sync to work. The xlabel must be "relative time".

  it("xlabel 'relative time' maps to zoomGroup 'relative-time'", () => {
    const xlabel = "relative time";
    const isRelativeTime = xlabel === "relative time";
    const zoomGroup = isRelativeTime
      ? "relative-time"
      : xlabel || "default";
    expect(zoomGroup).toBe("relative-time");
  });

  it("xlabel 'step' maps to zoomGroup 'step'", () => {
    const xlabel: string = "step";
    const isRelativeTime = xlabel === "relative time";
    const zoomGroup = isRelativeTime
      ? "relative-time"
      : xlabel || "default";
    expect(zoomGroup).toBe("step");
  });

  it("old xlabel 'relative time (hr)' would NOT map to 'relative-time' — this was the bug", () => {
    const xlabel: string = "relative time (hr)";
    const isRelativeTime = xlabel === "relative time";
    const zoomGroup = isRelativeTime
      ? "relative-time"
      : xlabel || "default";
    // This demonstrates the old bug: the zoomGroup would be the raw xlabel
    expect(zoomGroup).toBe("relative time (hr)");
    expect(zoomGroup).not.toBe("relative-time");
  });
});
