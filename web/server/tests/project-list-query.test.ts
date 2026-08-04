/**
 * Unit tests for buildProjectListQuery.
 *
 * This SQL is assembled by string concatenation, which is exactly where sort
 * queries go wrong quietly: a dropped tiebreaker duplicates rows across pages,
 * a mis-numbered parameter binds the search term to LIMIT, and a sort field
 * interpolated straight from input is an injection hole. None of those throw —
 * they just return wrong rows.
 *
 * No database needed: we assert on the generated SQL string and params array.
 */

import { describe, it, expect } from 'vitest';
import {
  buildProjectListQuery,
  isProjectSortField,
  needsLatestRunJoin,
  PROJECT_SORT_FIELDS,
  DEFAULT_PROJECT_SORT,
} from '../lib/project-list-query';

const base = { organizationId: 'org-123', limit: 51, offset: 0 };

describe('buildProjectListQuery', () => {
  // --- Scoping ---

  it('always scopes to the organization as the first parameter', () => {
    const { query, params } = buildProjectListQuery(base);

    expect(query).toContain('p."organizationId" = $1');
    expect(params[0]).toBe('org-123');
  });

  it('binds limit and offset as parameters, not interpolated text', () => {
    const { query, params } = buildProjectListQuery({
      ...base,
      limit: 51,
      offset: 100,
    });

    // Cast explicitly: Postgres can otherwise fail to infer a bare parameter's
    // type in LIMIT/OFFSET.
    expect(query).toMatch(/LIMIT \$\d+::int OFFSET \$\d+::int/);
    expect(params).toContain(51);
    expect(params).toContain(100);
  });

  // --- Default ordering ---

  it('defaults to the ordering the page had before sorting existed', () => {
    const { query } = buildProjectListQuery(base);

    expect(DEFAULT_PROJECT_SORT).toBe('createdAt');
    expect(query).toContain('ORDER BY p."createdAt" ASC');
  });

  it('defaults to ascending when no direction is given', () => {
    const { query } = buildProjectListQuery({ ...base, sortBy: 'name' });

    expect(query).toContain('ORDER BY p."name" ASC');
  });

  it('orders descending when asked', () => {
    const { query } = buildProjectListQuery({
      ...base,
      sortBy: 'name',
      sortDirection: 'desc',
    });

    expect(query).toContain('ORDER BY p."name" DESC');
  });

  // --- Sort fields ---

  it('orders by plain project columns without joining runs', () => {
    for (const field of ['name', 'tags', 'createdAt'] as const) {
      const { query } = buildProjectListQuery({ ...base, sortBy: field });

      expect(query).not.toContain('LATERAL');
      expect(query).toContain('ORDER BY p.');
    }
  });

  it('joins the latest run only for run-derived columns', () => {
    for (const field of ['lastRunAt', 'lastRunName', 'lastRunStatus'] as const) {
      const { query } = buildProjectListQuery({ ...base, sortBy: field });

      expect(query).toContain('LEFT JOIN LATERAL');
      expect(query).toContain('ORDER BY r."updatedAt" DESC');
      expect(query).toContain('LIMIT 1');
    }
  });

  it('scopes the latest-run lookup so it can use the covering index', () => {
    // The index is (organizationId, projectId, updatedAt DESC); without the
    // organizationId predicate the planner can't use it.
    const { query } = buildProjectListQuery({ ...base, sortBy: 'lastRunAt' });

    expect(query).toContain('r."projectId" = p.id');
    expect(query).toContain('r."organizationId" = p."organizationId"');
  });

  it('casts the run status enum to text so ordering is alphabetical', () => {
    // Without the cast, Postgres orders by enum declaration order, which is
    // not what a user clicking a column header expects.
    const { query } = buildProjectListQuery({ ...base, sortBy: 'lastRunStatus' });

    expect(query).toContain('lr."status"::text');
  });

  it('produces a working query for every advertised sort field', () => {
    // Guards against a field being added to the enum but not the expression map.
    for (const field of PROJECT_SORT_FIELDS) {
      const { query } = buildProjectListQuery({ ...base, sortBy: field });

      expect(query).toContain('ORDER BY');
      expect(query).not.toContain('undefined');
    }
  });

  // --- Ordering correctness ---

  it('tiebreaks on id so pagination is stable', () => {
    // Projects sharing a sort value (e.g. no runs, so a NULL lastRunAt) would
    // otherwise be free to swap between pages — showing one twice and hiding
    // the other entirely.
    const { query } = buildProjectListQuery({ ...base, sortBy: 'lastRunAt' });

    expect(query).toMatch(/ORDER BY .+, p\.id (ASC|DESC)/);
  });

  it('tiebreaks in the same direction as the sort', () => {
    const asc = buildProjectListQuery({ ...base, sortBy: 'name' });
    const desc = buildProjectListQuery({
      ...base,
      sortBy: 'name',
      sortDirection: 'desc',
    });

    expect(asc.query).toContain('p.id ASC');
    expect(desc.query).toContain('p.id DESC');
  });

  it('sorts projects with no runs to the bottom either way', () => {
    const { query } = buildProjectListQuery({
      ...base,
      sortBy: 'lastRunAt',
      sortDirection: 'desc',
    });

    expect(query).toContain('NULLS LAST');
  });

  // --- Search ---

  it('omits the name filter when there is no search term', () => {
    const { query, params } = buildProjectListQuery(base);

    expect(query).not.toContain('ILIKE');
    expect(params).toHaveLength(3); // org, limit, offset
  });

  it('treats a whitespace-only search as no filter', () => {
    const { query } = buildProjectListQuery({ ...base, search: '   ' });

    expect(query).not.toContain('ILIKE');
  });

  it('adds a case-insensitive substring filter for a search term', () => {
    const { query, params } = buildProjectListQuery({
      ...base,
      search: 'vision',
    });

    expect(query).toContain(`p."name" ILIKE '%' || $2 || '%'`);
    expect(params[1]).toBe('vision');
  });

  it('trims the search term', () => {
    const { params } = buildProjectListQuery({ ...base, search: '  vision  ' });

    expect(params[1]).toBe('vision');
  });

  it('keeps limit and offset parameter indices correct with a search', () => {
    // The search term shifts limit/offset from $2/$3 to $3/$4 — an off-by-one
    // here binds the term to LIMIT and the query fails or truncates.
    const { query, params } = buildProjectListQuery({
      ...base,
      search: 'vision',
      limit: 51,
      offset: 100,
    });

    expect(query).toContain('LIMIT $3::int OFFSET $4::int');
    expect(params).toEqual(['org-123', 'vision', 51, 100]);
  });

  it('combines search and sort in one query', () => {
    const { query } = buildProjectListQuery({
      ...base,
      search: 'vision',
      sortBy: 'lastRunAt',
      sortDirection: 'desc',
    });

    expect(query).toContain('ILIKE');
    expect(query).toContain('LEFT JOIN LATERAL');
    expect(query).toContain('ORDER BY lr."updatedAt" DESC');
  });

  // --- Injection safety ---

  it('never interpolates the sort field from input', () => {
    const { query } = buildProjectListQuery({
      ...base,
      // Only reachable if a caller bypasses the Zod enum, but the builder must
      // not depend on that being the only guard.
      sortBy: 'createdAt"; DROP TABLE projects; --' as never,
    });

    expect(query).not.toContain('DROP TABLE');
    expect(query).toContain('ORDER BY p."createdAt"');
  });

  it('falls back to the default for an unknown sort field', () => {
    const { query } = buildProjectListQuery({
      ...base,
      sortBy: 'nonsense' as never,
    });

    expect(query).toContain('ORDER BY p."createdAt" ASC');
  });

  it('treats an unrecognised direction as ascending', () => {
    const { query } = buildProjectListQuery({
      ...base,
      sortBy: 'name',
      sortDirection: 'sideways' as never,
    });

    expect(query).toContain('ORDER BY p."name" ASC');
  });

  it('passes a search term with SQL metacharacters as a bound parameter', () => {
    const { query, params } = buildProjectListQuery({
      ...base,
      search: "'; DROP TABLE projects; --",
    });

    expect(query).not.toContain('DROP TABLE');
    expect(params[1]).toBe("'; DROP TABLE projects; --");
  });
});

describe('isProjectSortField', () => {
  it('accepts every advertised field', () => {
    for (const field of PROJECT_SORT_FIELDS) {
      expect(isProjectSortField(field)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isProjectSortField('runCount')).toBe(false);
    expect(isProjectSortField('')).toBe(false);
    expect(isProjectSortField('p."name"')).toBe(false);
  });
});

describe('needsLatestRunJoin', () => {
  it('is true only for run-derived columns', () => {
    expect(needsLatestRunJoin('lastRunAt')).toBe(true);
    expect(needsLatestRunJoin('lastRunName')).toBe(true);
    expect(needsLatestRunJoin('lastRunStatus')).toBe(true);

    expect(needsLatestRunJoin('name')).toBe(false);
    expect(needsLatestRunJoin('tags')).toBe(false);
    expect(needsLatestRunJoin('createdAt')).toBe(false);
  });
});
