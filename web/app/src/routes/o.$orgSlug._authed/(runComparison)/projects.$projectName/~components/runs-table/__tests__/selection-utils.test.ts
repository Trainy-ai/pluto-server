import { describe, it, expect } from "vitest";
import {
  computeRowSelection,
  filterToSelected,
  sortPinnedToTop,
  mergeSelectedRuns,
  ensureSelectedRunsIncluded,
  intersectWithServerFilter,
  partitionMatchingFirst,
} from "../selection-utils";
import type { Run } from "../../../~queries/list-runs";
import { makeRun } from "./_fixtures";

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
  it("marks correct run IDs as selected", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C"), makeRun("D")];
    const selected = makeSelected([runs[0], runs[2]]); // A, C

    const result = computeRowSelection(runs, selected);

    expect(result).toEqual({ A: true, C: true });
  });

  it("returns empty when nothing is selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    expect(computeRowSelection(runs, {})).toEqual({});
  });

  it("returns empty when displayedRuns is empty", () => {
    expect(computeRowSelection([], makeSelected([makeRun("A")]))).toEqual({});
  });

  // ── REGRESSION TEST ────────────────────────────────────────────────────
  //
  // When "Display only selected" is ON, displayedRuns is a filtered subset.
  // Selection keys are run IDs (matching getRowId), so they work correctly
  // regardless of the subset or ordering.

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

    it("maps run IDs correctly in the filtered array", () => {
      const result = computeRowSelection(displayedRuns, selected);

      expect(result).toEqual({ A: true, C: true, E: true });
    });

    it("produces same keys whether using filtered or full array", () => {
      // With ID-based keys, both arrays produce the same selection for
      // the selected runs (unlike the old index-based approach)
      const filteredResult = computeRowSelection(displayedRuns, selected);
      const fullResult = computeRowSelection(allRuns, selected);

      expect(filteredResult).toEqual({ A: true, C: true, E: true });
      expect(fullResult).toEqual({ A: true, C: true, E: true });
    });

    it("every displayed run is correctly marked as selected", () => {
      const result = computeRowSelection(displayedRuns, selected);

      // With getRowId, row.getIsSelected() looks up result[run.id]
      displayedRuns.forEach((run) => {
        expect(result[run.id]).toBe(true);
      });
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

      expect(result).toEqual({ A: true, E: true });
      expect(displayed.map((r) => r.id)).toEqual(["A", "E"]);
    });
  });

  describe("series emphasis precondition", () => {
    // The table's onMouseEnter handler only dispatches "run-table-hover"
    // when row.getIsSelected() returns true. With getRowId: (row) => row.id,
    // row.getIsSelected() reads from rowSelection[row.id].

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

      // Simulate what TanStack Table does with getRowId:
      // row.getIsSelected() checks result[row.id]
      displayed.forEach((run) => {
        const isSelected = result[run.id] === true;
        expect(isSelected).toBe(true);
      });
    });
  });
});

// ── mergeSelectedRuns ────────────────────────────────────────────────────

