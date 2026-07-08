import { describe, it, expect } from 'vitest';
import { RunTableViewConfigSchema } from '../lib/run-table-view-types';

const BASE_CONFIG = {
  version: 1,
  columns: [],
  baseOverrides: {},
  filters: [],
  sorting: [],
};

describe('RunTableViewConfigSchema lenient groupBy parse', () => {
  it('accepts a missing groupBy (legacy view)', () => {
    const parsed = RunTableViewConfigSchema.parse(BASE_CONFIG);
    expect(parsed.groupBy).toBeUndefined();
  });

  it('accepts an empty array', () => {
    const parsed = RunTableViewConfigSchema.parse({ ...BASE_CONFIG, groupBy: [] });
    expect(parsed.groupBy).toEqual([]);
  });

  it('accepts an array of field strings (v2 form)', () => {
    const parsed = RunTableViewConfigSchema.parse({
      ...BASE_CONFIG,
      groupBy: ['tag-prefix:group', 'system:status'],
    });
    expect(parsed.groupBy).toEqual(['tag-prefix:group', 'system:status']);
  });

  it('normalizes legacy null to undefined', () => {
    const parsed = RunTableViewConfigSchema.parse({ ...BASE_CONFIG, groupBy: null });
    expect(parsed.groupBy).toBeUndefined();
  });

  it('normalizes the v1 sentinel string "group" to ["tag-prefix:group"]', () => {
    const parsed = RunTableViewConfigSchema.parse({ ...BASE_CONFIG, groupBy: 'group' });
    expect(parsed.groupBy).toEqual(['tag-prefix:group']);
  });

  it('normalizes any other lone string into a single-element array', () => {
    // Defensive — if someone hand-edited a row with another sentinel,
    // we still parse rather than blow up the view.
    const parsed = RunTableViewConfigSchema.parse({
      ...BASE_CONFIG,
      groupBy: 'system:status',
    });
    expect(parsed.groupBy).toEqual(['system:status']);
  });

  it('rejects nonsense types (number, object)', () => {
    expect(() =>
      RunTableViewConfigSchema.parse({ ...BASE_CONFIG, groupBy: 42 }),
    ).toThrow();
    expect(() =>
      RunTableViewConfigSchema.parse({ ...BASE_CONFIG, groupBy: { x: 1 } }),
    ).toThrow();
  });
});
