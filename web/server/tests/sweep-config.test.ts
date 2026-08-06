/**
 * Sweep search-space parsing.
 *
 * These two functions carry the whole native-vs-migrated difference, so they
 * are tested directly rather than through the procedures:
 *
 * - a **migrated** sweep declares its search space in `config.wandb.sweep`
 * - a **native** `pluto.sweep()` declares nothing server-side (the SDK keeps its
 *   config in `~/.pluto/sweeps`), so the swept knobs have to be inferred from
 *   what actually varies across the runs
 *
 * Run with: vitest run tests/sweep-config.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseSweepBlock, inferSweptKeys } from '../trpc/routers/sweeps/sweep-config';

describe('Test Suite 42: Sweep config parsing', () => {
  describe('parseSweepBlock (migrated sweeps)', () => {
    it('reads name, method, metric and parameters from a wandb block', () => {
      // Shape verified against a real migrated run (`sweep:cvxvtpim`).
      const meta = parseSweepBlock({
        id: 'cvxvtpim',
        name: 'cvxvtpim',
        config: {
          method: 'grid',
          metric: { goal: 'minimize', name: 'loss' },
          parameters: { lr: { values: [0.1, 0.01, 0.001] } },
        },
      });

      expect(meta.name).toBe('cvxvtpim');
      expect(meta.method).toBe('grid');
      expect(meta.metric).toEqual({ name: 'loss', goal: 'minimize' });
      expect(meta.parameters).toEqual({ lr: { values: [0.1, 0.01, 0.001] } });
    });

    it('defaults an omitted goal to minimize, like wandb does', () => {
      const meta = parseSweepBlock({ config: { metric: { name: 'loss' } } });
      expect(meta.metric).toEqual({ name: 'loss', goal: 'minimize' });
    });

    it('normalises an unrecognised goal rather than passing it through', () => {
      // The goal reaches a two-item picker and a "best run" comparison. A
      // string that is neither direction left the picker blank and silently
      // took the minimize branch anyway, so say so instead.
      expect(parseSweepBlock({ config: { metric: { name: 'loss', goal: 'min' } } }).metric)
        .toEqual({ name: 'loss', goal: 'minimize' });
      expect(parseSweepBlock({ config: { metric: { name: 'loss', goal: 42 } } }).metric)
        .toEqual({ name: 'loss', goal: 'minimize' });
      expect(parseSweepBlock({ config: { metric: { name: 'loss', goal: 'maximize' } } }).metric)
        .toEqual({ name: 'loss', goal: 'maximize' });
    });

    it('reads the flat block a native sweep stamps at config.sweep', () => {
      // Native runs carry {id, method, metric, parameters} directly, with no
      // nested `config` and no `name` (pluto 7225ba9). Shape taken from a real
      // run of the bayes sweep `k6lpiz3t`.
      const meta = parseSweepBlock({
        id: 'k6lpiz3t',
        method: 'bayes',
        metric: { goal: 'maximize', name: 'loss' },
        parameters: { x: { max: 1, min: 0 } },
      });

      expect(meta.method).toBe('bayes');
      expect(meta.metric).toEqual({ name: 'loss', goal: 'maximize' });
      expect(meta.parameters).toEqual({ x: { max: 1, min: 0 } });
      // No name is declared for native sweeps; the id stands in.
      expect(meta.name).toBeUndefined();
    });

    it('returns empty for a pre-7225ba9 native run, which has no block at all', () => {
      // The important case: absent is normal, not an error.
      expect(parseSweepBlock(undefined)).toEqual({});
      expect(parseSweepBlock(null)).toEqual({});
    });

    it('survives a malformed block instead of throwing', () => {
      expect(parseSweepBlock('not-an-object')).toEqual({});
      expect(parseSweepBlock([1, 2, 3])).toEqual({});
      expect(parseSweepBlock({ config: 'nope' })).toEqual({});
      // A metric without a name is unusable, so it is dropped rather than
      // half-populated.
      expect(parseSweepBlock({ config: { metric: { goal: 'maximize' } } }).metric)
        .toBeUndefined();
    });
  });

  describe('inferSweptKeys (native sweeps)', () => {
    const nativeConfigs = [
      { lr: 0.1, batch_size: 16, seed: 42 },
      { lr: 0.1, batch_size: 32, seed: 42 },
      { lr: 0.01, batch_size: 16, seed: 42 },
      { lr: 0.01, batch_size: 32, seed: 42 },
    ];

    it('infers the varying keys and ignores constant ones', () => {
      // `seed` is the same in every run, so it was not swept — including it
      // would add a flat, meaningless axis to the chart.
      expect(inferSweptKeys(nativeConfigs)).toEqual(['batch_size', 'lr']);
    });

    it('prefers the declared search space when there is one', () => {
      // A migrated grid may have only one of its combinations present (the
      // others failed, or the export was partial). The declared space is still
      // the truth about what was swept.
      expect(inferSweptKeys([{ lr: 0.1 }], { lr: { values: [0.1, 0.01] } })).toEqual(['lr']);
    });

    it('falls back to inference when the declared space is empty', () => {
      expect(inferSweptKeys(nativeConfigs, {})).toEqual(['batch_size', 'lr']);
    });

    it('ignores nested blocks like config.wandb', () => {
      // `wandb` is migration bookkeeping, not a hyperparameter, and it differs
      // per run (it holds each run's own url), so a naive diff would surface it.
      const configs = [
        { lr: 0.1, wandb: { url: 'https://wandb.ai/a' } },
        { lr: 0.01, wandb: { url: 'https://wandb.ai/b' } },
      ];
      expect(inferSweptKeys(configs)).toEqual(['lr']);
    });

    it('handles categorical hyperparameters', () => {
      const configs = [{ optimizer: 'adam' }, { optimizer: 'sgd' }];
      expect(inferSweptKeys(configs)).toEqual(['optimizer']);
    });

    it('returns nothing when every run used the same configuration', () => {
      // A one-run sweep, or a grid of size 1 — the chart shows its empty state.
      expect(inferSweptKeys([{ lr: 0.1 }, { lr: 0.1 }])).toEqual([]);
      expect(inferSweptKeys([])).toEqual([]);
    });
  });
});