describe("mergeSelectedRuns", () => {
  it("returns only selected runs when all selected runs are on the current page", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C")];
    const selected = makeSelected([runs[0], runs[2]]); // A, C — both in runs

    const result = mergeSelectedRuns(runs, selected);

    expect(result.map((r) => r.id)).toEqual(["A", "C"]);
  });

  it("includes selected runs not present in paginated runs array", () => {
    const paginatedRuns = [makeRun("A"), makeRun("B")];
    const outsideRun = makeRun("X");
    const selected = makeSelected([paginatedRuns[0], outsideRun]); // A in page, X outside

    const result = mergeSelectedRuns(paginatedRuns, selected);

    // Should include both A (from page) and X (from selection)
    const ids = result.map((r) => r.id);
    expect(ids).toContain("A");
    expect(ids).toContain("X");
    expect(ids).toHaveLength(2);
  });

  it("returns all selected runs even when paginated runs is empty", () => {
    const outsideRuns = [makeRun("X"), makeRun("Y")];
    const selected = makeSelected(outsideRuns);

    const result = mergeSelectedRuns([], selected);

    expect(result.map((r) => r.id)).toEqual(["X", "Y"]);
  });

  it("returns empty array when nothing is selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    const result = mergeSelectedRuns(runs, {});
    expect(result).toEqual([]);
  });

  it("preserves paginated order for runs in page, appends others", () => {
    const paginatedRuns = [makeRun("C"), makeRun("A"), makeRun("B")];
    const outsideRun = makeRun("Z");
    const selected = makeSelected([paginatedRuns[0], paginatedRuns[2], outsideRun]); // C, B in page; Z outside

    const result = mergeSelectedRuns(paginatedRuns, selected);

    // C and B should maintain their relative order from paginated array
    // Z should be appended
    const ids = result.map((r) => r.id);
    expect(ids.indexOf("C")).toBeLessThan(ids.indexOf("B"));
    expect(ids).toContain("Z");
    expect(ids).toHaveLength(3);
  });
});

// ── ensureSelectedRunsIncluded ────────────────────────────────────────────

