import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { excludeRun, withExactMatchFirst } from "../lib/pinned-rows";
import { useDataTableState } from "../hooks/use-data-table-state";
import type { Run } from "../../../~queries/list-runs";
import { makeRun } from "./_fixtures";

const ids = (runs: Run[]) => runs.map((r) => r.id);

function selected(runs: Run[]): Record<string, { run: Run; color: string }> {
  return Object.fromEntries(runs.map((run) => [run.id, { run, color: "#000" }]));
}

describe("withExactMatchFirst", () => {
  it("puts the exact match ahead of the selected pins", () => {
    expect(ids(withExactMatchFirst([makeRun("a"), makeRun("b")], makeRun("x")))).toEqual(["x", "a", "b"]);
  });

  it("keeps a selected exact match to one row, at the top", () => {
    expect(ids(withExactMatchFirst([makeRun("a"), makeRun("x")], makeRun("x")))).toEqual(["x", "a"]);
  });

  it("returns the selected pins unchanged without an exact match", () => {
    const pinned = [makeRun("a"), makeRun("b")];
    expect(withExactMatchFirst(pinned, null)).toBe(pinned);
  });
});

describe("excludeRun", () => {
  it("drops the exact match from the page list", () => {
    expect(ids(excludeRun([makeRun("a"), makeRun("x"), makeRun("b")], makeRun("x")))).toEqual(["a", "b"]);
  });

  it("returns the list unchanged without an exact match", () => {
    const runs = [makeRun("a")];
    expect(excludeRun(runs, null)).toBe(runs);
  });
});

interface Scenario {
  runs: Run[];
  selectedRuns?: Run[];
  pinSelectedToTop?: boolean;
  exactMatchRun?: Run | null;
  pageSize?: number;
  listMode?: "runs" | "experiments";
}

function renderState({ runs, selectedRuns = [], pinSelectedToTop = false, exactMatchRun = null, pageSize = 4, listMode }: Scenario) {
  const { result } = renderHook(() =>
    useDataTableState({
      runs,
      selectedRunsWithColors: selected(selectedRuns),
      customColumns: [],
      filters: [],
      searchQuery: "T0-7",
      sorting: [],
      pageSize,
      onPageSizeChange: () => {},
      memoizedColumns: [],
      pinnedColumnIds: new Set(),
      orgSlug: "org",
      projectName: "proj",
      showOnlySelected: false,
      pinSelectedToTop,
      onPinSelectedToTopChange: () => {},
      exactMatchRun,
      listMode,
    }),
  );
  return result.current;
}

describe("useDataTableState with an exact display-ID match", () => {
  const page = ["a", "b", "c", "d", "e", "f"].map((id) => makeRun(id));

  it("pins the exact run above the page and keeps it out of the page list", () => {
    const state = renderState({ runs: [...page, makeRun("x")], exactMatchRun: makeRun("x") });

    expect(ids(state.pinnedRuns)).toEqual(["x"]);
    expect(ids(state.displayedRuns)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(state.showPinnedBlock).toBe(true);
    expect(state.isPinningActive).toBe(false);
    expect(state.effectivePageSize).toBe(3);
    expect(state.table.getRowModel().rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("folds a loaded ancestor into an off-page exact tip in experiments mode", () => {
    const state = renderState({
      runs: [makeRun("a"), makeRun("p"), makeRun("b")],
      exactMatchRun: makeRun("x", { forkedFromRunId: "p" }),
      listMode: "experiments",
    });

    expect(state.pinnedTable.getRowModel().rows.map((r) => r.id)).toEqual(["x"]);
    expect(state.table.getRowModel().rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("pins the exact run even when it is not in the fetched pages", () => {
    const state = renderState({ runs: page, exactMatchRun: makeRun("x") });

    expect(state.pinnedTable.getRowModel().rows.map((r) => r.id)).toEqual(["x"]);
    expect(ids(state.displayedRuns)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("leads the selected pins under pin-selected-to-top and counts toward the page", () => {
    const state = renderState({
      runs: page,
      selectedRuns: [page[0], page[1]],
      pinSelectedToTop: true,
      exactMatchRun: makeRun("x"),
    });

    expect(ids(state.pinnedRuns)).toEqual(["x", "a", "b"]);
    expect(ids(state.displayedRuns)).toEqual(["c", "d", "e", "f"]);
    expect(state.effectivePageSize).toBe(1);
    expect(state.deselectablePageRunIds).toEqual(["a", "b"]);
  });

  it("renders a selected exact run once, at the top", () => {
    const state = renderState({
      runs: page,
      selectedRuns: [page[1], page[3]],
      pinSelectedToTop: true,
      exactMatchRun: page[3],
    });

    expect(ids(state.pinnedRuns)).toEqual(["d", "b"]);
    expect(ids(state.displayedRuns)).toEqual(["a", "c", "e", "f"]);
    expect(state.effectivePageSize).toBe(2);
  });

  it("leaves selected runs unpinned when only the exact match is pinned", () => {
    const state = renderState({ runs: page, selectedRuns: [page[2]], exactMatchRun: makeRun("x") });

    expect(ids(state.pinnedRuns)).toEqual(["x"]);
    expect(ids(state.displayedRuns)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(state.deselectablePageRunIds).toEqual(["a", "b", "c"]);
  });

  it("is unchanged without an exact match", () => {
    const state = renderState({ runs: page });

    expect(ids(state.pinnedRuns)).toEqual([]);
    expect(state.showPinnedBlock).toBe(false);
    expect(state.effectivePageSize).toBe(4);
    expect(state.table.getRowModel().rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});
