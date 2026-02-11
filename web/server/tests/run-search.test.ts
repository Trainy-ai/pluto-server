/**
 * Unit tests for buildRunSearchQuery and buildRunCountQuery.
 *
 * When a user searches or filters runs in the table (by status, tags, date,
 * etc.), the backend needs to build a SQL query with the right WHERE clauses.
 * These two functions handle that: they take filter params as input and return
 * a raw SQL string + a params array, which Prisma then executes via
 * $queryRawUnsafe.
 *
 * Why test these? Because the SQL is built by string concatenation — if a
 * filter accidentally drops an AND, uses the wrong parameter index ($3 instead
 * of $4), or forgets to add a JOIN, the query silently returns wrong results.
 * These tests catch that by checking the SQL string contains the expected
 * clauses and the params array has values in the right positions.
 *
 * We don't need a database here — we're just checking that the SQL string
 * and params array are assembled correctly.
 */

import { describe, it, expect } from 'vitest';
import { buildRunSearchQuery, buildRunCountQuery } from '../lib/run-search';

describe('buildRunSearchQuery', () => {
  // --- Basic query structure ---

  it('builds a basic query with org ID and search term', () => {
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: 'train',
    });

    // Should always filter by organization
    expect(query).toContain('"organizationId" = $1');
    expect(params[0]).toBe('org-123');

    // Should add ILIKE search on name
    expect(query).toContain("ILIKE '%' || $2 || '%'");
    expect(params[1]).toBe('train');

    // Should order by createdAt descending (newest first)
    expect(query).toContain('ORDER BY r."createdAt" DESC');

    // Should NOT include a JOIN when no project filter is used
    expect(query).not.toContain('JOIN');
  });

  // --- Project filtering ---

  it('filters by project ID without requiring a JOIN', () => {
    // When we have the project ID, we can filter directly on the runs table
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      projectId: BigInt(42),
    });

    expect(query).toContain('"projectId" = $2');
    expect(params[1]).toBe(BigInt(42));
    // No JOIN needed when filtering by ID
    expect(query).not.toContain('JOIN');
  });

  it('filters by project name with a JOIN to the projects table', () => {
    // When filtering by name, we need to JOIN projects to match on p.name
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      projectName: 'my-project',
    });

    expect(query).toContain('JOIN "projects" p ON r."projectId" = p.id');
    expect(query).toContain('p.name = $2');
    expect(params[1]).toBe('my-project');
  });

  it('prefers project ID over project name when both are provided', () => {
    // projectId is more efficient (no JOIN), so it takes priority
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      projectId: BigInt(42),
      projectName: 'my-project',
    });

    expect(query).toContain('"projectId" = $2');
    expect(query).not.toContain('JOIN');
  });

  // --- Tags filtering ---

  it('adds tags overlap filter using && operator', () => {
    // PostgreSQL array overlap operator: runs.tags && ARRAY['v1','v2']
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      tags: ['v1', 'production'],
    });

    expect(query).toContain('r.tags && $');
    expect(query).toContain('::text[]');
    // Tags should be in the params
    expect(params).toContainEqual(['v1', 'production']);
  });

  it('skips tags filter when tags array is empty', () => {
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      tags: [],
    });

    // Empty tags array should not add any tag filter condition
    expect(query).not.toContain('r.tags');
  });

  // --- Status filtering ---

  it('adds status filter using ANY() for multiple statuses', () => {
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      status: ['RUNNING', 'FAILED'],
    });

    expect(query).toContain('r.status = ANY($');
    expect(query).toContain('"RunStatus"[]');
    expect(params).toContainEqual(['RUNNING', 'FAILED']);
  });

  it('skips status filter when status array is empty', () => {
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      status: [],
    });

    expect(query).not.toContain('r.status');
  });

  // --- Date filtering ---

  it('adds "before" date filter with < operator', () => {
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      dateFilters: [
        { field: 'createdAt', operator: 'before', value: '2024-06-01T00:00:00Z' },
      ],
    });

    // Should produce: r."createdAt" < $N::timestamptz
    expect(query).toContain('"createdAt" <');
    expect(query).toContain('::timestamptz');
    expect(params).toContain('2024-06-01T00:00:00Z');
  });

  it('adds "after" date filter with > operator', () => {
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      dateFilters: [
        { field: 'updatedAt', operator: 'after', value: '2024-01-01T00:00:00Z' },
      ],
    });

    expect(query).toContain('"updatedAt" >');
    expect(params).toContain('2024-01-01T00:00:00Z');
  });

  it('adds "between" date filter with >= and <= operators', () => {
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      dateFilters: [
        {
          field: 'createdAt',
          operator: 'between',
          value: '2024-01-01T00:00:00Z',
          value2: '2024-06-01T00:00:00Z',
        },
      ],
    });

    // "between" should produce two conditions: >= start AND <= end
    expect(query).toContain('"createdAt" >=');
    expect(query).toContain('"createdAt" <=');
    expect(params).toContain('2024-01-01T00:00:00Z');
    expect(params).toContain('2024-06-01T00:00:00Z');
  });

  it('supports statusUpdated as a date filter field', () => {
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      dateFilters: [
        { field: 'statusUpdated', operator: 'after', value: '2024-01-01T00:00:00Z' },
      ],
    });

    expect(query).toContain('"statusUpdated" >');
  });

  it('ignores date filters with unrecognized field names', () => {
    // Only createdAt, updatedAt, statusUpdated are valid date filter fields
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      dateFilters: [
        { field: 'deletedAt' as any, operator: 'after', value: '2024-01-01T00:00:00Z' },
      ],
    });

    // Should not add any date condition for unknown fields
    expect(query).not.toContain('deletedAt');
  });

  // --- Combined filters ---

  it('combines all filter types into a single AND query', () => {
    const { query, params } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: 'experiment',
      projectName: 'ml-project',
      tags: ['v1'],
      status: ['RUNNING'],
      dateFilters: [
        { field: 'createdAt', operator: 'after', value: '2024-01-01T00:00:00Z' },
      ],
    });

    // All conditions should be AND-ed together
    expect(query).toContain('"organizationId" = $1');
    expect(query).toContain('p.name =');
    expect(query).toContain("ILIKE");
    expect(query).toContain('r.tags &&');
    expect(query).toContain('r.status = ANY');
    expect(query).toContain('"createdAt" >');
    expect(query).toContain('AND');

    // Should use project JOIN since we're filtering by name
    expect(query).toContain('JOIN "projects" p');

    // Verify params are in the right order
    expect(params[0]).toBe('org-123');
  });

  // --- LIMIT ---

  it('adds LIMIT when specified', () => {
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
      limit: 50,
    });

    expect(query).toContain('LIMIT 50');
  });

  it('omits LIMIT when not specified', () => {
    const { query } = buildRunSearchQuery({
      organizationId: 'org-123',
      search: '',
    });

    expect(query).not.toContain('LIMIT');
  });
});

