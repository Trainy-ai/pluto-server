/**
 * Utilities for transforming run data into piecewise experiment segments.
 *
 * In experiments mode, runs in the same fork chain should be displayed as
 * a single piecewise experiment graph. Each run only shows its own exclusive
 * data segment — the root shows data up to the first fork, and each fork
 * shows data from its fork step onward (but only up to the next child fork).
 */

export interface RunSegmentInfo {
  runId: string;
  forkStep: number | null;       // step this run was forked at (null = root)
  forkedFromRunId: string | null; // parent run ID (null = root)
}

export interface StepRange {
  runId: string;
  minStep: number;       // inclusive
  maxStep: number | null; // inclusive, null = no upper bound
}

/**
 * Given a set of runs in the same experiment, compute the exclusive step range
 * for each run so they form a clean piecewise graph with no overlaps.
 *
 * Rules:
 * - Each run "owns" data from (its forkStep + 1) onwards (or from 0 if root)
 * - A run's upper bound is determined by its children's fork steps:
 *   the run's data is shown up to (min child forkStep) since children take over from there
 * - If a run has no children, it has no upper bound (shows all its data)
 * - The root run shows data from step 0 up to the earliest fork step of any direct child
 *
 * Example: Root(0-1000) → ForkA(@500) → ForkC(@700), Root → ForkB(@300)
 *   Root: 0-299 (truncated at earliest child fork = 300)
 *   ForkB: 300-700 (own data, no children)
 *   ForkA: 500-699 (truncated at child ForkC's step = 700)  -- wait, but ForkA starts at 501
 *   Actually: Root owns 0-299, ForkB owns 301-700, ForkA owns 501-699, ForkC owns 701-1000
 *
 *   Hmm that leaves a gap at 300 and 500. Let's reconsider.
 *
 * Revised rules (matching Neptune):
 * - Root shows 0 to (earliest child forkStep), inclusive
 * - Each fork shows (forkStep+1) to either its own end or (earliest child forkStep), inclusive
 * - Forks from the SAME parent create parallel branches, each starting at their own forkStep+1
 *
 * So for our tree: Root → ForkA(@500), Root → ForkB(@300), ForkA → ForkC(@700)
 *   Root: 0-300 (earliest direct child fork is ForkB@300)
 *   ForkB: 301-700 (no children, goes to end of its own data)
 *   ForkA: 501-700 (child ForkC forks at 700, so truncate there)
 *   ForkC: 701-1000 (no children)
 *
 * The key insight: a parent is truncated at the EARLIEST child fork step.
 * Multiple children of the same parent create parallel branches.
 */
export function computeExperimentSegments(runs: RunSegmentInfo[]): StepRange[] {
  if (runs.length === 0) return [];
  if (runs.length === 1) {
    return [{ runId: runs[0].runId, minStep: 0, maxStep: null }];
  }

  // Build parent → children map
  const childrenOf = new Map<string, RunSegmentInfo[]>();
  for (const run of runs) {
    if (run.forkedFromRunId != null) {
      const siblings = childrenOf.get(run.forkedFromRunId) ?? [];
      siblings.push(run);
      childrenOf.set(run.forkedFromRunId, siblings);
    }
  }

  // First pass: compute each run's maxStep (truncation at earliest child fork)
  const maxStepOf = new Map<string, number | null>();
  for (const run of runs) {
    const children = childrenOf.get(run.runId) ?? [];
    if (children.length === 0) {
      maxStepOf.set(run.runId, null);
    } else {
      const earliestChildFork = Math.min(
        ...children.map((c) => c.forkStep ?? Infinity),
      );
      maxStepOf.set(run.runId, isFinite(earliestChildFork) ? earliestChildFork : null);
    }
  }

  // Second pass: compute each run's minStep.
  // A fork's segment starts right after its parent's truncation point,
  // NOT at its own forkStep+1. This ensures the fork (with lineage stitching)
  // fills the gap between the parent's truncation and the fork's own data.
  const segments: StepRange[] = [];
  for (const run of runs) {
    let minStep: number;
    if (run.forkedFromRunId == null) {
      // Root: starts at 0
      minStep = 0;
    } else {
      // Fork: starts right after parent's maxStep
      const parentMaxStep = maxStepOf.get(run.forkedFromRunId);
      minStep = parentMaxStep != null ? parentMaxStep + 1 : (run.forkStep != null ? run.forkStep + 1 : 0);
    }

    segments.push({
      runId: run.runId,
      minStep,
      maxStep: maxStepOf.get(run.runId) ?? null,
    });
  }

  return segments;
}

/**
 * Filter bucketed data points to only include points within the given step range.
 */
export function filterDataToRange<T extends { step: number }>(
  data: T[],
  range: StepRange,
): T[] {
  return data.filter((d) => {
    if (d.step < range.minStep) return false;
    if (range.maxStep != null && d.step > range.maxStep) return false;
    return true;
  });
}
