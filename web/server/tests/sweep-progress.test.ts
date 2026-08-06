/**
 * Sweep state / progress derived from runs.
 *
 * These exist because there is no sweep entity: everything the UI shows about a
 * sweep's state is inferred from the runs carrying its tag, so the inference
 * rules are the contract.
 *
 * Run with: vitest run tests/sweep-progress.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeStatuses,
  deriveState,
  gridTotal,
} from '../trpc/routers/sweeps/sweep-progress';

describe('Test Suite 44: Sweep state and progress', () => {
  describe('summarizeStatuses', () => {
    it('counts each outcome', () => {
      const counts = summarizeStatuses(['COMPLETED', 'COMPLETED', 'RUNNING', 'FAILED']);
      expect(counts).toEqual({
        total: 4,
        running: 1,
        completed: 2,
        failed: 1,
        other: 0,
      });
    });

    it('groups terminated and cancelled with failed', () => {
      // For judging a sweep, what matters is that these produced no usable
      // result — not the particular way they stopped.
      const counts = summarizeStatuses(['TERMINATED', 'CANCELLED', 'FAILED']);
      expect(counts.failed).toBe(3);
      expect(counts.other).toBe(0);
    });

    it('handles an empty sweep', () => {
      expect(summarizeStatuses([]).total).toBe(0);
    });
  });

  describe('deriveState', () => {
    it('is RUNNING while any run is', () => {
      expect(deriveState(summarizeStatuses(['COMPLETED', 'RUNNING']), 12)).toBe('RUNNING');
    });

    it('is FINISHED once none are', () => {
      // No grid total, so there is no coverage to fall short of.
      expect(deriveState(summarizeStatuses(['COMPLETED', 'FAILED']))).toBe('FINISHED');
      // A sweep whose every run failed still isn't running.
      expect(deriveState(summarizeStatuses(['FAILED']))).toBe('FINISHED');
    });

    it('is INCOMPLETE when a grid stopped short of its combinations', () => {
      // 6 of 12 with nothing running: the agent died or was killed. Without
      // this, it is indistinguishable from a grid that genuinely finished, and
      // its "best run" reads as the best of the space rather than of a fragment.
      const six = summarizeStatuses(Array(6).fill('COMPLETED'));
      expect(deriveState(six, 12)).toBe('INCOMPLETE');
      expect(deriveState(six, 6)).toBe('FINISHED');
    });

    it('counts completed runs toward coverage, not attempted ones', () => {
      // All 12 combinations ran; half crashed. That leaves the same
      // six-combination hole in the results as an agent that died halfway, and
      // the hole is what makes the "best run" the best of a fragment.
      const half = summarizeStatuses([
        ...Array(6).fill('COMPLETED'),
        ...Array(4).fill('FAILED'),
        ...Array(2).fill('CANCELLED'),
      ]);
      expect(half.total).toBe(12);
      expect(deriveState(half, 12)).toBe('INCOMPLETE');
    });

    it('never claims INCOMPLETE without a target count', () => {
      // Random and bayes have no denominator, so short of what?
      expect(deriveState(summarizeStatuses(['COMPLETED']), null)).toBe('FINISHED');
      expect(deriveState(summarizeStatuses(['COMPLETED']))).toBe('FINISHED');
    });
  });

  describe('gridTotal', () => {
    it('multiplies the value counts of a grid', () => {
      // The seeded wandb sweep: 3 x 2 x 2.
      expect(
        gridTotal('grid', {
          lr: { values: [0.1, 0.01, 0.001] },
          batch_size: { values: [16, 32] },
          optimizer: { values: ['adam', 'sgd'] },
        }),
      ).toBe(12);
    });

    it('returns null for random and bayes', () => {
      // They run until told to stop, so there is no denominator — showing
      // "3 of 12" would be inventing one.
      const params = { lr: { values: [0.1, 0.01] } };
      expect(gridTotal('random', params)).toBeNull();
      expect(gridTotal('bayes', params)).toBeNull();
      expect(gridTotal(undefined, params)).toBeNull();
    });

    it('returns null when any axis is continuous', () => {
      // A {min,max} range has no finite grid.
      expect(
        gridTotal('grid', {
          lr: { min: 0.0001, max: 0.1 },
          batch_size: { values: [16, 32] },
        }),
      ).toBeNull();
    });

    it('returns null when the search space is unknown', () => {
      expect(gridTotal('grid', undefined)).toBeNull();
      // A declared-but-empty block is a space we do not know, not a grid of
      // one. Returning 1 rendered "20 of 1 grid configurations" and marked
      // every such sweep FINISHED regardless of its coverage.
      expect(gridTotal('grid', {})).toBeNull();
    });

    it('ignores fixed knobs when computing the product', () => {
      // wandb allows `{ value: ... }` to pin a constant across the sweep.
      // Treating that as "no values array" used to null the whole total and
      // hide INCOMPLETE for common grids that mix lists with fixed params.
      expect(
        gridTotal('grid', {
          lr: { values: [0.1, 0.01] },
          batch_size: { values: [16, 32] },
          seed: { value: 42 },
        }),
      ).toBe(4);
    });
  });
});