describe('buildRunCountQuery', () => {
  // buildRunCountQuery produces a similar query but returns COUNT(*) instead
  // of row IDs, and never has a LIMIT clause.

  it('uses COUNT(*) instead of SELECT r.id', () => {
    const { query } = buildRunCountQuery({
      organizationId: 'org-123',
      search: '',
    });

    expect(query).toContain('COUNT(*)');
    expect(query).not.toContain('SELECT r.id');
  });

  it('never includes LIMIT', () => {
    // buildRunCountQuery doesn't accept a limit param — it always counts all
    const { query } = buildRunCountQuery({
      organizationId: 'org-123',
      search: '',
    });

    expect(query).not.toContain('LIMIT');
  });

  it('applies the same filters as the search query', () => {
    // Count query should filter identically to search query
    const { query, params } = buildRunCountQuery({
      organizationId: 'org-123',
      search: 'test',
      tags: ['v1'],
      status: ['RUNNING'],
      dateFilters: [
        { field: 'createdAt', operator: 'before', value: '2024-12-01T00:00:00Z' },
      ],
    });

    expect(query).toContain('"organizationId" = $1');
    expect(query).toContain("ILIKE");
    expect(query).toContain('r.tags &&');
    expect(query).toContain('r.status = ANY');
    expect(query).toContain('"createdAt" <');
    expect(params[0]).toBe('org-123');
  });

  it('includes project JOIN when filtering by project name', () => {
    const { query } = buildRunCountQuery({
      organizationId: 'org-123',
      search: '',
      projectName: 'my-project',
    });

    expect(query).toContain('JOIN "projects" p');
  });

  it('casts result as integer', () => {
    // The COUNT result is cast to int for consistent typing
    const { query } = buildRunCountQuery({
      organizationId: 'org-123',
      search: '',
    });

    expect(query).toContain('COUNT(*)::int');
  });
});
