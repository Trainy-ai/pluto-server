/**
 * Unit tests for the getLogGroupName utility.
 *
 * When metrics are ingested, each metric has a logName like "train/loss"
 * or "val/metrics/accuracy". The log group is everything before the last
 * "/" separator — it groups related metrics together in the UI.
 *
 * Examples from the source code comments:
 *   "metric"                      → ""
 *   "val/metric"                  → "val"
 *   "val/metric/metric2"          → "val/metric"
 *   "val/metric/metric2/metric3"  → "val/metric/metric2"
 */

import { describe, it, expect } from 'vitest';
import { getLogGroupName } from '../lib/utilts';

describe('getLogGroupName', () => {
  // --- Documented examples ---

  it('single segment returns empty string', () => {
    expect(getLogGroupName('metric')).toBe('');
  });

  it('two segments returns the first segment', () => {
    expect(getLogGroupName('val/metric')).toBe('val');
  });

  it('three segments returns first two segments joined', () => {
    expect(getLogGroupName('val/metric/metric2')).toBe('val/metric');
  });

  it('four segments returns first three segments joined', () => {
    expect(getLogGroupName('val/metric/metric2/metric3')).toBe('val/metric/metric2');
  });

  // --- Real-world metric names ---

  it('handles typical training metric names', () => {
    expect(getLogGroupName('train/loss')).toBe('train');
    expect(getLogGroupName('train/accuracy')).toBe('train');
    expect(getLogGroupName('val/loss')).toBe('val');
  });

  it('handles nested log groups', () => {
    expect(getLogGroupName('optimizer/param_groups/0/lr')).toBe('optimizer/param_groups/0');
  });

  // --- Edge cases ---

  it('returns undefined for empty string', () => {
    expect(getLogGroupName('')).toBeUndefined();
  });
});
