/**
 * SQL builder for the ordered, paginated page of project IDs behind
 * `projects.list`.
 *
 * Why raw SQL rather than Prisma: three of the sortable columns — Last Run At,
 * Last Run and Latest Run Status — aren't stored on `projects` at all. They're
 * read off the project's most recent run, which needs a LATERAL subquery Prisma
 * has no way to express (`orderBy` on a relation only supports `_count`).
 *
 * The query returns IDs only; the caller hydrates the full records through
 * Prisma so the select stays typed. This mirrors how run search works.
 *
 * Injection safety: the sort field is never interpolated from user input. It is
 * looked up in PROJECT_SORT_EXPR and falls back to the default when unknown, so
 * only expressions written here can reach the query. Everything the user
 * supplies — the search term, limit and offset — is a bound parameter.
 */

import { normalizeProjectSearch } from "./project-search";

/**
 * Sortable columns, keyed by the identifier the client sends. These match the
 * projects table's column IDs one-to-one.
 */
export const PROJECT_SORT_FIELDS = [
  "name",
  "tags",
  "createdAt",
  "lastRunAt",
  "lastRunName",
  "lastRunStatus",
] as const;

export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

export type SortDirection = "asc" | "desc";

/** Preserves the ordering the page had before sorting was configurable. */
export const DEFAULT_PROJECT_SORT: ProjectSortField = "createdAt";

/**
 * SQL expression each sortable field orders by.
 *
 * `lr` is the latest-run LATERAL (see buildProjectListQuery); fields reading
 * from it are the ones that require the join.
 */
const PROJECT_SORT_EXPR: Record<ProjectSortField, string> = {
  name: 'p."name"',
  tags: 'p."tags"',
  createdAt: 'p."createdAt"',
  lastRunAt: 'lr."updatedAt"',
  lastRunName: 'lr."name"',
  // RunStatus is an enum; cast to text so ordering is alphabetical rather than
  // by the order the enum members happen to be declared in.
  lastRunStatus: 'lr."status"::text',
};

/** Fields whose value comes from the project's most recent run. */
const LATEST_RUN_FIELDS: ReadonlySet<string> = new Set<ProjectSortField>([
  "lastRunAt",
  "lastRunName",
  "lastRunStatus",
]);

export function isProjectSortField(value: string): value is ProjectSortField {
  return (PROJECT_SORT_FIELDS as readonly string[]).includes(value);
}

/** Whether ordering by `field` requires joining the project's latest run. */
export function needsLatestRunJoin(field: ProjectSortField): boolean {
  return LATEST_RUN_FIELDS.has(field);
}

export interface ProjectListQueryParams {
  organizationId: string;
  search?: string;
  sortBy?: ProjectSortField;
  sortDirection?: SortDirection;
  /** Rows to fetch. Callers ask for one extra to detect a next page. */
  limit: number;
  offset: number;
}

export interface ProjectListQuery {
  query: string;
  params: unknown[];
}

/**
 * Builds the ordered page query.
 *
 * The LATERAL is only joined when the sort actually needs it, so the common
 * name/createdAt sorts don't pay for a per-project run lookup.
 */
export function buildProjectListQuery({
  organizationId,
  search,
  sortBy,
  sortDirection,
  limit,
  offset,
}: ProjectListQueryParams): ProjectListQuery {
  const field: ProjectSortField =
    sortBy && isProjectSortField(sortBy) ? sortBy : DEFAULT_PROJECT_SORT;
  const dir: SortDirection = sortDirection === "desc" ? "desc" : "asc";
  const sqlDir = dir === "desc" ? "DESC" : "ASC";

  const params: unknown[] = [organizationId];
  const conditions = [`p."organizationId" = $1`];

  const term = normalizeProjectSearch(search);
  if (term !== null) {
    params.push(term);
    // Equivalent to Prisma's `contains` + `mode: "insensitive"` used by
    // projects.count — both compile to ILIKE '%term%'.
    conditions.push(`p."name" ILIKE '%' || $${params.length} || '%'`);
  }

  // Matches the `runs` selection the caller hydrates for display: newest by
  // updatedAt. Scoped by organizationId as well as projectId so the lookup can
  // use the (organizationId, projectId, updatedAt DESC) index — the predicate
  // is redundant, since a project's runs always share its org.
  const latestRunJoin = needsLatestRunJoin(field)
    ? `
    LEFT JOIN LATERAL (
      SELECT r."updatedAt", r."name", r."status"
      FROM "runs" r
      WHERE r."projectId" = p.id AND r."organizationId" = p."organizationId"
      ORDER BY r."updatedAt" DESC
      LIMIT 1
    ) lr ON TRUE`
    : "";

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  // NULLS LAST keeps projects with no runs at the bottom whichever way the
  // latest-run columns are sorted, instead of flooding the top on DESC.
  // Tiebreaking on id keeps paging stable when the sort value repeats — without
  // it, two projects sharing a value can swap between pages and one is shown
  // twice while the other never appears.
  const query = `
    SELECT p.id
    FROM "projects" p${latestRunJoin}
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${PROJECT_SORT_EXPR[field]} ${sqlDir} NULLS LAST, p.id ${sqlDir}
    LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int
  `;

  return { query, params };
}
