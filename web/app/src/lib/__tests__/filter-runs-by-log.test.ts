import { describe, it, expect } from "vitest";
import { filterRunsByLog } from "../filter-runs-by-log";

const runs = [
  { runId: "aaa", runName: "one" },
  { runId: "bbb", runName: "two" },
  { runId: "ccc", runName: "three" },
];

describe("filterRunsByLog", () => {
  /**
   * The mapping arrives a tick after the widget first renders. Filtering to
   * nothing in that window would flash "No images found" on every load, so an
   * unresolved mapping must keep the previous behaviour of passing everything.
   */
  it("keeps every run while the mapping is unresolved", () => {
    expect(filterRunsByLog(runs, undefined)).toEqual(runs);
  });

  it("keeps only runs that logged it, in the original order", () => {
    expect(filterRunsByLog(runs, ["ccc", "aaa"])).toEqual([
      { runId: "aaa", runName: "one" },
      { runId: "ccc", runName: "three" },
    ]);
  });

  it("treats an empty mapping as a resolved 'no run has this'", () => {
    expect(filterRunsByLog(runs, [])).toEqual([]);
  });

  it("ignores ids that aren't in the selection", () => {
    // The mapping is scoped to the selection server-side, but a stale cache
    // entry could name a run that has since been deselected.
    expect(filterRunsByLog(runs, ["bbb", "zzz"])).toEqual([
      { runId: "bbb", runName: "two" },
    ]);
  });

  it("handles an empty run list", () => {
    expect(filterRunsByLog([], ["aaa"])).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...runs];
    filterRunsByLog(runs, ["aaa"]);
    expect(runs).toEqual(copy);
  });
});