describe("ensureSelectedRunsIncluded", () => {
  it("returns same array reference when all selected runs already present", () => {
    const runs = [makeRun("A"), makeRun("B"), makeRun("C")];
    const selected = makeSelected([runs[0], runs[2]]); // A, C — both in runs

    const result = ensureSelectedRunsIncluded(runs, selected);

    expect(result).toBe(runs); // same reference
  });

  it("appends selected runs not in paginated array (cross-page selection bug)", () => {
    const paginatedRuns = [makeRun("A"), makeRun("B")];
    const outsideRun = makeRun("X");
    const selected = makeSelected([paginatedRuns[0], outsideRun]); // A in page, X outside

    const result = ensureSelectedRunsIncluded(paginatedRuns, selected);

    expect(result.map((r) => r.id)).toEqual(["A", "B", "X"]);
  });

  it("returns runs unchanged when nothing is selected", () => {
    const runs = [makeRun("A"), makeRun("B")];
    const result = ensureSelectedRunsIncluded(runs, {});

    expect(result).toBe(runs); // same reference
  });

  it("preserves original run order, appends missing at end", () => {
    const paginatedRuns = [makeRun("C"), makeRun("A"), makeRun("B")];
    const outsideRuns = [makeRun("Z"), makeRun("Y")];
    const selected = makeSelected([paginatedRuns[0], ...outsideRuns]); // C in page; Z, Y outside

    const result = ensureSelectedRunsIncluded(paginatedRuns, selected);

    // Original order preserved, missing appended
    expect(result.map((r) => r.id)).toEqual(["C", "A", "B", "Z", "Y"]);
  });

  it("regression: computeRowSelection produces valid key for every selected run", () => {
    // Simulates: user searches for run "X", selects it, clears search.
    // Page now shows [A, B, C] but "X" is selected from a different page.
    const paginatedRuns = [makeRun("A"), makeRun("B"), makeRun("C")];
    const outsideRun = makeRun("X");
    const selected = makeSelected([outsideRun]);

    const displayed = ensureSelectedRunsIncluded(paginatedRuns, selected);
    const rowSelection = computeRowSelection(displayed, selected);

    // X should be appended and marked selected by ID
    expect(displayed.map((r) => r.id)).toEqual(["A", "B", "C", "X"]);
    expect(rowSelection["X"]).toBe(true);

    // Every selected run must have a valid entry — this is the precondition
    // for row.getIsSelected() to return true, which enables hover emphasis
    const selectedIds = new Set(Object.keys(selected));
    displayed.forEach((run) => {
      if (selectedIds.has(run.id)) {
        expect(rowSelection[run.id]).toBe(true);
      }
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

// ── intersectWithServerFilter ────────────────────────────────────────────

describe("intersectWithServerFilter", () => {
  it("returns runs unchanged when serverFilteredRunIds is undefined", () => {
    // Query hasn't landed yet — degrade to pre-filter view, don't hide
    // everything.
    const runs = [makeRun("A"), makeRun("B")];
    expect(intersectWithServerFilter(runs, undefined)).toBe(runs);
  });

  it("drops runs whose id isn't in the server-filtered set", () => {
    // Regression: `runs` is really allVisibleRuns which merges getByIds
    // prefetch + IndexedDB — selected non-matching rows survived if we
    // just returned runs on the filter-alone branch.
    const A = makeRun("A"), B = makeRun("B"), C = makeRun("C");
    const set = new Set(["A", "C"]);
    expect(intersectWithServerFilter([A, B, C], set)).toEqual([A, C]);
  });

  it("preserves input order among the kept runs", () => {
    const A = makeRun("A"), B = makeRun("B"), C = makeRun("C"), D = makeRun("D");
    const set = new Set(["D", "B"]); // order in the set is irrelevant
    expect(intersectWithServerFilter([A, B, C, D], set).map((r) => r.id)).toEqual(["B", "D"]);
  });

  it("returns empty when no run matches", () => {
    const runs = [makeRun("A"), makeRun("B")];
    expect(intersectWithServerFilter(runs, new Set(["Z"]))).toEqual([]);
  });

  it("returns empty when the filter set is empty (server matched nothing)", () => {
    // Distinct from `undefined` (unloaded) — empty set means the filter
    // matched zero runs and the table should render empty.
    const runs = [makeRun("A"), makeRun("B")];
    expect(intersectWithServerFilter(runs, new Set())).toEqual([]);
  });
});

// ── partitionMatchingFirst ───────────────────────────────────────────────

describe("partitionMatchingFirst", () => {
  it("returns runs unchanged when serverFilteredRunIds is undefined", () => {
    const runs = [makeRun("A"), makeRun("B")];
    expect(partitionMatchingFirst(runs, undefined)).toBe(runs);
  });

  it("returns runs unchanged when the set is empty (no filter → no partition)", () => {
    const runs = [makeRun("A"), makeRun("B")];
    expect(partitionMatchingFirst(runs, new Set())).toBe(runs);
  });

  it("promotes matching rows to the front, preserving relative order within each half", () => {
    // Sort-desc by some column produced [B_bs=512, C_bs=256, A_bs=128,
    // D_bs=64] where B and A happen to be filter-matching. Regression
    // fix (d41271d30): without this promotion, pageSize=2 would slice
    // out [B, C] on page 1 and A would land on page 2 — divider then
    // fires at row 2 with 1 matched visible instead of 2.
    const A = makeRun("A"), B = makeRun("B"), C = makeRun("C"), D = makeRun("D");
    const sorted = [B, C, A, D];
    const result = partitionMatchingFirst(sorted, new Set(["A", "B"]));
    expect(result.map((r) => r.id)).toEqual(["B", "A", "C", "D"]);
  });

  it("all matched → returns matched-only slice (no unmatched appended)", () => {
    const A = makeRun("A"), B = makeRun("B");
    expect(partitionMatchingFirst([A, B], new Set(["A", "B"])).map((r) => r.id)).toEqual(["A", "B"]);
  });

  it("all unmatched → returns unmatched-only slice (matched half empty)", () => {
    const A = makeRun("A"), B = makeRun("B");
    expect(partitionMatchingFirst([A, B], new Set(["Z"])).map((r) => r.id)).toEqual(["A", "B"]);
  });

  it("returns empty when runs is empty regardless of set contents", () => {
    expect(partitionMatchingFirst([], new Set(["A"]))).toEqual([]);
  });

  it("is stable — equal partitions preserve original order", () => {
    // Both halves retain the incoming order so downstream pagination
    // walks the user's sort within each half.
    const runs = ["A", "B", "C", "D", "E", "F"].map((id) => makeRun(id));
    const result = partitionMatchingFirst(runs, new Set(["B", "E", "A"]));
    expect(result.map((r) => r.id)).toEqual(["A", "B", "E", "C", "D", "F"]);
  });
});
