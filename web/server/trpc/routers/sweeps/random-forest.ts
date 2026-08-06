/**
 * A small regression random forest, used for parameter importance.
 *
 * This exists to match wandb's *method*, not its numbers. wandb fits a forest
 * over all parameters at once and reports mean-decrease-in-impurity, which can
 * split credit between correlated knobs and pick up effects that only appear in
 * combination — neither of which a single-parameter score can do.
 *
 * Exact parity is not achievable by anyone: a forest is stochastic (bagging and
 * feature subsampling) and wandb does not publish its hyperparameters or seed.
 * What transfers is the ranking. The RNG here is therefore seeded and
 * deterministic, so at least *our* numbers are stable across reloads — a panel
 * whose bars twitch on every refresh would be worse than a simpler method.
 *
 * **Cost.** The split search is the hot loop, and it is written as
 * sort-once-then-sweep: for each candidate feature the node's rows are sorted
 * by that feature once, then a single left-to-right pass carries running sums
 * from which every candidate threshold's child variances fall out in O(1). The
 * obvious formulation — for each threshold, filter the rows and recompute both
 * child variances — is O(distinct values x rows) per feature, i.e. quadratic in
 * the row count; it took 4.7s on an 800-run sweep, synchronously, on the
 * request path. This is O(rows log rows).
 */

/** Deterministic PRNG (mulberry32) — same input, same forest, every time. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trees in the ensemble. Enough that the ranking stops moving. */
const TREES = 100;
/** Fixed, so the panel's bars are identical across reloads. */
const SEED = 42;
/**
 * Smallest node a split may produce. One, deliberately: a sweep is a dozen rows
 * and anything larger refuses to split at all. Depth is what bounds the fit.
 */
const MIN_LEAF = 1;

interface Split {
  feature: number;
  /**
   * Rows with `value <= threshold` go left. Always an *observed* value rather
   * than a midpoint, so the partition below reproduces the sweep's counts
   * exactly even when the two straddling values are adjacent doubles.
   */
  threshold: number;
  /** Impurity removed by this split, weighted by the rows reaching it. */
  gain: number;
}

/** Everything a tree needs, carried once rather than through ten parameters. */
interface Forest {
  rows: number[][];
  targets: number[];
  featureCount: number;
  featuresPerSplit: number;
  maxDepth: number;
  /** MDI denominator: the full sample size, so gains stay comparable. */
  totalRows: number;
  rng: () => number;
  importance: number[];
  /** Scratch permutation of feature indices, reused across every node. */
  pool: number[];
}

/**
 * Best split on one feature, found in a single pass over the node's rows sorted
 * by that feature.
 *
 * Child variances come from running sums of the deviations from the *parent*
 * mean. That is exact algebra — variance is translation invariant — and it
 * keeps the accumulated squares small, which a naive `sumSq/n - mean^2` over
 * raw metric values does not.
 */
function bestSplitOnFeature(
  forest: Forest,
  indices: number[],
  feature: number,
  parentMean: number,
  parentVar: number,
): Split | null {
  const { rows, targets, totalRows } = forest;
  const n = indices.length;
  const order = indices
    .slice()
    .sort((a, b) => rows[a][feature] - rows[b][feature]);

  let totalD = 0;
  let totalD2 = 0;
  for (const i of order) {
    const d = targets[i] - parentMean;
    totalD += d;
    totalD2 += d * d;
  }

  let leftD = 0;
  let leftD2 = 0;
  let best: Split | null = null;

  for (let k = 0; k < n - 1; k++) {
    const i = order[k];
    const d = targets[i] - parentMean;
    leftD += d;
    leftD2 += d * d;

    const value = rows[i][feature];
    // Only a change of value is a candidate boundary; equal values cannot be
    // separated. (This also skips NaN, which compares false against anything.)
    if (value === rows[order[k + 1]][feature]) {
      continue;
    }
    const leftCount = k + 1;
    const rightCount = n - leftCount;
    if (leftCount < MIN_LEAF || rightCount < MIN_LEAF) {
      continue;
    }

    const leftVar = Math.max(0, leftD2 / leftCount - (leftD / leftCount) ** 2);
    const rightD = totalD - leftD;
    const rightD2 = totalD2 - leftD2;
    const rightVar = Math.max(
      0,
      rightD2 / rightCount - (rightD / rightCount) ** 2,
    );
    const weighted = (leftCount * leftVar + rightCount * rightVar) / n;
    // Weighted by the share of samples reaching this node, so a split deep in
    // the tree counts for less than one at the root — this is what makes the
    // totals comparable across features.
    const gain = ((parentVar - weighted) * n) / totalRows;
    if (gain > (best?.gain ?? 0)) {
      best = { feature, threshold: value, gain };
    }
  }

  return best;
}

