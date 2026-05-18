import { describe, it, expect, beforeAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { getColorForRun, useSelectedRuns } from "../use-selected-runs";
import { COLORS } from "@/components/ui/color-picker";
import type { Run } from "../../~queries/list-runs";

// jsdom doesn't implement matchMedia; stub it out for hooks that use useTheme
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

describe("useSelectedRuns", () => {
  describe("getColorForRun", () => {
    it("returns consistent color for the same runId", () => {
      const runId = "run-123";
      const color1 = getColorForRun(runId, COLORS);
      const color2 = getColorForRun(runId, COLORS);
      const color3 = getColorForRun(runId, COLORS);

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
        colors.add(getColorForRun(runId, COLORS));
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
        const color = getColorForRun(runId, COLORS);
        expect(COLORS).toContain(color);
      }
    });

    it("handles edge case run IDs", () => {
      // Empty string
      const emptyColor = getColorForRun("", COLORS);
      expect(COLORS).toContain(emptyColor);

      // Single character
      const singleCharColor = getColorForRun("a", COLORS);
      expect(COLORS).toContain(singleCharColor);

      // Numeric string
      const numericColor = getColorForRun("12345", COLORS);
      expect(COLORS).toContain(numericColor);

      // Special characters
      const specialColor = getColorForRun("run-with-dashes_and_underscores.and.dots", COLORS);
      expect(COLORS).toContain(specialColor);

      // UUID-like
      const uuidColor = getColorForRun("550e8400-e29b-41d4-a716-446655440000", COLORS);
      expect(COLORS).toContain(uuidColor);
    });

    it("produces good distribution across colors", () => {
      // Generate colors for many run IDs and check distribution
      const colorCounts = new Map<string, number>();
      const numRuns = 100;

      for (let i = 0; i < numRuns; i++) {
        const color = getColorForRun(`run-${i}`, COLORS);
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
      const first = getColorForRun(runId, COLORS);
      getColorForRun("other-run-1", COLORS);
      getColorForRun("other-run-2", COLORS);
      const second = getColorForRun(runId, COLORS);
      getColorForRun("yet-another-run", COLORS);
      const third = getColorForRun(runId, COLORS);

      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });
});

function makeRun(id: string, name = `run-${id}`): Run {
  return {
    id,
    name,
    displayId: `TES-${id}`,
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    notes: null,
    _flatConfig: {},
    _flatSystemMetadata: {},
  } as unknown as Run;
}

describe("handleRunSelection — runFallback parameter", () => {
  it("2-arg call with id NOT in runs is a no-op (preserves existing behavior)", () => {
    const runs = [makeRun("A"), makeRun("B")];
    const { result } = renderHook(() =>
      useSelectedRuns(runs, "org-1", "proj-1", { urlRunIds: [], urlHiddenIds: [] }),
    );

    act(() => {
      result.current.handleRunSelection("C", true);
    });

    expect(result.current.selectedRunsWithColors["C"]).toBeUndefined();
  });

  it("3-arg call with id NOT in runs uses runFallback", () => {
    const runs = [makeRun("A"), makeRun("B")];
    const fallback = makeRun("C");
    const { result } = renderHook(() =>
      useSelectedRuns(runs, "org-1", "proj-1", { urlRunIds: [], urlHiddenIds: [] }),
    );

    act(() => {
      result.current.handleRunSelection("C", true, fallback);
    });

    expect(result.current.selectedRunsWithColors["C"]).toBeDefined();
    expect(result.current.selectedRunsWithColors["C"].run.id).toBe("C");
  });

  it("3-arg call with id IN runs uses the version from runs (not fallback)", () => {
    const liveRun = makeRun("A", "live-name");
    const staleFallback = makeRun("A", "stale-name");
    const runs = [liveRun];
    const { result } = renderHook(() =>
      useSelectedRuns(runs, "org-1", "proj-1", { urlRunIds: [], urlHiddenIds: [] }),
    );

    act(() => {
      result.current.handleRunSelection("A", true, staleFallback);
    });

    expect(result.current.selectedRunsWithColors["A"].run.name).toBe("live-name");
  });

  it("deselect ignores runFallback (no lookup needed)", () => {
    const runs = [makeRun("A")];
    const { result } = renderHook(() =>
      useSelectedRuns(runs, "org-1", "proj-1", { urlRunIds: [], urlHiddenIds: [] }),
    );

    act(() => {
      result.current.handleRunSelection("A", true);
    });
    expect(result.current.selectedRunsWithColors["A"]).toBeDefined();

    act(() => {
      result.current.handleRunSelection("A", false, makeRun("A"));
    });
    expect(result.current.selectedRunsWithColors["A"]).toBeUndefined();
  });
});
