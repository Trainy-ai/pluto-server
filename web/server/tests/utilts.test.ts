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

/**
 * Statistics endpoint pushes the logGroup filter into ClickHouse via:
 *   arrayStringConcat(arraySlice(splitByChar('/', logName), 1, -1), '/')
 *
 * This must stay equivalent to getLogGroupName for non-empty logNames,
 * otherwise `?logGroup=...` returns the wrong rows. This reimplements
 * the CH expression in TS and checks parity against a representative
 * set of metric names — including the empty-string group (top-level
 * metrics like "loss") that motivated the fix.
 */
describe('logGroup CH expression parity with getLogGroupName', () => {
  // arraySlice(arr, 1, -1) in CH returns arr with the last element dropped
  // (offset 1 = start, length -1 = drop one from the end).
  function chLogGroupExpr(logName: string): string {
    const parts = logName.split('/');
    return parts.slice(0, parts.length - 1).join('/');
  }

  const cases = [
    'loss',
    'train/loss',
    'val/metric',
    'val/metric/metric2',
    'val/metric/metric2/metric3',
    'optimizer/param_groups/0/lr',
  ];

  it.each(cases)('matches getLogGroupName for %s', (logName) => {
    expect(chLogGroupExpr(logName)).toBe(getLogGroupName(logName));
  });

  it('top-level metrics produce empty-string group (matches ?logGroup=)', () => {
    // Truthiness-based guards (`if (logGroup)`) skip "" and break this case;
    // the route must use `logGroup !== undefined` to honor it.
    expect(chLogGroupExpr('loss')).toBe('');
    expect(getLogGroupName('loss')).toBe('');
  });
});
