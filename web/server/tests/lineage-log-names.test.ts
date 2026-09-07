import { describe, it, expect } from 'vitest';
import { buildLineageLogUnion } from '../trpc/routers/runs/procs/get-logs-by-run-ids';

const log = (runId: number, logName: string, logType = 'METRIC', logGroup = 'train') => ({
  runId: BigInt(runId), logGroup, logName, logType,
});

describe('buildLineageLogUnion', () => {
  it('unions ancestor log names into the requested run', () => {
    const chains = new Map([[2n, [2n, 1n]]]);
    const logsByOwner = new Map([
      [1n, [log(1, 'train/loss'), log(1, 'val/loss')]],
      [2n, [log(2, 'train/loss')]],
    ]);
    const result = buildLineageLogUnion(chains, logsByOwner);
    const names = result.get(2n)!.map((l) => l.logName).sort();
    expect(names).toEqual(['train/loss', 'val/loss']);
  });

  it("the requested run's own row wins a logName collision", () => {
    const chains = new Map([[2n, [2n, 1n]]]);
    const logsByOwner = new Map([
      [1n, [log(1, 'train/loss', 'METRIC', 'old-group')]],
      [2n, [log(2, 'train/loss', 'METRIC', 'train')]],
    ]);
    const result = buildLineageLogUnion(chains, logsByOwner);
    const rows = result.get(2n)!;
    expect(rows).toHaveLength(1);
    expect(rows[0].runId).toBe(2n);
    expect(rows[0].logGroup).toBe('train');
  });

  it('a root run without ancestors is returned unchanged', () => {
    const chains = new Map([[1n, [1n]]]);
    const logsByOwner = new Map([[1n, [log(1, 'train/loss')]]]);
    const result = buildLineageLogUnion(chains, logsByOwner);
    expect(result.get(1n)!.map((l) => l.logName)).toEqual(['train/loss']);
  });

  it('walks multi-level chains (child, parent, grandparent)', () => {
    const chains = new Map([[3n, [3n, 2n, 1n]]]);
    const logsByOwner = new Map([
      [1n, [log(1, 'a')]],
      [2n, [log(2, 'b')]],
      [3n, [log(3, 'c')]],
    ]);
    const result = buildLineageLogUnion(chains, logsByOwner);
    expect(result.get(3n)!.map((l) => l.logName).sort()).toEqual(['a', 'b', 'c']);
  });
});
