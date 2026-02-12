/**
 * Data Schema Validation Tests
 *
 * Tests for the Zod schemas used to parse ClickHouse responses in
 * histogram and table data procedures. These schemas must handle
 * ClickHouse returning `step` as either a string or a number.
 *
 * Run with: vitest run tests/data-schemas.test.ts
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { histogramDataRow } from '../trpc/routers/runs/routers/data/procs/histogram.schema';
import { tableDataRow } from '../trpc/routers/runs/routers/data/procs/table.schema';

// --- Test Data ---

const VALID_HISTOGRAM_JSON = JSON.stringify({
  freq: [1, 5, 10, 3],
  bins: { min: 0.0, max: 1.0, num: 4 },
  shape: 'uniform',
  type: 'Histogram',
  maxFreq: 10,
});

const VALID_TABLE_JSON = JSON.stringify({
  col: [
    { name: 'epoch', dtype: 'int' },
    { name: 'loss', dtype: 'float' },
  ],
  table: [
    [1, 0.5],
    [2, 0.3],
  ],
});

// ============================================================================
// Test Suite: Histogram Data Row Schema
// ============================================================================

describe('Histogram Data Row Schema', () => {
  it('parses step as a string (ClickHouse default)', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: '42',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(42);
    expect(typeof result.step).toBe('number');
  });

  it('parses step as a number', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 100,
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(100);
    expect(typeof result.step).toBe('number');
  });

  it('parses step "0" correctly', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: '0',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(0);
  });

  it('parses large step values as strings', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: '999999',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(999999);
  });

  it('parses time into a Date object', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 1,
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.time).toBeInstanceOf(Date);
  });

  it('parses histogram JSON data correctly', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 1,
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.histogramData.freq).toEqual([1, 5, 10, 3]);
    expect(result.histogramData.bins.min).toBe(0.0);
    expect(result.histogramData.bins.max).toBe(1.0);
    expect(result.histogramData.shape).toBe('uniform');
    expect(result.histogramData.type).toBe('Histogram');
    expect(result.histogramData.maxFreq).toBe(10);
  });

  it('rejects non-numeric step strings', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 'abc',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    expect(() => histogramDataRow.parse(row)).toThrow();
  });

  it('rejects invalid histogram JSON', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 1,
      histogramData: JSON.stringify({ invalid: true }),
    };

    expect(() => histogramDataRow.parse(row)).toThrow();
  });
});

// ============================================================================
// Test Suite: Table Data Row Schema
// ============================================================================

describe('Table Data Row Schema', () => {
  it('parses step as a string (ClickHouse default)', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: '42',
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.step).toBe(42);
    expect(typeof result.step).toBe('number');
  });

  it('parses step as a number', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 100,
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.step).toBe(100);
    expect(typeof result.step).toBe('number');
  });

  it('parses step "0" correctly', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: '0',
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.step).toBe(0);
  });

  it('parses table JSON data correctly', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 1,
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.tableData.table).toEqual([
      [1, 0.5],
      [2, 0.3],
    ]);
    expect(result.tableData.col).toHaveLength(2);
  });

  it('parses table without optional row/col labels', () => {
    const minimalTable = JSON.stringify({
      table: [[1, 2], [3, 4]],
    });

    const row = {
      logName: 'eval/data',
      time: '2026-01-15 10:30:00',
      step: '5',
      tableData: minimalTable,
    };

    const result = tableDataRow.parse(row);
    expect(result.tableData.row).toBeUndefined();
    expect(result.tableData.col).toBeUndefined();
    expect(result.tableData.table).toEqual([[1, 2], [3, 4]]);
  });

  it('parses table with mixed string/number values', () => {
    const mixedTable = JSON.stringify({
      col: [
        { name: 'label', dtype: 'str' },
        { name: 'value', dtype: 'float' },
      ],
      table: [
        ['cat', 0.9],
        ['dog', 0.8],
      ],
    });

    const row = {
      logName: 'eval/predictions',
      time: '2026-01-15 10:30:00',
      step: 1,
      tableData: mixedTable,
    };

    const result = tableDataRow.parse(row);
    expect(result.tableData.table[0]).toEqual(['cat', 0.9]);
  });

  it('rejects non-numeric step strings', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 'abc',
      tableData: VALID_TABLE_JSON,
    };

    expect(() => tableDataRow.parse(row)).toThrow();
  });

  it('rejects invalid table JSON', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 1,
      tableData: JSON.stringify({ notATable: true }),
    };

    expect(() => tableDataRow.parse(row)).toThrow();
  });
});

// ============================================================================
// Test Suite: Schema Regression — z.string().transform(parseInt) vs z.coerce.number()
// ============================================================================

describe('Schema Regression: step field parsing', () => {
  it('z.coerce.number() handles string "42" correctly', () => {
    const schema = z.coerce.number();
    expect(schema.parse('42')).toBe(42);
  });

  it('z.coerce.number() handles number 42 correctly', () => {
    const schema = z.coerce.number();
    expect(schema.parse(42)).toBe(42);
  });

  it('z.string().transform(parseInt) REJECTS number input (the original bug)', () => {
    const brokenSchema = z.string().transform((str) => parseInt(str, 10));
    // This is the bug: if ClickHouse returns a number, z.string() rejects it
    expect(() => brokenSchema.parse(42)).toThrow();
  });

  it('z.coerce.number() rejects NaN-producing strings', () => {
    const schema = z.coerce.number();
    expect(() => schema.parse('not-a-number')).toThrow();
  });
});
