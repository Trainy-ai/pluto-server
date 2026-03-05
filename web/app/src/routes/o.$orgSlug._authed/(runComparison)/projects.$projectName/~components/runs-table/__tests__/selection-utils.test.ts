import { describe, it, expect } from "vitest";
import {
  computeRowSelection,
  filterToSelected,
  sortPinnedToTop,
} from "../selection-utils";
import type { Run } from "../../../~queries/list-runs";

// Minimal Run factory — only `id` matters for selection logic
function makeRun(id: string): Run {
  return {
    id,
    name: `run-${id}`,
    status: "COMPLETED",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Run;
}

function makeSelected(
  runs: Run[],
): Record<string, { run: Run; color: string }> {
  const map: Record<string, { run: Run; color: string }> = {};
  for (const run of runs) {
    map[run.id] = { run, color: "#ff0000" };
  }
  return map;
}

// ── filterToSelected ─────────────────────────────────────────────────────

describe("filterToSelected", () => {
  it("returns only selected runs preserving order", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C"), makeRun("D")];
    const selected = makeSelected([runs[0], runs[2]]); // A, C

    const result = filterToSelected(runs, selected);

    expect(result.map((r) => r.id)).toEqual(["A", "C"]);
  });

  it("returns empty array when nothing is selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    expect(filterToSelected(runs, {})).toEqual([]);
  });

  it("returns all runs when all are selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    const selected = makeSelected(runs);

    expect(filterToSelected(runs, selected).map((r) => r.id)).toEqual([
      "A",
      "B",
    ]);
  });
});

// ── computeRowSelection ──────────────────────────────────────────────────

describe("computeRowSelection", () => {
  it("marks correct indices in the unfiltered array", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C"), makeRun("D")];
    const selected = makeSelected([runs[0], runs[2]]); // A, C

    const result = computeRowSelection(runs, selected);

    // A is at index 0, C is at index 2
    expect(result).toEqual({ 0: true, 2: true });
  });

  it("returns empty when nothing is selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    expect(computeRowSelection(runs, {})).toEqual({});
  });

  it("returns empty when displayedRuns is empty", () => {
    expect(computeRowSelection([], makeSelected([makeRun("A")]))).toEqual({});
  });

  // ── THIS IS THE REGRESSION TEST ──────────────────────────────────────
  //
  // When "Display only selected" is ON, displayedRuns is a filtered subset.
  // The old bug used the unfiltered `runs` array for index computation,
  // which caused:
  //   1. Eye icons showing wrong state (wrong row marked selected)
  //   2. Series emphasis breaking (row.getIsSelected() returning false for
  //      actually-selected runs, so hover events were not dispatched)
  //   3. Shift-click range selection targeting wrong runs

  describe("with showOnlySelected filter active (regression)", () => {
    // Setup: 5 runs, 3 selected (A, C, E)
    const allRuns = [
      makeRun("A"),
      makeRun("B"),
      makeRun("C"),
      makeRun("D"),
      makeRun("E"),
    ];
    const selected = makeSelected([allRuns[0], allRuns[2], allRuns[4]]); // A, C, E
    const displayedRuns = filterToSelected(allRuns, selected); // [A, C, E]

    it("maps indices to the filtered array, not the original", () => {
      const result = computeRowSelection(displayedRuns, selected);

      // In displayedRuns: A=0, C=1, E=2 — all selected
      expect(result).toEqual({ 0: true, 1: true, 2: true });
    });

    it("OLD BUG: using allRuns would produce wrong indices", () => {
      // This demonstrates what the old code did — indices from allRuns
      const wrongResult = computeRowSelection(allRuns, selected);

      // allRuns: A=0, B=1(not selected), C=2, D=3(not selected), E=4
      expect(wrongResult).toEqual({ 0: true, 2: true, 4: true });

      // When table has only 3 rows (displayedRuns), index 2 maps to E (not C),
      // and index 4 doesn't exist at all. This causes:
      // - Row 1 (C) appears unselected → eye icon shows EyeOff
      // - Hovering row 1 (C) → row.getIsSelected() is false → no hover event
      //   → chart line for run C doesn't highlight (series emphasis broken)
      // - Row 2 (E) gets index 2's selection → shows selected
      //   but hovering it dispatches "E" while the selection record says
      //   row.getIsSelected() is true (but for wrong run in some edge cases)
    });

    it("every displayed row is correctly marked as selected", () => {
      const result = computeRowSelection(displayedRuns, selected);

      // Verify each row in the filtered view is marked selected
      displayedRuns.forEach((run, index) => {
        expect(result[index]).toBe(true);
        // This means row.getIsSelected() returns true for this row,
        // which means the onMouseEnter handler WILL dispatch the
        // "run-table-hover" event for series emphasis
      });
    });

    it("no indices beyond the displayed row count", () => {
      const result = computeRowSelection(displayedRuns, selected);

      const maxIndex = Math.max(...Object.keys(result).map(Number));
      expect(maxIndex).toBeLessThan(displayedRuns.length);
    });
  });

  describe("with showOnlySelected and partial deselection", () => {
    // User has A, C, E selected, then deselects C while filter is active
    const allRuns = [
      makeRun("A"),
      makeRun("B"),
      makeRun("C"),
      makeRun("D"),
      makeRun("E"),
    ];

    it("correctly reflects deselection in filtered view", () => {
      const selectedAfterDeselect = makeSelected([allRuns[0], allRuns[4]]); // A, E
      const displayed = filterToSelected(allRuns, selectedAfterDeselect); // [A, E]

      const result = computeRowSelection(displayed, selectedAfterDeselect);

      // A=0, E=1 — both selected in a 2-row table
      expect(result).toEqual({ 0: true, 1: true });
      expect(displayed.map((r) => r.id)).toEqual(["A", "E"]);
    });
  });

  describe("series emphasis precondition", () => {
    // The table's onMouseEnter handler only dispatches "run-table-hover"
    // when row.getIsSelected() returns true. row.getIsSelected() reads
    // from the rowSelection state, which is set to currentRowSelection.
    // If currentRowSelection has wrong indices, getIsSelected() returns
    // false for actually-selected runs → no emphasis event dispatched.

    it("all selected runs in filtered view have getIsSelected = true", () => {
      const allRuns = [
        makeRun("A"),
        makeRun("B"),
        makeRun("C"),
        makeRun("D"),
      ];
      const selected = makeSelected([allRuns[1], allRuns[3]]); // B, D
      const displayed = filterToSelected(allRuns, selected); // [B, D]

      const result = computeRowSelection(displayed, selected);

      // Simulate what TanStack Table does: row at index i is selected
      // if result[i] === true
      displayed.forEach((run, i) => {
        const isSelected = result[i] === true;
        expect(isSelected).toBe(true);
        // This means hovering this row would dispatch:
        //   new CustomEvent("run-table-hover", { detail: run.id })
        // If this assertion failed, hovering run.id would NOT highlight
        // its chart line — the exact bug the user reported.
      });
    });
  });
});

