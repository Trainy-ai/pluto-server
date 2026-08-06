/**
 * Parameter importance / correlation.
 *
 * Uses the same deterministic objective as the seeded `sweep-demo` sweep, so
 * the expected ranking is known in advance rather than read off the output:
 * lr dominates, optimizer matters a little, batch_size barely at all.
 *
 * Run with: vitest run tests/param-stats.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeParamStats } from '../trpc/routers/sweeps/param-stats';

/** The exact grid the wandb seed ran: 3 lr x 2 batch x 2 optimizer. */
function demoGrid() {
  const runs: { config: Record<string, unknown>; metricValue: number }[] = [];
  for (const lr of [0.1, 0.01, 0.001]) {
    for (const batch_size of [16, 32]) {
      for (const optimizer of ['adam', 'sgd']) {
        const base = Math.log10(lr / 0.001) * 0.3;
        const penalty = optimizer === 'sgd' ? 0.15 : 0;
        const bonus = batch_size === 32 ? -0.05 : 0;
        runs.push({
          config: { lr, batch_size, optimizer },
          metricValue: 0.1 + base + penalty + bonus,
        });
      }
    }
  }
  return runs;
}

describe('Test Suite 43: Sweep parameter stats', () => {
  const KEYS = ['lr', 'batch_size', 'optimizer'];

  it('ranks lr above optimizer above batch_size', () => {
    const stats = computeParamStats(demoGrid(), KEYS);
    const rank = (k: string) => stats.findIndex((s) => s.key.startsWith(k));

    expect(rank('lr')).toBe(0);
    expect(rank('lr')).toBeLessThan(rank('optimizer'));
    expect(rank('optimizer')).toBeLessThan(rank('batch_size'));
  });

  it('one-hot expands categoricals into a row per value', () => {
    const stats = computeParamStats(demoGrid(), KEYS);
    const keys = stats.map((s) => s.key);

    expect(keys).toContain('optimizer=adam');
    expect(keys).toContain('optimizer=sgd');
    // Never a bare `optimizer` row — an arbitrary label ordering would give a
    // meaningless correlation sign.
    expect(keys).not.toContain('optimizer');
  });

  it('signs the correlation in the direction the knob moves the metric', () => {
    const stats = computeParamStats(demoGrid(), KEYS);
    const byKey = Object.fromEntries(stats.map((s) => [s.key, s]));

    // Higher lr => higher (worse) val_loss.
    expect(byKey['lr'].correlation).toBeGreaterThan(0);
    // adam lowers it, sgd raises it.
    expect(byKey['optimizer=adam'].correlation).toBeLessThan(0);
    expect(byKey['optimizer=sgd'].correlation).toBeGreaterThan(0);
  });

  it('reports importance as a 0-1 share of variance', () => {
    for (const stat of computeParamStats(demoGrid(), KEYS)) {
      expect(stat.importance).toBeGreaterThanOrEqual(0);
      expect(stat.importance).toBeLessThanOrEqual(1);
    }
  });

  it('ranks an irrelevant knob far below a real one', () => {
    // `seed` varies within each lr group, so it is independent of the metric.
    // Asserted as a wide margin rather than exactly 0: bootstrap sampling means
    // an irrelevant feature occasionally looks useful in a few trees, and on a
    // handful of rows that noise does not vanish. The ranking is the signal.
    const runs = [];
    for (const lr of [0.1, 0.01, 0.001]) {
      for (const seed of [1, 2, 3]) {
        runs.push({ config: { lr, seed }, metricValue: Math.log10(lr / 0.001) });
      }
    }
    const byKey = Object.fromEntries(
      computeParamStats(runs, ['lr', 'seed']).map((s) => [s.key, s]),
    );
    expect(byKey['lr'].importance).toBeGreaterThan(0.8);
    expect(byKey['seed'].importance).toBeLessThan(0.2);
  });

  it('finds a knob that matters non-monotonically, which correlation misses', () => {
    // Best in the middle of the range: correlation ~0, importance high. This is
    // why both numbers are reported rather than just one.
    const runs = [0, 1, 2, 3, 4, 5].map((x) => ({
      config: { x },
      metricValue: Math.abs(x - 2.5),
    }));
    const [stat] = computeParamStats(runs, ['x']);
    // The forest splits both arms of the V across depths, so it takes the full
    // share — where a single split topped out at 0.3.
    expect(stat.importance).toBeGreaterThan(0.9);
    expect(Math.abs(stat.correlation ?? 0)).toBeLessThan(0.2);
  });

  it('splits credit between two perfectly confounded knobs', () => {
    // `seed` has no causal effect but moves in lockstep with lr, so the two are
    // indistinguishable from the data. The forest shares the credit between
    // them instead of handing each the full amount, which is the main reason
    // for fitting one model over all parameters rather than scoring each alone.
    const runs = [
      { config: { lr: 0.1, seed: 1 }, metricValue: 1.0 },
      { config: { lr: 0.1, seed: 2 }, metricValue: 1.0 },
      { config: { lr: 0.01, seed: 3 }, metricValue: 0.5 },
      { config: { lr: 0.01, seed: 4 }, metricValue: 0.5 },
    ];
    const byKey = Object.fromEntries(
      computeParamStats(runs, ['lr', 'seed']).map((s) => [s.key, s]),
    );
    expect(byKey['lr'].importance).toBeLessThan(0.8);
    expect(byKey['seed'].importance).toBeLessThan(0.8);
    // Together they still account for everything.
    expect(byKey['lr'].importance + byKey['seed'].importance).toBeCloseTo(1, 5);
  });

  it('is deterministic across calls', () => {
    // The forest is seeded on purpose: bars that twitch on every page refresh
    // would be worse than a simpler, stable method.
    const a = computeParamStats(demoGrid(), KEYS);
    const b = computeParamStats(demoGrid(), KEYS);
    expect(a).toEqual(b);
  });

  it('returns nothing when too few runs scored to say anything', () => {
    expect(computeParamStats([], ['lr'])).toEqual([]);
    expect(
      computeParamStats(
        [
          { config: { lr: 0.1 }, metricValue: 1 },
          { config: { lr: 0.01 }, metricValue: 2 },
        ],
        ['lr'],
      ),
    ).toEqual([]);
  });

  it('does not one-hot explode a numeric knob when one run lacks it', () => {
    // The regression: the numeric/categorical decision used to be made over the
    // raw values, so a single missing entry — a crash before the config was
    // logged, a parameter added mid-sweep — pushed a continuous parameter down
    // the categorical path and turned every distinct float into its own
    // column. A 200-run sweep went from 10 columns to 183, and the panel filled
    // with meaningless `lr=0.0317` rows.
    const runs: { config: Record<string, unknown>; metricValue: number }[] = [];
    for (let i = 0; i < 30; i++) {
      runs.push({ config: { lr: i / 100 }, metricValue: i / 100 });
    }
    // One run never recorded `lr`.
    runs.push({ config: {}, metricValue: 0.5 });

    const stats = computeParamStats(runs, ['lr']);
    expect(stats).toHaveLength(1);
    expect(stats[0].key).toBe('lr');
    // Still ranks as the monotonic driver it is, rather than as 30 dead rows.
    expect(stats[0].importance).toBeCloseTo(1, 5);
    expect(stats[0].correlation).toBeCloseTo(1, 5);
  });

  it('drops a numeric knob that never varied', () => {
    // A constant column explains nothing, and it would still occupy a slot in
    // the forest's per-split feature subsample — diluting the draw for the
    // parameters that do vary. The categorical path already rejected these.
    const runs = [0.1, 0.01, 0.001, 0.5].map((lr, i) => ({
      config: { lr, seed: 42 },
      metricValue: i,
    }));
    expect(computeParamStats(runs, ['lr', 'seed']).map((s) => s.key)).toEqual(['lr']);
  });

  it('ignores a parameter only one or two runs carry', () => {
    // Two data points cannot support an importance number, and imputing the
    // other twenty-eight would be inventing the answer.
    const runs = Array.from({ length: 30 }, (_, i) => ({
      config: i < 2 ? { lr: i / 10, rare: i } : { lr: i / 10 },
      metricValue: i,
    }));
    expect(computeParamStats(runs, ['lr', 'rare']).map((s) => s.key)).toEqual(['lr']);
  });

  it('treats NaN and Infinity in a config as absent, not as numbers', () => {
    const runs = Array.from({ length: 12 }, (_, i) => ({
      config: { lr: i === 0 ? NaN : i === 1 ? Infinity : i / 10 },
      metricValue: i,
    }));
    const stats = computeParamStats(runs, ['lr']);
    expect(stats).toHaveLength(1);
    expect(stats[0].key).toBe('lr');
    expect(Number.isFinite(stats[0].importance)).toBe(true);
    expect(stats[0].correlation).toBeCloseTo(1, 5);
  });

  it('ignores runs that never logged the objective', () => {
    // Dropped, not zero-filled: a missing metric is not a metric of 0.
    const runs = [
      { config: { lr: 0.1 }, metricValue: 1.0 },
      { config: { lr: 0.01 }, metricValue: 0.5 },
      { config: { lr: 0.001 }, metricValue: 0.1 },
      { config: { lr: 0.5 }, metricValue: null },
    ];
    const [stat] = computeParamStats(runs, ['lr']);
    expect(stat.correlation).toBeCloseTo(1, 5);
  });
});
