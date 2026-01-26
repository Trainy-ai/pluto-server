import { describe, it, expect } from "vitest";
import { getColorForRun } from "../use-selected-runs";
import { COLORS } from "@/components/ui/color-picker";

describe("useSelectedRuns", () => {
  describe("getColorForRun", () => {
    it("returns consistent color for the same runId", () => {
      const runId = "run-123";
      const color1 = getColorForRun(runId);
      const color2 = getColorForRun(runId);
      const color3 = getColorForRun(runId);

      expect(color1).toBe(color2);
      expect(color2).toBe(color3);
    });

    it("returns different colors for different runIds", () => {
      const colors = new Set<string>();
      const runIds = [
        "run-1",
        "run-2",
        "run-3",
        "run-4",
        "run-5",
        "experiment-001",
        "experiment-002",
        "test-abc",
        "test-xyz",
        "training-run-alpha",
      ];

      for (const runId of runIds) {
        colors.add(getColorForRun(runId));
      }

      // At least 5 different colors from 10 different runs
      // (some collision is expected with hash-based approach)
      expect(colors.size).toBeGreaterThanOrEqual(5);
    });

    it("returns a color from the COLORS palette", () => {
      const testRunIds = [
        "run-1",
        "run-abc",
        "test-123",
        "experiment-xyz",
        "my-run",
        "another-run-id",
        "12345",
        "a",
        "very-long-run-id-with-many-characters",
      ];

      for (const runId of testRunIds) {
        const color = getColorForRun(runId);
        expect(COLORS).toContain(color);
      }
    });

    it("handles edge case run IDs", () => {
      // Empty string
      const emptyColor = getColorForRun("");
      expect(COLORS).toContain(emptyColor);

      // Single character
      const singleCharColor = getColorForRun("a");
      expect(COLORS).toContain(singleCharColor);

      // Numeric string
      const numericColor = getColorForRun("12345");
      expect(COLORS).toContain(numericColor);

      // Special characters
      const specialColor = getColorForRun("run-with-dashes_and_underscores.and.dots");
      expect(COLORS).toContain(specialColor);

      // UUID-like
      const uuidColor = getColorForRun("550e8400-e29b-41d4-a716-446655440000");
      expect(COLORS).toContain(uuidColor);
    });

    it("produces good distribution across colors", () => {
      // Generate colors for many run IDs and check distribution
      const colorCounts = new Map<string, number>();
      const numRuns = 100;

      for (let i = 0; i < numRuns; i++) {
        const color = getColorForRun(`run-${i}`);
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
      }

      // Should use a reasonable variety of colors (at least 10 different colors)
      expect(colorCounts.size).toBeGreaterThanOrEqual(10);

      // No single color should dominate (no more than 20% of runs)
      for (const count of colorCounts.values()) {
        expect(count).toBeLessThanOrEqual(numRuns * 0.2);
      }
    });

    it("is deterministic based on run ID content, not order", () => {
      const runId = "specific-run-id";

      // Call in different orders with other runs in between
      const first = getColorForRun(runId);
      getColorForRun("other-run-1");
      getColorForRun("other-run-2");
      const second = getColorForRun(runId);
      getColorForRun("yet-another-run");
      const third = getColorForRun(runId);

      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });
});
