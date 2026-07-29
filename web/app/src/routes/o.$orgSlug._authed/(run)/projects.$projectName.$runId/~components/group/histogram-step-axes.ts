// Step-view axis scaling for numeric histograms — the "Lock axes across
// steps" behavior, shared by the individual-run view (`histogram-view.tsx`)
// and the all-runs / dashboard multi-group view (`multi-group/histogram-view.tsx`).
//
// Unlocked (the default) scales each step to its OWN bin range (X) and peak
// (Y) so a single wide/tall step doesn't squish or flatten the rest. Locked
// shares one range/peak across every step (the pre-per-step behavior, for
// comparing steps side by side). Manual X/Y clamps from the settings popover
// always win. See computeHistogramFences for the outlier-fence half of this.

export interface BinsLike {
  min: number;
  max: number;
}

// Fraction of the current step's bin span padded onto each side so the
// bars don't touch the frame edges. 0.1 = 10% each side.
const PER_STEP_PADDING = 0.1;

/**
 * The "unlocked" per-step X range: the current step's own bin range padded
 * by {@link PER_STEP_PADDING} on each side. Returns null when the step has no
 * usable bins (missing, or zero/negative width) so the caller falls back to
 * the locked/shared range.
 */
export function perStepXRange(
  bins: BinsLike | undefined,
): { min: number; max: number } | null {
  if (!bins || !(bins.max > bins.min)) return null;
  const pad = (bins.max - bins.min) * PER_STEP_PADDING;
  return { min: bins.min - pad, max: bins.max + pad };
}

/**
 * Effective Step-view X range.
 *
 *  - Unlocked (default): scale to the current step's own bins (padded).
 *  - Locked, or the step has no usable bins: use `lockedRange` (the
 *    cross-step union / fenced domain the caller supplies).
 *  - Manual `xMin`/`xMax` overrides from the settings popover always win
 *    (nullish — an explicit 0 still wins).
 */
export function computeStepXRange(opts: {
  lockAxes: boolean;
  currentBins: BinsLike | undefined;
  lockedRange: { min: number; max: number };
  xMinOverride?: number;
  xMaxOverride?: number;
}): { min: number; max: number } {
  const perStep = opts.lockAxes ? null : perStepXRange(opts.currentBins);
  const base = perStep ?? opts.lockedRange;
  return {
    min: opts.xMinOverride ?? base.min,
    max: opts.xMaxOverride ?? base.max,
  };
}

/**
 * Effective Step-view max frequency (the Y peak / color scale).
 *
 *  - Unlocked (default): the current step's own peak (falls back to
 *    `lockedMaxFreq` when the step has no data).
 *  - Locked: the shared cross-step peak.
 *  - Manual `yMax` override always wins (nullish — an explicit 0 wins).
 */
export function computeStepMaxFreq(opts: {
  lockAxes: boolean;
  currentMaxFreq: number | undefined;
  lockedMaxFreq: number;
  yMaxOverride?: number;
}): number {
  return (
    opts.yMaxOverride ??
    (opts.lockAxes
      ? opts.lockedMaxFreq
      : opts.currentMaxFreq ?? opts.lockedMaxFreq)
  );
}
