import { describe, expect, it } from "vitest";
import { bucketColorFor, bucketColorForRun } from "../bucket-color";
import { computeRunGroupTrail } from "@/lib/compute-run-group-key";

/**
 * Regression cover for the grouping colour bug.
 *
 * The bucket tree used to push its colour onto every selected run through the
 * page-level `onColorChange` — the same persisted state the colour picker owns.
 * That destroyed each run's own colour, so ungrouping left every run that had
 * shared a bucket stuck on one colour, and the debounced IndexedDB save made it
 * survive a reload.
 *
 * The colour is now derived per run instead. These tests pin the two properties
 * that makes the fix correct: it must agree with the bucket header's colour, and
 * it must be a pure function of (run, groupBy) so ungrouping simply stops
 * applying it.
 */

// Shape is whatever `computeRunGroupTrail` reads; only the grouped fields matter.
const run = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "alpha",
  status: "COMPLETED",
  tags: [] as string[],
  ...over,
});

describe("bucketColorForRun", () => {
  it("matches the colour the bucket header derives from the same trail", () => {
    const groupBy = ["system:status"];
    const r = run();
    const headerKey = JSON.stringify(computeRunGroupTrail(r, groupBy));
    expect(bucketColorForRun(r, groupBy)).toBe(bucketColorFor(headerKey));
  });

  it("gives every run in one bucket the same colour", () => {
    const groupBy = ["system:status"];
    const colors = [
      bucketColorForRun(run({ id: "a", name: "a" }), groupBy),
      bucketColorForRun(run({ id: "b", name: "b" }), groupBy),
      bucketColorForRun(run({ id: "c", name: "c" }), groupBy),
    ];
    expect(new Set(colors).size).toBe(1);
  });

  it("separates runs that fall into different buckets", () => {
    const groupBy = ["system:status"];
    const completed = bucketColorForRun(run({ status: "COMPLETED" }), groupBy);
    const failed = bucketColorForRun(run({ status: "FAILED" }), groupBy);
    expect(completed).not.toBe(failed);
  });

  it("is pure — deriving it never depends on or mutates prior state", () => {
    const groupBy = ["system:status"];
    const r = run();
    const first = bucketColorForRun(r, groupBy);
    // Deriving other runs' colours in between must not shift this one; the old
    // implementation wrote through shared state, so order mattered.
    bucketColorForRun(run({ id: "x", status: "FAILED" }), groupBy);
    bucketColorForRun(run({ id: "y", status: "RUNNING" }), groupBy);
    expect(bucketColorForRun(r, groupBy)).toBe(first);
  });
});
