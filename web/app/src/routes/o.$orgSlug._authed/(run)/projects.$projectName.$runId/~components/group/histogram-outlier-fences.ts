// Outlier-fence clamping for numeric histogram axes.
//
// Similar in spirit to the IQR-based logic in `useYRange` for line
// charts (web/app/src/components/charts/hooks/use-y-range.ts) — but
// histograms hit a degenerate case the line-chart code doesn't: when
// many steps log identical bin ranges (e.g. 99 steps at [-0.2, 0.2])
// the IQR collapses to zero and Tukey fences never trigger. So we
// use 5th/95th percentile fences instead, matching W&B's "Ignore
// outliers" semantics directly.
//
// When a single step (or a tiny minority of steps) has a much wider
// bin range than the rest, the unioned X axis stretches to fit it
// and squishes every other step into an unreadable sliver. Same
// problem on the Y side (`globalMaxFreq`): one step with a tall
// spike makes every other step's bell look flat.
//
// The fences cap the X domain and `globalMaxFreq` to the bulk of the
// data, so the outlier still draws (its tails just clip off the edge)
// but the rest of the steps render at proper scale.
//
// Activation thresholds — we want this to fire only when the spike
// is REALLY dominating, not for genuinely bimodal/multi-modal data:
//
//   * require at least 20 samples
//   * full range > 3× the fenced range (spike is dominating)
//   * < 5% of samples land outside the fenced range (truly rare,
//     not bimodal)

interface BinsLike {
  min: number;
  max: number;
}

interface HistogramStepLike {
  histogramData: {
    bins: BinsLike;
    maxFreq: number;
  };
}

export interface OutlierFenceResult {
  /** The clamped X domain (left, right). When clamped, the wider true
   *  range is hidden — outliers draw but clip at the edges. */
  xDomain: [number, number];
  /** The clamped max-freq used for Y/color normalization. When
   *  clamped, the higher true peak is hidden — outlier-tall bells
   *  saturate at the top. */
  maxFreq: number;
  /** Did the X clamp actually fire? Surfaced so the UI can show a
   *  "Ignore outliers — N step(s) clipped" hint or similar. */
  xClamped: boolean;
  /** Did the maxFreq clamp actually fire? */
  freqClamped: boolean;
  /** Raw unclamped bounds — useful for callers that want to render
   *  a "show raw range" hint or fall back when the toggle is off. */
  rawXDomain: [number, number];
  rawMaxFreq: number;
}

const MIN_SAMPLES_FOR_FENCES = 20;
// Tukey coefficient. The line-chart `useYRange` uses k=1.5 because its
// values are continuous training metrics. We use k=3.0 here because
// histogram `bins.min` / `bins.max` follow the distribution of
// min(samples) / max(samples) — Gumbel-shaped with longer tails than
// the underlying normal. With k=1.5, several narrow steps near the
// edges of their natural spread get flagged as outliers, pushing the
// outlier ratio past 5% and suppressing the clamp. k=3.0 captures
// ~99.7% of normal-shaped data, so only the TRULY extreme outlier
// steps (the σ=30 step in the seed demo) count.
const TUKEY_K = 3.0;
const RANGE_DOMINANCE_RATIO = 3; // full > 3× fenced → spike dominates.
const MAX_OUTLIER_RATIO = 0.05; // < 5% → truly rare.

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

