/**
 * Unit tests for buildFieldFilterConditions and buildValueCondition
 * (field-filter-sql.ts, re-exported from list-runs.ts).
 *
 * Tests the SQL generation for field filters against run_field_values.
 * Positive operators generate correlated EXISTS subqueries; negated operators
 * (and "not exists") generate uncorrelated `r.id NOT IN (...)` subqueries so
 * Postgres always evaluates them as a single hashed-subplan pass (see the
 * incident notes on buildFieldFilterConditions).
 */

import { describe, it, expect } from 'vitest';
import {
  buildFieldFilterConditions,
  buildValueCondition,
} from '../trpc/routers/runs/procs/list-runs';

// Default scope for tests: a resolved project id (the common case).
const SCOPE = { organizationId: 'org-1', projectId: 123n };

describe('buildFieldFilterConditions', () => {
  it('should do nothing when fieldFilters is empty', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    buildFieldFilterConditions(conditions, params, [], SCOPE);
    expect(conditions).toHaveLength(0);
    expect(params).toHaveLength(0);
  });

  it('should do nothing when fieldFilters is undefined', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    buildFieldFilterConditions(conditions, params, undefined, SCOPE);
    expect(conditions).toHaveLength(0);
    expect(params).toHaveLength(0);
  });

  it('should generate EXISTS subquery for "exists" operator', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1']; // pre-existing param
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'batch_size', dataType: 'number', operator: 'exists', values: [] },
    ], SCOPE);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('EXISTS');
    expect(conditions[0]).toContain('run_field_values');
    expect(conditions[0]).toContain('fv0');
    // Should have added source and key params
    expect(params).toContain('config');
    expect(params).toContain('batch_size');
  });

  it('should generate an uncorrelated NOT IN subquery for "not exists" operator', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1'];
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'optional_field', dataType: 'text', operator: 'not exists', values: [] },
    ], SCOPE);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('r.id NOT IN');
    expect(conditions[0]).not.toContain('NOT EXISTS');
  });

  it('should generate value comparison for numeric "is" operator', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1'];
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
    ], SCOPE);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('EXISTS');
    expect(conditions[0]).toContain('"numericValue"');
    // Numeric values bind as strings cast with ::double precision (see the
    // regression suite below) — never as a raw JS number.
    expect(params).toContain('32');
  });

  it('should handle multiple filters with separate aliases', () => {
    const conditions: string[] = [];
    const params: any[] = ['org-1'];
    buildFieldFilterConditions(conditions, params, [
      { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
      { source: 'config', key: 'lr', dataType: 'number', operator: 'is greater than', values: [0.001] },
    ], SCOPE);

    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toContain('fv0');
    expect(conditions[1]).toContain('fv1');
  });

  it('correlates positive-operator subqueries on projectId (index-friendly semi-join)', () => {
    // Positive filters stay as correlated EXISTS; the projectId correlation
    // lets Postgres use the rfv_proj_src_key_num index in the semi-join.
    for (const op of ['exists', 'is any of', 'contains', 'is'] as const) {
      const conditions: string[] = [];
      const params: any[] = ['org-1'];
      buildFieldFilterConditions(conditions, params, [
        { source: 'config', key: 'model.name', dataType: op === 'is any of' ? 'option' : 'text', operator: op, values: ['a'] },
      ], SCOPE);
      expect(conditions).toHaveLength(1);
      expect(conditions[0], `operator "${op}" must correlate on projectId`).toContain(
        '."projectId" = r."projectId"',
      );
    }
  });

  describe('negated operators compile to an uncorrelated NOT IN (hashed-subplan) shape', () => {
    // Incident regression guard (2026-07-09 prod P2024 storm): a negated filter
    // compiled as a correlated NOT EXISTS anti-join is at the planner's mercy —
    // under a row-count misestimate Postgres picks a nested-loop-with-Materialize
    // plan that rescans the materialized match set once per run (~500s at 170K
    // runs; starved the 5-connection Prisma pool). An uncorrelated
    // `r.id NOT IN (SELECT ...)` is always ONE inner scan + hashed-subplan
    // probes, independent of join planning, so the subquery must contain NO
    // reference to the outer alias `r`.
    const NEGATED: Array<{ op: string; dataType: string; values: unknown[] }> = [
      { op: 'is none of', dataType: 'option', values: [['a', 'b']] },
      { op: 'is not', dataType: 'text', values: ['a'] },
      { op: 'does not contain', dataType: 'text', values: ['a'] },
      { op: 'is not between', dataType: 'number', values: [1, 2] },
      { op: 'not exists', dataType: 'text', values: [] },
    ];

    for (const { op, dataType, values } of NEGATED) {
      it(`"${op}" emits r.id NOT IN with no outer correlation`, () => {
        const conditions: string[] = [];
        const params: any[] = ['org-1'];
        buildFieldFilterConditions(conditions, params, [
          { source: 'config', key: 'model.name', dataType: dataType as any, operator: op, values },
        ], SCOPE);
        expect(conditions).toHaveLength(1);
        const sql = conditions[0];
        expect(sql).toContain('r.id NOT IN');
        // Uncorrelated: past the leading "r.id NOT IN", nothing may reference
        // the outer alias.
        const inner = sql.replace('r.id NOT IN', '');
        expect(inner, `subquery for "${op}" must not correlate on r`).not.toMatch(/\br\./);
        // Negation is applied by NOT IN alone — the subquery matches the
        // POSITIVE condition (no doubled negation).
        expect(sql).not.toContain('NOT EXISTS');
      });
    }

    it('scopes the subquery by the resolved projectId when available', () => {
      const conditions: string[] = [];
      const params: any[] = [];
      buildFieldFilterConditions(conditions, params, [
        { source: 'config', key: 'user', dataType: 'option', operator: 'is none of', values: [['a']] },
      ], { organizationId: 'org-1', projectId: 42n });
      expect(conditions[0]).toContain('."projectId" = $');
      expect(params).toContain(42n);
    });

    it('scopes the subquery via a projects scalar subquery when only projectName is known', () => {
      const conditions: string[] = [];
      const params: any[] = [];
      buildFieldFilterConditions(conditions, params, [
        { source: 'config', key: 'user', dataType: 'option', operator: 'is none of', values: [['a']] },
      ], { organizationId: 'org-1', projectName: 'proj-a' });
      expect(conditions[0]).toContain('SELECT sp.id FROM "projects" sp');
      expect(params).toContain('org-1');
      expect(params).toContain('proj-a');
      // Still uncorrelated w.r.t. the outer runs alias.
      expect(conditions[0].replace('r.id NOT IN', '')).not.toMatch(/\br\./);
    });

    it('falls back to organizationId scope when no project is known', () => {
      const conditions: string[] = [];
      const params: any[] = [];
      buildFieldFilterConditions(conditions, params, [
        { source: 'config', key: 'user', dataType: 'option', operator: 'is none of', values: [['a']] },
      ], { organizationId: 'org-1' });
      expect(conditions[0]).toContain('."organizationId" = $');
      expect(params).toContain('org-1');
    });
  });

  it('should use correct source in subquery for systemMetadata', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    buildFieldFilterConditions(conditions, params, [
      { source: 'systemMetadata', key: 'hostname', dataType: 'text', operator: 'contains', values: ['gpu'] },
    ], SCOPE);

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
      expect(params).toContain('32');
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
      expect(params).toContain('0.001');
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
      expect(params).toContain('7');
      expect(params).toContain('25');
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

    // ─── Regression: binary-format / prepared-statement plan caching ──────
    //
    // `numericValue` is a Float8 column and the generated SQL text is identical
    // for every value, so Prisma's per-connection prepared-statement cache locks
    // the bind param's binary type to whatever value first prepared it. An
    // integer prepares it as int binary; a subsequent float on the SAME cached
    // statement is sent as float8 binary and Postgres rejects it with
    // `22P03 incorrect binary data format in bind parameter N`. The fix is to
    // bind every numeric value as a STRING cast with `$N::double precision` so
    // the wire format is always text (deterministic) and the cached plan stays
    // valid for both integer- and float-valued filters. These tests pin that
    // contract at the SQL/param level; without it the runtime query 22P03s.
    describe('binary-format regression (string param + ::double precision cast)', () => {
      const NUMERIC_CASES: Array<{ operator: string; values: unknown[]; expectedParams: string[] }> = [
        { operator: 'is', values: [32], expectedParams: ['32'] },
        { operator: 'is not', values: [32], expectedParams: ['32'] },
        { operator: 'is greater than', values: [0.001], expectedParams: ['0.001'] },
        { operator: '>', values: [0.001], expectedParams: ['0.001'] },
        { operator: 'is less than', values: [1.5], expectedParams: ['1.5'] },
        { operator: '<', values: [1.5], expectedParams: ['1.5'] },
        { operator: 'is greater than or equal to', values: [100], expectedParams: ['100'] },
        { operator: '>=', values: [100], expectedParams: ['100'] },
        { operator: 'is less than or equal to', values: [100], expectedParams: ['100'] },
        { operator: '<=', values: [100], expectedParams: ['100'] },
        { operator: 'is between', values: [7, 25.5], expectedParams: ['7', '25.5'] },
        { operator: 'is not between', values: [7, 25.5], expectedParams: ['7', '25.5'] },
      ];

      for (const { operator, values, expectedParams } of NUMERIC_CASES) {
        it(`"${operator}" casts placeholders to double precision and binds string params`, () => {
          const params: any[] = [];
          const result = buildValueCondition('fv0', {
            source: 'config', key: 'lr', dataType: 'number', operator, values,
          }, params)!;

          expect(result).not.toBeNull();
          // Every numericValue placeholder must carry the ::double precision cast.
          const placeholders = result.match(/\$\d+/g) ?? [];
          expect(placeholders.length).toBe(expectedParams.length);
          for (const ph of placeholders) {
            expect(result).toContain(`${ph}::double precision`);
          }
          // Params are bound as strings (text wire format), never raw JS numbers.
          expect(params).toEqual(expectedParams);
          for (const p of params) {
            expect(typeof p).toBe('string');
          }
        });
      }

      it('integer- and float-valued filters produce byte-identical SQL text (the caching hazard)', () => {
        // Same operator, one integer value and one float value: the SQL text must
        // match exactly (that identity is what makes the prepared-statement cache
        // reuse one plan across both), which is precisely why the params must be
        // text-cast rather than typed by JS number-ness.
        const p1: any[] = [];
        const intSql = buildValueCondition('fv0', {
          source: 'config', key: 'epochs', dataType: 'number', operator: 'is', values: [100],
        }, p1);
        const p2: any[] = [];
        const floatSql = buildValueCondition('fv0', {
          source: 'config', key: 'lr', dataType: 'number', operator: 'is', values: [0.001],
        }, p2);

        expect(intSql).toBe(floatSql);
        expect(intSql).toContain('::double precision');
        expect(p1).toEqual(['100']);
        expect(p2).toEqual(['0.001']);
      });
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
