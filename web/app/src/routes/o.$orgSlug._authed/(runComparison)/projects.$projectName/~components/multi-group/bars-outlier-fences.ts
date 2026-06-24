// W&B-style "Ignore outliers" fence for the bar-rollup ({bars}) widget.
//
// Categorical bars have NO meaningful X-axis fence (X is the bin label
// dimension — `imagenet`, `cc12m`, etc.). What CAN explode is the shared
// Y/value scale: one step where a single bar is 100× taller than the rest
// squishes every other step's ridges to a flat baseline in Ridgeline and
// pushes the heatmap colors into the bottom of the gradient.
//
// We Tukey-fence the per-step `maxFreq` values exactly like
// `histogram-outlier-fences` does for the numeric case, with the same
// k=3.0 + activation rules so the toggle feels consistent across
// histogram + bars widgets. Only the upper fence is used — `maxFreq` is
// non-negative, so there's no "unusually short" outlier to worry about.
//
// Activation requires ALL of:
//   * at least 20 values (per-step maxFreqs aggregated across runs)
//   * full range > 3× fenced range (the outlier really dominates)
//   * < 5% of values land above the fenced upper bound (rare, not bimodal)
//
// When activation fails, returns the raw max unchanged so the toggle is
// a no-op for genuinely well-scaled data.

const MIN_SAMPLES_FOR_FENCES = 20;
const TUKEY_K = 3.0;
const RANGE_DOMINANCE_RATIO = 3;
const MAX_OUTLIER_RATIO = 0.05;

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

function tukeyUpper(values: number[]): number | null {
  if (values.length < MIN_SAMPLES_FOR_FENCES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  // Degenerate "all values equal" case (e.g. logging the same per-bar
  // total at every step + one outlier). IQR=0 → treat the bulk as the
  // fence, anything above Q3 is an outlier by definition.
  if (iqr === 0) return q3;
  return q3 + TUKEY_K * iqr;
}

export interface BarsFenceResult {
  /** maxFreq to use for normalization (clamped or raw). */
  maxFreq: number;
  /** Did the clamp actually fire? Surfaces "N step(s) clipped" hints. */
  clamped: boolean;
  /** Unclamped max, exposed so callers can show a "show raw" affordance. */
  rawMaxFreq: number;
}

/**
 * Apply the bars Tukey upper fence to a flat list of per-step maxFreq
 * values (collected across all visible runs). Pass `ignoreOutliers: false`
 * to bypass the fence and get the raw max back.
 */
export function computeBarsFencedMaxFreq(
  perStepMaxFreqs: ReadonlyArray<number>,
  options: { ignoreOutliers: boolean },
): BarsFenceResult {
  let rawMaxFreq = 0;
  for (const v of perStepMaxFreqs) if (v > rawMaxFreq) rawMaxFreq = v;
  // Always return at least 1 — a zero global max collapses the canvas
  // math (division by zero in the normalizers) for empty/early states.
  const safeRaw = Math.max(rawMaxFreq, 1);

  if (!options.ignoreOutliers || perStepMaxFreqs.length === 0) {
    return { maxFreq: safeRaw, clamped: false, rawMaxFreq: safeRaw };
  }

  const upper = tukeyUpper(perStepMaxFreqs.slice());
  if (upper === null) {
    return { maxFreq: safeRaw, clamped: false, rawMaxFreq: safeRaw };
  }

  // Range dominance check: the unfenced max has to be substantially
  // bigger than the fenced bulk, otherwise the toggle would clamp away
  // ordinary spread and frustrate users with well-scaled data.
  const rangeDominates =
    upper > 0 ? rawMaxFreq > RANGE_DOMINANCE_RATIO * upper : rawMaxFreq > 0;

  let upperOutliers = 0;
  for (const v of perStepMaxFreqs) if (v > upper) upperOutliers++;
  const outlierRatio = upperOutliers / perStepMaxFreqs.length;

  if (rangeDominates && outlierRatio < MAX_OUTLIER_RATIO) {
    return {
      maxFreq: Math.max(upper, 1),
      clamped: true,
      rawMaxFreq: safeRaw,
    };
  }

  return { maxFreq: safeRaw, clamped: false, rawMaxFreq: safeRaw };
}
