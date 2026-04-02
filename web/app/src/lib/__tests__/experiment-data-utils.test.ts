import { describe, it, expect } from "vitest";
import {
  computeExperimentSegments,
  filterDataToRange,
  type RunSegmentInfo,
  type StepRange,
} from "../experiment-data-utils";

describe("computeExperimentSegments", () => {
  it("returns full range for a single root run", () => {
    const runs: RunSegmentInfo[] = [
      { runId: "root", forkStep: null, forkedFromRunId: null },
    ];
    expect(computeExperimentSegments(runs)).toEqual([
      { runId: "root", minStep: 0, maxStep: null },
    ]);
  });

  it("truncates root at the child fork step for a simple fork", () => {
    // Root(0-1000) → ForkA(@500)
    const runs: RunSegmentInfo[] = [
      { runId: "root", forkStep: null, forkedFromRunId: null },
      { runId: "forkA", forkStep: 500, forkedFromRunId: "root" },
    ];
    const segments = computeExperimentSegments(runs);
    expect(segments).toEqual([
      { runId: "root", minStep: 0, maxStep: 500 },
      { runId: "forkA", minStep: 501, maxStep: null },
    ]);
  });

  it("truncates root at earliest child, forks start after parent truncation", () => {
    // Root → ForkA(@500), Root → ForkB(@300)
    // Root truncated at 300 (earliest child). Both forks start at 301
    // (right after parent's truncation). ForkA uses lineage to inherit
    // root data 301-500, then shows own data 501+.
    const runs: RunSegmentInfo[] = [
      { runId: "root", forkStep: null, forkedFromRunId: null },
      { runId: "forkA", forkStep: 500, forkedFromRunId: "root" },
      { runId: "forkB", forkStep: 300, forkedFromRunId: "root" },
    ];
    const segments = computeExperimentSegments(runs);

    const rootSeg = segments.find((s) => s.runId === "root")!;
    expect(rootSeg.minStep).toBe(0);
    expect(rootSeg.maxStep).toBe(300); // earliest child fork

    // Both forks start at parent's maxStep + 1
    const forkASeg = segments.find((s) => s.runId === "forkA")!;
    expect(forkASeg.minStep).toBe(301);
    expect(forkASeg.maxStep).toBeNull();

    const forkBSeg = segments.find((s) => s.runId === "forkB")!;
    expect(forkBSeg.minStep).toBe(301);
    expect(forkBSeg.maxStep).toBeNull();
  });

  it("handles a deep chain: Root → ForkA → ForkC", () => {
    // Root → ForkA(@500) → ForkC(@700)
    const runs: RunSegmentInfo[] = [
      { runId: "root", forkStep: null, forkedFromRunId: null },
      { runId: "forkA", forkStep: 500, forkedFromRunId: "root" },
      { runId: "forkC", forkStep: 700, forkedFromRunId: "forkA" },
    ];
    const segments = computeExperimentSegments(runs);

    const rootSeg = segments.find((s) => s.runId === "root")!;
    expect(rootSeg.minStep).toBe(0);
    expect(rootSeg.maxStep).toBe(500); // child ForkA forks at 500

    const forkASeg = segments.find((s) => s.runId === "forkA")!;
    expect(forkASeg.minStep).toBe(501); // starts after root's truncation
    expect(forkASeg.maxStep).toBe(700); // child ForkC forks at 700

    const forkCSeg = segments.find((s) => s.runId === "forkC")!;
    expect(forkCSeg.minStep).toBe(701); // starts after ForkA's truncation
    expect(forkCSeg.maxStep).toBeNull(); // leaf, no children
  });

  it("handles our full fork-demo tree", () => {
    // Root → ForkA(@500) → ForkC(@700)
    // Root → ForkB(@300)
    const runs: RunSegmentInfo[] = [
      { runId: "root", forkStep: null, forkedFromRunId: null },
      { runId: "forkA", forkStep: 500, forkedFromRunId: "root" },
      { runId: "forkB", forkStep: 300, forkedFromRunId: "root" },
      { runId: "forkC", forkStep: 700, forkedFromRunId: "forkA" },
    ];
    const segments = computeExperimentSegments(runs);

    // Root: 0-300 (earliest child is ForkB@300)
    expect(segments.find((s) => s.runId === "root")).toEqual({
      runId: "root", minStep: 0, maxStep: 300,
    });

    // ForkA: 301-700 (starts after parent root's truncation at 300,
    // inherits root data 301-500 via lineage, own data 501-700,
    // truncated at child ForkC@700)
    expect(segments.find((s) => s.runId === "forkA")).toEqual({
      runId: "forkA", minStep: 301, maxStep: 700,
    });

    // ForkB: 301-end (starts after parent root's truncation, no children)
    expect(segments.find((s) => s.runId === "forkB")).toEqual({
      runId: "forkB", minStep: 301, maxStep: null,
    });

    // ForkC: 701-end (starts after parent ForkA's truncation at 700)
    expect(segments.find((s) => s.runId === "forkC")).toEqual({
      runId: "forkC", minStep: 701, maxStep: null,
    });
  });

  it("returns empty for empty input", () => {
    expect(computeExperimentSegments([])).toEqual([]);
  });

  it("handles runs with no fork relationships (no forkedFromRunId in set)", () => {
    // Two independent root runs (different experiments — shouldn't happen
    // in practice, but should still work)
    const runs: RunSegmentInfo[] = [
      { runId: "a", forkStep: null, forkedFromRunId: null },
      { runId: "b", forkStep: null, forkedFromRunId: null },
    ];
    const segments = computeExperimentSegments(runs);
    expect(segments).toEqual([
      { runId: "a", minStep: 0, maxStep: null },
      { runId: "b", minStep: 0, maxStep: null },
    ]);
  });
});

describe("filterDataToRange", () => {
  const data = [
    { step: 0, value: 12 },
    { step: 100, value: 10 },
    { step: 200, value: 8 },
    { step: 300, value: 6 },
    { step: 400, value: 5 },
    { step: 500, value: 4 },
    { step: 600, value: 3 },
    { step: 700, value: 2.5 },
    { step: 800, value: 2 },
    { step: 900, value: 1.5 },
    { step: 1000, value: 1 },
  ];

  it("filters to a bounded range", () => {
    const range: StepRange = { runId: "x", minStep: 301, maxStep: 700 };
    const filtered = filterDataToRange(data, range);
    expect(filtered.map((d) => d.step)).toEqual([400, 500, 600, 700]);
  });

  it("filters with no upper bound", () => {
    const range: StepRange = { runId: "x", minStep: 501, maxStep: null };
    const filtered = filterDataToRange(data, range);
    expect(filtered.map((d) => d.step)).toEqual([600, 700, 800, 900, 1000]);
  });

  it("returns full data for 0 to null range", () => {
    const range: StepRange = { runId: "x", minStep: 0, maxStep: null };
    const filtered = filterDataToRange(data, range);
    expect(filtered.length).toBe(data.length);
  });

  it("returns empty for out-of-range", () => {
    const range: StepRange = { runId: "x", minStep: 1001, maxStep: null };
    const filtered = filterDataToRange(data, range);
    expect(filtered).toEqual([]);
  });

  it("includes boundary values", () => {
    const range: StepRange = { runId: "x", minStep: 300, maxStep: 300 };
    const filtered = filterDataToRange(data, range);
    expect(filtered.map((d) => d.step)).toEqual([300]);
  });
});
