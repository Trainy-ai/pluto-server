/**
 * Shared utilities for run search queries using ILIKE substring matching.
 * Consolidates search logic used across list-runs, latest-runs, runs-count, and runs-openapi.
 */

export interface RunSearchParams {
  organizationId: string;
  search: string;
  projectId?: bigint;
  projectName?: string;
  tags?: string[];
  status?: string[];
  limit?: number;
}

interface QueryResult {
  query: string;
  params: (string | bigint | string[] | number)[];
}

/**
 * Builds a search query for run IDs using ILIKE substring matching.
 * Supports filtering by project (via ID or name), tags, and status.
 */
export function buildRunSearchQuery(params: RunSearchParams): QueryResult {
  const { organizationId, search, projectId, projectName, tags, status, limit } = params;

  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [organizationId];

  // Add project filter - either by ID (more efficient) or by name (requires JOIN)
  const needsProjectJoin = !projectId && projectName;
  if (projectId) {
    queryParams.push(projectId);
    conditions.push(`r."projectId" = $${queryParams.length}`);
  } else if (projectName) {
    queryParams.push(projectName);
    conditions.push(`p.name = $${queryParams.length}`);
  }

  // Add search condition using ILIKE for substring matching
  queryParams.push(search);
  conditions.push(`r.name ILIKE '%' || $${queryParams.length} || '%'`);

  // Add tags filter if provided
  if (tags && tags.length > 0) {
    queryParams.push(tags);
    conditions.push(`r.tags && $${queryParams.length}::text[]`);
  }

  // Add status filter if provided
  if (status && status.length > 0) {
    queryParams.push(status);
    conditions.push(`r.status = ANY($${queryParams.length}::text[])`);
  }

  const fromClause = needsProjectJoin
    ? `FROM "runs" r JOIN "projects" p ON r."projectId" = p.id`
    : `FROM "runs" r`;

  const query = `
    SELECT r.id
    ${fromClause}
    WHERE ${conditions.join(" AND ")}
    ORDER BY r."createdAt" DESC
    ${limit ? `LIMIT ${limit}` : ""}
  `;

  return { query, params: queryParams };
}

/**
 * Builds a count query for runs using ILIKE substring matching.
 */
export function buildRunCountQuery(params: Omit<RunSearchParams, "limit">): QueryResult {
  const { organizationId, search, projectId, projectName, tags, status } = params;

  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[])[] = [organizationId];

  // Add project filter
  const needsProjectJoin = !projectId && projectName;
  if (projectId) {
    queryParams.push(projectId);
    conditions.push(`r."projectId" = $${queryParams.length}`);
  } else if (projectName) {
    queryParams.push(projectName);
    conditions.push(`p.name = $${queryParams.length}`);
  }

  // Add search condition using ILIKE for substring matching
  queryParams.push(search);
  conditions.push(`r.name ILIKE '%' || $${queryParams.length} || '%'`);

  // Add tags filter if provided
  if (tags && tags.length > 0) {
    queryParams.push(tags);
    conditions.push(`r.tags && $${queryParams.length}::text[]`);
  }

  // Add status filter if provided
  if (status && status.length > 0) {
    queryParams.push(status);
    conditions.push(`r.status = ANY($${queryParams.length}::text[])`);
  }

  const fromClause = needsProjectJoin
    ? `FROM "runs" r JOIN "projects" p ON r."projectId" = p.id`
    : `FROM "runs" r`;

  const query = `
    SELECT COUNT(*)::int as count
    ${fromClause}
    WHERE ${conditions.join(" AND ")}
  `;

  return { query, params: queryParams };
}

/**
 * Executes a run search query and returns matching run IDs.
 */
export async function searchRunIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  params: RunSearchParams,
): Promise<bigint[]> {
  const { query, params: queryParams } = buildRunSearchQuery(params);
  const results: { id: bigint }[] = await prisma.$queryRawUnsafe(query, ...queryParams);
  return results.map((r) => r.id);
}

/**
 * Executes a run count query and returns the count.
 */
export async function countRunsWithSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  params: Omit<RunSearchParams, "limit">,
): Promise<number> {
  const { query, params: queryParams } = buildRunCountQuery(params);
  const results: { count: number }[] = await prisma.$queryRawUnsafe(query, ...queryParams);
  return results[0]?.count ?? 0;
}