// Tukey fences at k=1.5×IQR. Same approach as the line-chart
// `useYRange` hook so triggers feel familiar across chart types.
//
// Degenerate case: when 99% of values are identical (a logging
// pattern like "same bin range every step" + one outlier step),
// IQR collapses to zero and naive Tukey would never fire. We
// handle that by treating IQR=0 as "the bulk IS the fenced range" —
// lower=upper=Q1, anything else is an outlier.
function tukeyFences(
  values: number[],
): { lower: number; upper: number; iqr: number } | null {
  if (values.length < MIN_SAMPLES_FOR_FENCES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  if (iqr === 0) {
    return { lower: q1, upper: q3, iqr: 0 };
  }
  return { lower: q1 - TUKEY_K * iqr, upper: q3 + TUKEY_K * iqr, iqr };
}

/**
 * Compute the X domain (and maxFreq) for a set of histogram steps,
 * optionally trimming outlier-step contributions via IQR fences.
 *
 * The X clamp activates only when ALL of:
 *   - the user toggle is ON (`ignoreOutliers === true`)
 *   - we have ≥ 20 steps to compute fences from
 *   - the full range is > 3× the fenced range (truly dominated)
 *   - < 5% of step `bins.min/max` lie outside the fenced range
 *     (truly rare, not bimodal data)
 *
 * The maxFreq clamp activates with the same thresholds applied
 * independently to the per-step `maxFreq` array.
 *
 * Returns the raw bounds too so callers can render a "show outliers"
 * hint or fall back when the toggle flips.
 */
export function computeHistogramFences(
  steps: ReadonlyArray<HistogramStepLike>,
  options: { ignoreOutliers: boolean },
): OutlierFenceResult {
  if (steps.length === 0) {
    return {
      xDomain: [0, 1],
      maxFreq: 1,
      xClamped: false,
      freqClamped: false,
      rawXDomain: [0, 1],
      rawMaxFreq: 1,
    };
  }

  // Raw bounds (union across every step).
  let rawMin = Infinity;
  let rawMax = -Infinity;
  let rawMaxFreq = 0;
  const binsMins: number[] = [];
  const binsMaxes: number[] = [];
  const stepMaxFreqs: number[] = [];
  for (const s of steps) {
    const { bins, maxFreq } = s.histogramData;
    if (bins.min < rawMin) rawMin = bins.min;
    if (bins.max > rawMax) rawMax = bins.max;
    if (maxFreq > rawMaxFreq) rawMaxFreq = maxFreq;
    binsMins.push(bins.min);
    binsMaxes.push(bins.max);
    stepMaxFreqs.push(maxFreq);
  }
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMin === rawMax) {
    // Degenerate: every step has zero-width bins, or no data at all.
    return {
      xDomain: [rawMin, rawMax],
      maxFreq: Math.max(rawMaxFreq, 1),
      xClamped: false,
      freqClamped: false,
      rawXDomain: [rawMin, rawMax],
      rawMaxFreq: Math.max(rawMaxFreq, 1),
    };
  }

  let xDomain: [number, number] = [rawMin, rawMax];
  let maxFreq = rawMaxFreq;
  let xClamped = false;
  let freqClamped = false;

  if (options.ignoreOutliers) {
    // ── X clamp ────────────────────────────────────────────────
    // Apply Tukey fences to LEFT edges (bins.min) and RIGHT edges
    // (bins.max) independently. Activates only when the spike really
    // dominates AND outliers are a tiny minority (not bimodal data).
    const leftFence = tukeyFences(binsMins);
    const rightFence = tukeyFences(binsMaxes);
    if (leftFence && rightFence) {
      const proposedMin = leftFence.lower;
      const proposedMax = rightFence.upper;
      const fullRange = rawMax - rawMin;
      const fencedRange = proposedMax - proposedMin;
      // Degenerate bulk (IQR=0 on both sides) gives fencedRange=0;
      // any non-zero raw spread dominates by definition.
      const rangeDominates =
        fencedRange > 0
          ? fullRange > RANGE_DOMINANCE_RATIO * fencedRange
          : fullRange > 0;
      // Outlier = step whose bins.min sits below the lower fence OR
      // bins.max sits above the upper fence. Tukey fences naturally
      // mark only the truly-extreme tails as outliers (not the
      // ordinary spread of a normal distribution), so the < 5%
      // threshold holds.
      let outlierCount = 0;
      for (let i = 0; i < steps.length; i++) {
        if (binsMins[i] < proposedMin || binsMaxes[i] > proposedMax) {
          outlierCount++;
        }
      }
      const outlierRatio = outlierCount / steps.length;
      if (rangeDominates && outlierRatio < MAX_OUTLIER_RATIO) {
        xDomain = [proposedMin, proposedMax];
        xClamped = true;
      }
    }

    // ── maxFreq clamp ──────────────────────────────────────────
    // Same Tukey rule. Only the upper fence is used because freq is
    // non-negative — there's no lower-outlier case for "one step's
    // bell is unusually short" to worry about.
    const freqFence = tukeyFences(stepMaxFreqs);
    if (freqFence) {
      const proposedMaxFreq = freqFence.upper;
      const fullRange = rawMaxFreq;
      const fencedRange = proposedMaxFreq; // baseline is 0
      const rangeDominates =
        fencedRange > 0
          ? fullRange > RANGE_DOMINANCE_RATIO * fencedRange
          : fullRange > 0;
      let upperOutliers = 0;
      for (const v of stepMaxFreqs) {
        if (v > proposedMaxFreq) upperOutliers++;
      }
      const outlierRatio = upperOutliers / stepMaxFreqs.length;
      if (rangeDominates && outlierRatio < MAX_OUTLIER_RATIO) {
        maxFreq = proposedMaxFreq;
        freqClamped = true;
      }
    }
  }

  return {
    xDomain,
    maxFreq: Math.max(maxFreq, 1),
    xClamped,
    freqClamped,
    rawXDomain: [rawMin, rawMax],
    rawMaxFreq: Math.max(rawMaxFreq, 1),
  };
}
