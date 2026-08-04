/**
 * Shared search normalization for the projects table.
 *
 * `projects.list` and `projects.count` must filter identically: the list drives
 * the rows on screen and the count drives the pager's page count. If only one of
 * them applied the search term the UI would offer pages that render empty.
 *
 * The two take different routes to the same predicate — count uses Prisma's
 * `contains` + `mode: "insensitive"`, list builds raw SQL with `ILIKE` (it needs
 * a LATERAL join Prisma can't express) — so they share the term normalization
 * here rather than each trimming on their own.
 */

import type { Prisma } from "@prisma/client";

/** Matches the `name VARCHAR(255)` column on `projects`. */
export const MAX_PROJECT_SEARCH_LENGTH = 255;

export interface ProjectSearchParams {
  organizationId: string;
  /** Free-text project name filter. Blank/whitespace-only means "no filter". */
  search?: string;
}

/**
 * The effective search term, or null when there is nothing to filter by.
 *
 * Whitespace is trimmed: pasted project names often carry a trailing space, and
 * matching on it would find nothing. A term that is only whitespace widens the
 * query back to the whole organization rather than matching a literal "   ".
 */
export function normalizeProjectSearch(search?: string): string | null {
  const term = search?.trim() ?? "";
  return term.length === 0 ? null : term;
}

/**
 * Builds the Prisma `where` clause for counting an organization's projects,
 * optionally narrowed to a case-insensitive substring of the name.
 *
 * The organization scope is always applied — a blank search widens the result
 * set back to the whole org, never across orgs.
 */
export function buildProjectWhere({
  organizationId,
  search,
}: ProjectSearchParams): Prisma.ProjectsWhereInput {
  const term = normalizeProjectSearch(search);

  if (term === null) {
    return { organizationId };
  }

  return {
    organizationId,
    name: {
      contains: term,
      mode: "insensitive",
    },
  };
}
