import { describe, it, expect } from "vitest";
import { selectOverlayRuns } from "../select-overlay-runs";

const runs = Array.from({ length: 30 }, (_, i) => ({ runId: `r${i}` }));

describe("selectOverlayRuns", () => {
  /**
   * The regression this PR is named for. Capping first takes the first N of the
   * SELECTION and asks those for the table — on a 481-run selection where 13
   * runs held the table, exactly one fell inside the first 25, so a ten-line
   * chart drew one line. Narrowing first means the cap only trims runs that
   * genuinely have data.
   */
  it("narrows before capping, not after", () => {
    // Ten holders, all sitting past the cap in selection order.
    const holders = runs.slice(20, 30).map((r) => r.runId);
    const { runs: drawn } = selectOverlayRuns(runs, holders, 5);

    expect(drawn).toHaveLength(5);
    expect(drawn.map((r) => r.runId)).toEqual(["r20", "r21", "r22", "r23", "r24"]);
    // Cap-then-narrow would have found none of them.
    expect(drawn.length).toBeGreaterThan(0);
  });

  it("counts holders for the caption, not the selection", () => {
    const holders = runs.slice(0, 8).map((r) => r.runId);
    const { runs: drawn, totalWithData } = selectOverlayRuns(runs, holders, 5);

    expect(drawn).toHaveLength(5);
    // 8, not 30: comparing a cap against the selection size reads as
    // truncation on charts that aren't truncated at all.
    expect(totalWithData).toBe(8);
  });

  it("reports no truncation when every holder fits", () => {
    const holders = runs.slice(0, 3).map((r) => r.runId);
    const { runs: drawn, totalWithData } = selectOverlayRuns(runs, holders, 25);

    expect(drawn).toHaveLength(3);
    expect(totalWithData).toBe(3);
  });

  it("keeps every run while the mapping is unresolved", () => {
    const { runs: drawn, totalWithData } = selectOverlayRuns(runs, undefined, 25);

    expect(drawn).toHaveLength(25);
    expect(totalWithData).toBe(30);
  });

  it("draws nothing when no run holds the table", () => {
    const { runs: drawn, totalWithData } = selectOverlayRuns(runs, [], 25);

    expect(drawn).toEqual([]);
    expect(totalWithData).toBe(0);
  });
});
