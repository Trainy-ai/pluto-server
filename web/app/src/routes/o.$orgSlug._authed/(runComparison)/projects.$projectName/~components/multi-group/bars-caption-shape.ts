/**
 * Caption-shape helper for the categorical (bars) widget PNG export.
 *
 * Bars panels stamp `data-export-step` + `data-export-runs` on their
 * outer container so `extractCaptionFromDOM` can read them at click
 * time. WHICH values appear depends on the current (mode, depthAxis)
 * combination — different layouts render different subsets of the
 * (run × step) space, and surfacing a single "current" value for the
 * other axis would mislead the viewer.
 *
 * Pulled into its own module so the matrix is unit-testable and the
 * JSX stays a thin pass-through. Mirror this whenever the layout adds
 * a new mode (e.g. lollipop) or a new depth axis (e.g. depth=metric).
 */

import type {
  BarsViewMode,
  BarsDepthAxis,
} from "./categorical-view";

export interface BarsCaptionRun {
  name: string;
  color: string;
}

export interface BarsCaptionShape {
  /** Step label string (`"step 3960"`) or undefined when not meaningful */
  step: string | undefined;
  /** Color + name chips. Empty array when there is no meaningful "current" run set. */
  runs: BarsCaptionRun[];
}

/**
 * Decide what step / run information to surface in the export caption.
 *
 * Matrix:
 * - mode=step           → one (run, step) pair          → step text + currentRun chip
 * - mode=ridge|heatmap, depthAxis=step → ONE run, many steps → no step, currentRun chip
 * - mode=ridge|heatmap, depthAxis=run  → ONE step, many runs → step text + every run
 */
export function buildBarsCaptionShape(input: {
  mode: BarsViewMode;
  depthAxis: BarsDepthAxis;
  currentStepValue: number;
  currentRun: BarsCaptionRun | undefined | null;
  perRun: BarsCaptionRun[];
}): BarsCaptionShape {
  const { mode, depthAxis, currentStepValue, currentRun, perRun } = input;

  const stepMeaningful = mode === "step" || depthAxis === "run";
  const oneRun = mode === "step" || depthAxis === "step";

  return {
    step: stepMeaningful ? `step ${currentStepValue}` : undefined,
    runs: oneRun
      ? currentRun
        ? [{ name: currentRun.name, color: currentRun.color }]
        : []
      : perRun.map((r) => ({ name: r.name, color: r.color })),
  };
}