/**
 * Grow one tree, accumulating each feature's total impurity decrease into
 * `importance`. Depth-limited: with a dozen samples an unbounded tree memorises
 * the data and every feature looks essential.
 */
function growTree(forest: Forest, indices: number[], depth: number): void {
  if (depth >= forest.maxDepth || indices.length < MIN_LEAF * 2) {
    return;
  }

  const { targets, pool, featureCount, featuresPerSplit, rng } = forest;
  const n = indices.length;
  let sum = 0;
  for (const i of indices) {
    sum += targets[i];
  }
  const mean = sum / n;
  let acc = 0;
  for (const i of indices) {
    acc += (targets[i] - mean) ** 2;
  }
  const parentVar = acc / n;
  if (parentVar === 0) {
    return;
  }

  // Feature subsampling — the "random" in random forest. Without it every tree
  // splits on the single strongest feature first and the ensemble adds nothing.
  // A partial Fisher-Yates over a reused pool draws k distinct features in
  // O(k); rebuilding and splicing a fresh pool at every node was O(features).
  let best: Split | null = null;
  for (let k = 0; k < featuresPerSplit; k++) {
    const j = k + Math.floor(rng() * (featureCount - k));
    const swap = pool[k];
    pool[k] = pool[j];
    pool[j] = swap;

    const candidate = bestSplitOnFeature(
      forest,
      indices,
      pool[k],
      mean,
      parentVar,
    );
    if (candidate && candidate.gain > (best?.gain ?? 0)) {
      best = candidate;
    }
  }

  if (!best) {
    return;
  }
  forest.importance[best.feature] += best.gain;

  // One partition pass rather than two `filter` scans.
  const left: number[] = [];
  const right: number[] = [];
  for (const i of indices) {
    if (forest.rows[i][best.feature] <= best.threshold) {
      left.push(i);
    } else {
      right.push(i);
    }
  }
  growTree(forest, left, depth + 1);
  growTree(forest, right, depth + 1);
}

/**
 * Mean decrease in impurity per feature, normalised to sum to 1.
 *
 * Returns all-zero when the target never varies — no feature explains a
 * constant, and normalising would divide by zero.
 */
export function forestImportance(
  rows: number[][],
  targets: number[],
): number[] {
  const featureCount = rows[0]?.length ?? 0;
  if (featureCount === 0) {
    return [];
  }

  const forest: Forest = {
    rows,
    targets,
    featureCount,
    // sqrt(p) is the standard choice for classification; regression forests
    // usually take p/3, floored at 1 so a 1-2 parameter sweep still splits.
    featuresPerSplit: Math.max(1, Math.floor(featureCount / 3)),
    maxDepth: Math.max(2, Math.ceil(Math.log2(rows.length)) + 1),
    totalRows: rows.length,
    rng: makeRng(SEED),
    importance: new Array<number>(featureCount).fill(0),
    pool: Array.from({ length: featureCount }, (_, i) => i),
  };

  for (let t = 0; t < TREES; t++) {
    // Bootstrap sample: draw n rows with replacement.
    const bag = new Array<number>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      bag[i] = Math.floor(forest.rng() * rows.length);
    }
    growTree(forest, bag, 0);
  }

  const total = forest.importance.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return forest.importance;
  }
  return forest.importance.map((v) => v / total);
}