// ── sortPinnedToTop ─────────────────────────────────────────────────────

describe("sortPinnedToTop", () => {
  it("moves selected runs to the front, preserving order within each group", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C"), makeRun("D")];
    const selected = makeSelected([runs[1], runs[3]]); // B, D

    const { sorted, pinnedCount } = sortPinnedToTop(runs, selected);

    expect(sorted.map((r) => r.id)).toEqual(["B", "D", "A", "C"]);
    expect(pinnedCount).toBe(2);
  });

  it("returns original order when nothing is selected", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C")];

    const { sorted, pinnedCount } = sortPinnedToTop(runs, {});

    expect(sorted.map((r) => r.id)).toEqual(["A", "B", "C"]);
    expect(pinnedCount).toBe(0);
  });

  it("returns all runs as pinned when all are selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    const selected = makeSelected(runs);

    const { sorted, pinnedCount } = sortPinnedToTop(runs, selected);

    expect(sorted.map((r) => r.id)).toEqual(["A", "B"]);
    expect(pinnedCount).toBe(2);
  });

  it("handles single selected run", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C")];
    const selected = makeSelected([runs[2]]); // C

    const { sorted, pinnedCount } = sortPinnedToTop(runs, selected);

    expect(sorted.map((r) => r.id)).toEqual(["C", "A", "B"]);
    expect(pinnedCount).toBe(1);
  });

  it("handles empty runs array", () => {
    const { sorted, pinnedCount } = sortPinnedToTop(
      [],
      makeSelected([makeRun("A")]),
    );

    expect(sorted).toEqual([]);
    expect(pinnedCount).toBe(0);
  });
});
