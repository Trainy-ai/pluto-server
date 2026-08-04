/**
 * Unit tests for buildProjectWhere.
 *
 * The projects page pages through results server-side: `projects.list` returns
 * one page of rows and `projects.count` returns the total the pager divides by
 * PAGE_SIZE. Both call this builder, so the risk being tested here is drift —
 * a term that narrows the rows but not the count (or vice versa) produces a
 * pager offering pages that render empty.
 *
 * No database needed: we only assert the shape of the returned `where` object.
 */

import { describe, it, expect } from 'vitest';
import { buildProjectWhere, MAX_PROJECT_SEARCH_LENGTH } from '../lib/project-search';

describe('buildProjectWhere', () => {
  // --- No search term ---

  it('scopes to the organization when no search is given', () => {
    expect(buildProjectWhere({ organizationId: 'org-123' })).toEqual({
      organizationId: 'org-123',
    });
  });

  it('treats an empty string as no filter', () => {
    expect(buildProjectWhere({ organizationId: 'org-123', search: '' })).toEqual({
      organizationId: 'org-123',
    });
  });

  it('treats a whitespace-only search as no filter', () => {
    // Typing then deleting back to spaces should show every project again,
    // not zero results from matching a literal "   ".
    expect(buildProjectWhere({ organizationId: 'org-123', search: '   ' })).toEqual({
      organizationId: 'org-123',
    });
  });

  it('treats undefined the same as absent', () => {
    expect(
      buildProjectWhere({ organizationId: 'org-123', search: undefined })
    ).toEqual({ organizationId: 'org-123' });
  });

  // --- With a search term ---

  it('adds a case-insensitive substring match on name', () => {
    const where = buildProjectWhere({
      organizationId: 'org-123',
      search: 'vision',
    });

    expect(where).toEqual({
      organizationId: 'org-123',
      name: { contains: 'vision', mode: 'insensitive' },
    });
  });

  it('keeps the organization scope alongside the search', () => {
    // A search must never widen the query across organizations.
    const where = buildProjectWhere({
      organizationId: 'org-abc',
      search: 'anything',
    });

    expect(where.organizationId).toBe('org-abc');
  });

  it('trims surrounding whitespace off the term', () => {
    // Pasted names often carry a trailing space; matching on it finds nothing.
    const where = buildProjectWhere({
      organizationId: 'org-123',
      search: '  my-ml-project  ',
    });

    expect(where.name).toEqual({
      contains: 'my-ml-project',
      mode: 'insensitive',
    });
  });

  it('preserves inner whitespace and casing of the term', () => {
    const where = buildProjectWhere({
      organizationId: 'org-123',
      search: 'My Project',
    });

    // Casing is preserved in the term itself — insensitivity comes from `mode`,
    // so the term is passed through verbatim rather than lowercased.
    expect(where.name).toEqual({
      contains: 'My Project',
      mode: 'insensitive',
    });
  });

  it('passes regex/SQL metacharacters through as literal text', () => {
    // Prisma parameterizes `contains`, so these are matched literally rather
    // than interpreted — no injection and no accidental regex behaviour.
    const where = buildProjectWhere({
      organizationId: 'org-123',
      search: "o'brien-(v2).*",
    });

    expect(where.name).toEqual({
      contains: "o'brien-(v2).*",
      mode: 'insensitive',
    });
  });

  // --- Consistency between list and count ---

  it('returns an identical clause for the same inputs', () => {
    // list and count each call this once; identical inputs must yield identical
    // filters or the pager's page count disagrees with the rows shown.
    const params = { organizationId: 'org-123', search: 'train' };

    expect(buildProjectWhere(params)).toEqual(buildProjectWhere(params));
  });

  // --- Limits ---

  it('caps search length at the project name column width', () => {
    // Longer terms can never match a VARCHAR(255) name, so the procedures
    // reject them at the Zod boundary instead of running a doomed query.
    expect(MAX_PROJECT_SEARCH_LENGTH).toBe(255);
  });
});
