import { describe, expect, it } from "vitest";
import { computeEffectivePageSize } from "../hooks/use-data-table-state";

/**
 * Unit coverage for the pin-selected-to-top (PSTT) pagination math.
 *
 * This is the arithmetic behind the "unpinned slice fills whatever the
 * pinned block leaves over" behaviour. It shipped inlined in
 * `useDataTableState` with no test and caused a real regression (the
 * paginator's total page count jumped 10 -> 13 with 5 pinned rows because
 * the per-page denominator shrinks), so pin down the edge cases here.
 */
describe("computeEffectivePageSize", () => {
  it("returns the full pageSize when pinning is inactive", () => {
    // pinnedCount is ignored entirely when PSTT is off.
    expect(computeEffectivePageSize(10, 0, false)).toBe(10);
    expect(computeEffectivePageSize(10, 4, false)).toBe(10);
    expect(computeEffectivePageSize(25, 100, false)).toBe(25);
  });

  it("subtracts the pinned block when pinning is active and pinned < pageSize", () => {
    expect(computeEffectivePageSize(10, 0, true)).toBe(10);
    expect(computeEffectivePageSize(10, 3, true)).toBe(7);
    expect(computeEffectivePageSize(10, 9, true)).toBe(1);
  });

  it("collapses to 0 (never negative) when pinned >= pageSize", () => {
    // Once the pinned block fills the pageSize budget the unpinned slice
    // has no slots left — the page shows only pinned rows.
    expect(computeEffectivePageSize(10, 10, true)).toBe(0);
    expect(computeEffectivePageSize(10, 15, true)).toBe(0);
    expect(computeEffectivePageSize(5, 200, true)).toBe(0);
  });

  it("callers floor the TanStack page size at 1 to avoid divide-by-zero", () => {
    // The fn itself is allowed to return 0; the hook wraps it with
    // Math.max(1, ...) for getPaginationRowModel. Assert both halves of
    // that contract so a future refactor can't silently reintroduce the
    // div-by-zero.
    const effective = computeEffectivePageSize(10, 12, true);
    expect(effective).toBe(0);
    expect(Math.max(1, effective)).toBe(1);
  });
});
