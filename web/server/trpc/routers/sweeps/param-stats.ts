import { forestImportance } from "./random-forest";

/**
 * Which hyperparameter actually mattered.
 *
 * Two numbers per parameter, mirroring the two columns wandb shows, because
 * they answer different questions:
 *
 * - **importance** — how much of the metric's variance this knob explains, on
 *   its own. Always positive. "Did this matter at all?"
 * - **correlation** — the signed monotonic relationship. "Which way should I
 *   turn it?"
 *
 * A knob can be important with near-zero correlation (it matters, but not
 * monotonically — the middle of its range is best), which is exactly why one
 * number is not enough.
 *
 * **Method.** Importance is mean-decrease-in-impurity from a small regression
 * random forest fitted over all parameters at once — the same approach wandb
 * uses, so credit is split between correlated knobs rather than both claiming
 * it, and effects that only appear in combination are visible. Values are
 * normalised to sum to 1, so each is a share of the total explained.
 *
 * Exact parity with wandb's numbers is not achievable by anyone: a forest is
 * stochastic and wandb publishes neither its hyperparameters nor its seed. The
 * ranking is what transfers. Ours is seeded, so it is at least stable across
 * reloads. At a dozen runs treat any of this as indicative.
 *
 * Categorical parameters are one-hot expanded (`optimizer=adam`,
 * `optimizer=sgd`) rather than rank-encoded, since an arbitrary ordering of
 * category labels would produce a meaningless correlation sign. wandb does the
 * same — its panel lists one row per category.
 */

export interface ParamStat {
  /** Display key: the parameter, or `param=value` for a one-hot category. */
  key: string;
  /** 0-1 share of the forest's total impurity decrease. */
  importance: number;
  /** -1..1 Spearman rank correlation, or null when it cannot be computed. */
  correlation: number | null;
}

/** One column of the design matrix. */
interface Column {
  key: string;
  /** One entry per scored run. Gaps are median-filled; see `gaps`. */
  values: number[];
  /**
   * Rows where this parameter was absent from the run's config, or null when
   * every row had a value. The forest needs a rectangular matrix so those rows
   * are median-filled, but the correlation drops them instead — an invented
   * value at the column median would drag the rank correlation toward zero.
   */
  gaps: boolean[] | null;
}

/** Rank with ties averaged — required for Spearman to behave on tied values. */
function ranks(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) {
      j++;
    }
    // Average rank across the tied block.
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      out[order[k].index] = rank;
    }
    i = j + 1;
  }
  return out;
}

/** Pearson product-moment on two equal-length vectors. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) {
    // A knob that never varied, or a metric that never moved.
    return null;
  }
  return num / Math.sqrt(dx * dy);
}

/**
 * Pearson on ranks == Spearman. Null when either side is constant.
 *
 * `targetRanks` is passed in rather than derived, because it is the same for
 * every column — ranking the metric once instead of once per column removes an
 * O(columns x n log n) block of pure duplicate work from the request path.
 * Columns with gaps are the exception: dropping rows invalidates ranks taken
 * over the full set, so those re-rank the survivors.
 */
function spearman(
  column: Column,
  targets: number[],
  targetRanks: number[],
): number | null {
  let xs = column.values;
  let yr = targetRanks;

  if (column.gaps) {
    const keptX: number[] = [];
    const keptY: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      if (!column.gaps[i]) {
        keptX.push(xs[i]);
        keptY.push(targets[i]);
      }
    }
    xs = keptX;
    yr = ranks(keptY);
  }

  if (xs.length < 3) {
    return null;
  }
  return pearson(ranks(xs), yr);
}

/** Middle value of a sorted copy — used to fill a numeric column's gaps. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Only finite numbers are usable; NaN and Infinity are treated as absent. */
function isUsableNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Turn one config key into design-matrix columns, or nothing if it carries no
 * information.
 *
 * The numeric/categorical decision is made over the values that are actually
 * *present*. Deciding it over the raw list meant a single run missing the key —
 * a crash before the config was logged, a parameter added mid-sweep — pushed a
 * continuous parameter down the categorical path, where every distinct float
 * became its own one-hot column: a 200-run sweep went from 10 columns to 183,
 * and the panel filled with meaningless `lr=0.0317` rows.
 */
function buildColumns(key: string, raw: unknown[]): Column[] {
  const nonNull = raw.filter((value) => value != null);
  if (nonNull.length === 0) {
    return [];
  }

  // The branch is decided on `typeof`, not on usability: NaN and Infinity are
  // numbers that happen to carry no position on the axis. Testing usability
  // here would send a continuous parameter down the categorical path the
  // moment one run logged a NaN — the same explosion a missing value caused.
  if (nonNull.every((value) => typeof value === "number")) {
    const numeric = raw.map((value) => (isUsableNumber(value) ? value : null));
    const usable = numeric.filter((value): value is number => value !== null);
    if (usable.length < 3) {
      // Too few runs carry a usable value to say anything about it.
      return [];
    }
    if (new Set(usable).size < 2) {
      // Never varied, so it explains nothing — and an unvarying column still
      // consumes a slot in the forest's per-split feature subsample, diluting
      // the draw for the parameters that do vary.
      return [];
    }
    if (usable.length === numeric.length) {
      return [{ key, values: usable, gaps: null }];
    }
    const fill = median(usable);
    return [
      {
        key,
        values: numeric.map((value) => value ?? fill),
        gaps: numeric.map((value) => value === null),
      },
    ];
  }

  if (nonNull.length < 3) {
    return [];
  }
  // Categorical: one column per distinct value, 0/1 encoded. Rank-encoding
  // would impose an arbitrary order on labels and give a meaningless sign.
  const categories = [...new Set(nonNull.map(String))].sort();
  if (categories.length < 2) {
    return []; // never varied, so it explains nothing
  }
  // A run missing the key reads as 0 in every category, which is correct: it is
  // not in any of them.
  return categories.map((category) => ({
    key: `${key}=${category}`,
    values: raw.map((value) => (String(value) === category ? 1 : 0)),
    gaps: null,
  }));
}

/**
 * Compute a stat per swept parameter, most important first.
 *
 * Runs whose metric is missing are dropped rather than zero-filled — a run that
 * never logged the objective carries no information about it, and treating its
 * absence as 0 would invent a data point at the bottom of the range.
 */
export function computeParamStats(
  runs: { config: Record<string, unknown>; metricValue: number | null }[],
  sweptKeys: string[],
): ParamStat[] {
  const scored = runs.filter(
    (run): run is { config: Record<string, unknown>; metricValue: number } =>
      typeof run.metricValue === "number" && Number.isFinite(run.metricValue),
  );
  if (scored.length < 3) {
    // Below this, any of these numbers is noise presented as insight.
    return [];
  }

  // One design matrix over every parameter, because the forest has to see them
  // together — that is the whole reason for using one.
  const columns: Column[] = [];
  for (const key of sweptKeys) {
    columns.push(...buildColumns(key, scored.map((run) => run.config[key])));
  }

  if (columns.length === 0) {
    return [];
  }

  const targets = scored.map((run) => run.metricValue);
  const rows = scored.map((_, i) => columns.map((column) => column.values[i]));
  const importances = forestImportance(rows, targets);
  // Once, not once per column: the metric is the same on every axis.
  const targetRanks = ranks(targets);

  const stats: ParamStat[] = columns.map((column, index) => ({
    key: column.key,
    importance: importances[index],
    correlation: spearman(column, targets, targetRanks),
  }));

  return stats.sort((a, b) => b.importance - a.importance);
}
