/**
 * Unit tests for buildFieldFilterConditions and buildValueCondition
 * from list-runs.ts.
 *
 * Tests the SQL generation for field filters against run_field_values.
 * These functions generate EXISTS subqueries with parameterized SQL.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFieldFilterConditions,
  buildValueCondition,
} from '../trpc/routers/runs/procs/list-runs';

describe('buildFieldFilterConditions', () => {
  it('should do nothing when fieldFilters is empty', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    buildFieldFilterConditions(conditions, params, []);
    expect(conditions).toHaveLength(0);
    expect(params).toHaveLength(0);
  });

  it('should do nothing when fieldFilters is undefined', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    buildFieldFilterConditions(conditions, params, undefined);
    expect(conditions).toHaveLength(0);
    expect(params).toHaveLength(0);
  });

  it('should generate EXISTS subquery for "exists" operator', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1']; // pre-existing param
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'batch_size', dataType: 'number', operator: 'exists', values: [] },
    ]);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('EXISTS');
    expect(conditions[0]).toContain('run_field_values');
    expect(conditions[0]).toContain('fv0');
    // Should have added source and key params
    expect(params).toContain('config');
    expect(params).toContain('batch_size');
  });

  it('should generate NOT EXISTS subquery for "not exists" operator', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1'];
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'optional_field', dataType: 'text', operator: 'not exists', values: [] },
    ]);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('NOT EXISTS');
  });

  it('should generate value comparison for numeric "is" operator', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1'];
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
    ]);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('EXISTS');
    expect(conditions[0]).toContain('"numericValue"');
    expect(params).toContain(32);
  });

  it('should handle multiple filters with separate aliases', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1'];
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
      { source: 'config', key: 'lr', dataType: 'number', operator: 'is greater than', values: [0.001] },
    ]);

    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toContain('fv0');
    expect(conditions[1]).toContain('fv1');
  });

  it('should use correct source in subquery for systemMetadata', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    buildFieldFilterConditions(conditions, params, [
      { source: 'systemMetadata', key: 'hostname', dataType: 'text', operator: 'contains', values: ['gpu'] },
    ]);

    expect(params).toContain('systemMetadata');
    expect(params).toContain('hostname');
  });
});

describe('buildValueCondition', () => {
  // ─── Text filters ──────────────────────────────────────────────────

  describe('text dataType', () => {
    it('should generate ILIKE for "contains"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'contains', values: ['gpt'],
      }, params);

      expect(result).toContain('ILIKE');
      expect(result).toContain('"textValue"');
      expect(params).toContain('gpt');
    });

    it('should generate NOT ILIKE for "does not contain"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'does not contain', values: ['old'],
      }, params);

      expect(result).toContain('NOT ILIKE');
      expect(result).toContain('IS NULL OR');
    });

    it('should generate exact match for "is"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'is', values: ['gpt-4'],
      }, params);

      expect(result).toContain('"textValue" =');
      expect(params).toContain('gpt-4');
    });

    it('should generate not-equal for "is not"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'is not', values: ['gpt-3'],
      }, params);

      expect(result).toContain('IS NULL OR');
      expect(result).toContain('!=');
    });

    it('should generate ILIKE prefix for "starts with"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'starts with', values: ['gpt'],
      }, params);

      expect(result).toContain("ILIKE");
      expect(result).toContain("|| '%'");
      expect(result).not.toContain("'%' ||");
    });

    it('should generate ILIKE suffix for "ends with"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'ends with', values: ['large'],
      }, params);

      expect(result).toContain("ILIKE");
      expect(result).toContain("'%' ||");
    });

    it('should generate regex for "regex"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'regex', values: ['^gpt-\\d+'],
      }, params);

      expect(result).toContain('~');
      expect(params).toContain('^gpt-\\d+');
    });

    it('should return null for unknown text operator', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'model', dataType: 'text',
        operator: 'unknown_op', values: ['test'],
      }, params);

      expect(result).toBeNull();
    });
  });

  // ─── Number filters ────────────────────────────────────────────────

  describe('number dataType', () => {
    it('should generate equality for "is"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'batch_size', dataType: 'number',
        operator: 'is', values: [32],
      }, params);

      expect(result).toContain('"numericValue" =');
      expect(params).toContain(32);
    });

    it('should generate not-equal for "is not"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'batch_size', dataType: 'number',
        operator: 'is not', values: [32],
      }, params);

      expect(result).toContain('IS NULL OR');
      expect(result).toContain('"numericValue" !=');
    });

    it('should generate > for "is greater than"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'lr', dataType: 'number',
        operator: 'is greater than', values: [0.001],
      }, params);

      expect(result).toContain('"numericValue" >');
      expect(params).toContain(0.001);
    });

    it('should generate < for "is less than"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'lr', dataType: 'number',
        operator: 'is less than', values: [1.0],
      }, params);

      expect(result).toContain('"numericValue" <');
    });

    it('should generate >= for ">="', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'epochs', dataType: 'number',
        operator: '>=', values: [100],
      }, params);

      expect(result).toContain('"numericValue" >=');
    });

    it('should generate <= for "<="', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'epochs', dataType: 'number',
        operator: '<=', values: [100],
      }, params);

      expect(result).toContain('"numericValue" <=');
    });

    it('should generate BETWEEN for "is between"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'batch_size', dataType: 'number',
        operator: 'is between', values: [7, 25],
      }, params);

      expect(result).toContain('BETWEEN');
      expect(params).toContain(7);
      expect(params).toContain(25);
    });

    it('should generate NOT BETWEEN for "is not between"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'batch_size', dataType: 'number',
        operator: 'is not between', values: [7, 25],
      }, params);

      expect(result).toContain('NOT BETWEEN');
      expect(result).toContain('IS NULL OR');
    });

    it('should return null for NaN values', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'batch_size', dataType: 'number',
        operator: 'is', values: ['not-a-number'],
      }, params);

      expect(result).toBeNull();
    });

    it('should return null for NaN in "is between"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'batch_size', dataType: 'number',
        operator: 'is between', values: ['abc', 25],
      }, params);

      expect(result).toBeNull();
    });
  });

  // ─── Date filters ──────────────────────────────────────────────────

  describe('date dataType', () => {
    it('should generate < for "is before"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'start_date', dataType: 'date',
        operator: 'is before', values: ['2026-01-01T00:00:00Z'],
      }, params);

      expect(result).toContain('"textValue" <');
    });

    it('should generate > for "is after"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'start_date', dataType: 'date',
        operator: 'is after', values: ['2026-01-01T00:00:00Z'],
      }, params);

      expect(result).toContain('"textValue" >');
    });

    it('should generate BETWEEN for "is between"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'start_date', dataType: 'date',
        operator: 'is between', values: ['2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z'],
      }, params);

      expect(result).toContain('BETWEEN');
    });
  });

  // ─── Option filters ────────────────────────────────────────────────

  describe('option dataType', () => {
    it('should generate ANY for "is any of"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'optimizer', dataType: 'option',
        operator: 'is any of', values: ['adam', 'sgd', 'rmsprop'],
      }, params);

      expect(result).toContain('ANY');
      expect(result).toContain('"textValue"');
    });

    it('should generate ALL for "is none of"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'optimizer', dataType: 'option',
        operator: 'is none of', values: ['adam', 'sgd'],
      }, params);

      expect(result).toContain('ALL');
      expect(result).toContain('IS NULL OR');
    });

    it('should generate equality for "is"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'optimizer', dataType: 'option',
        operator: 'is', values: ['adam'],
      }, params);

      expect(result).toContain('"textValue" =');
    });

    it('should generate not-equal for "is not"', () => {
      const params: any[] = [];
      const result = buildValueCondition('fv0', {
        source: 'config', key: 'optimizer', dataType: 'option',
        operator: 'is not', values: ['adam'],
      }, params);

      expect(result).toContain('IS NULL OR');
      expect(result).toContain('!=');
    });
  });

  // ─── Unknown dataType ──────────────────────────────────────────────

  it('should return null for unknown dataType', () => {
    const params: any[] = [];
    const result = buildValueCondition('fv0', {
      source: 'config', key: 'test', dataType: 'unknown' as any,
      operator: 'is', values: ['test'],
    }, params);

    expect(result).toBeNull();
  });
});
