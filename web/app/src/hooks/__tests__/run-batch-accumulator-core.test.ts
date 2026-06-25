import { describe, it, expect } from "vitest";
import {
  computeMissingRunIds,
  mergeRunResults,
  selectAccumulated,
} from "../run-batch-accumulator-core";

describe("computeMissingRunIds", () => {
  it("returns selected runs not yet fetched, sorted", () => {
    const missing = computeMissingRunIds(
      ["c", "a", "b"],
      new Set(["a"]),
    );
    expect(missing).toEqual(["b", "c"]); // sorted, "a" excluded
  });

  it("returns [] when everything is already fetched", () => {
    expect(computeMissingRunIds(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });

  it("returns [] for empty selection", () => {
    expect(computeMissingRunIds([], new Set(["a"]))).toEqual([]);
  });

  it("ignores falsy run ids (transient undefined/empty during navigation)", () => {
    expect(
      computeMissingRunIds(["a", "", undefined as unknown as string], new Set()),
    ).toEqual(["a"]);
  });

  it("is order-stable: same set in different order yields the same sorted key", () => {
    const a = computeMissingRunIds(["x", "y", "z"], new Set());
    const b = computeMissingRunIds(["z", "x", "y"], new Set());
    expect(a).toEqual(b);
  });
});

describe("mergeRunResults", () => {
  it("adds new runs and overwrites existing ones (last write wins / refresh)", () => {
    const acc: Record<string, number> = { a: 1, b: 2 };
    mergeRunResults(acc, { b: 20, c: 3 });
    expect(acc).toEqual({ a: 1, b: 20, c: 3 });
  });

  it("is a no-op for an empty batch", () => {
    const acc = { a: 1 };
    mergeRunResults(acc, {});
    expect(acc).toEqual({ a: 1 });
  });
});

describe("selectAccumulated", () => {
  it("picks only the selected runs, preserving selection order", () => {
    const acc = { a: 1, b: 2, c: 3 };
    expect(selectAccumulated(acc, ["c", "a"])).toEqual({ c: 3, a: 1 });
  });

  it("omits selected runs that have no accumulated entry", () => {
    const acc = { a: 1 };
    expect(selectAccumulated(acc, ["a", "b"])).toEqual({ a: 1 });
  });

  it("returns {} when nothing is selected", () => {
    expect(selectAccumulated({ a: 1 }, [])).toEqual({});
  });

  it("does not include inherited/proto keys", () => {
    const acc = { a: 1 };
    // "toString" exists on the prototype but not as an own key → must be omitted
    expect(selectAccumulated(acc, ["toString"])).toEqual({});
  });
});

// End-to-end of the pure pieces: simulate the add/remove-run lifecycle the hook
// drives, asserting the "only fetch the delta" property.
describe("accumulator lifecycle (pure simulation)", () => {
  it("initial load fetches all; add-run fetches only the new one; remove fetches none", () => {
    const acc: Record<string, string> = {};
    const fetched = new Set<string>();
    const fetchBatch = (ids: string[]): Record<string, string> =>
      Object.fromEntries(ids.map((id) => [id, `data:${id}`]));

    // Initial load: 3 runs selected, none fetched.
    let selected = ["a", "b", "c"];
    let missing = computeMissingRunIds(selected, fetched);
    expect(missing).toEqual(["a", "b", "c"]);
    mergeRunResults(acc, fetchBatch(missing));
    missing.forEach((id) => fetched.add(id));
    expect(selectAccumulated(acc, selected)).toEqual({
      a: "data:a",
      b: "data:b",
      c: "data:c",
    });

    // Add one run "d".
    selected = ["a", "b", "c", "d"];
    missing = computeMissingRunIds(selected, fetched);
    expect(missing).toEqual(["d"]); // ONLY the new run
    mergeRunResults(acc, fetchBatch(missing));
    missing.forEach((id) => fetched.add(id));
    expect(Object.keys(selectAccumulated(acc, selected)).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);

    // Remove one run "b" — no fetch needed.
    selected = ["a", "c", "d"];
    missing = computeMissingRunIds(selected, fetched);
    expect(missing).toEqual([]); // ZERO requests
    expect(selectAccumulated(acc, selected)).toEqual({
      a: "data:a",
      c: "data:c",
      d: "data:d",
    });
  });

  it("a run that returns no data is still marked fetched (never re-requested)", () => {
    const acc: Record<string, string> = {};
    const fetched = new Set<string>();
    const selected = ["a", "b"];
    const missing = computeMissingRunIds(selected, fetched);
    // Server returns data only for "a" (b has no histogram under this prefix).
    mergeRunResults(acc, { a: "data:a" });
    missing.forEach((id) => fetched.add(id)); // mark ALL asked, incl. "b"
    // Next render: nothing missing, "b" is not re-requested forever.
    expect(computeMissingRunIds(selected, fetched)).toEqual([]);
    expect(selectAccumulated(acc, selected)).toEqual({ a: "data:a" });
  });
});
