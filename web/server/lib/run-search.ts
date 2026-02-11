/**
 * Shared utilities for run search queries using ILIKE substring matching.
 * Consolidates search logic used across list-runs, latest-runs, runs-count, and runs-openapi.
 */

export interface DateFilter {
  field: "createdAt" | "updatedAt" | "statusUpdated";
  operator: "before" | "after" | "between";
  value: string;
  value2?: string;
}

export interface SystemFilterSpec {
  field: "name" | "status" | "tags" | "creator.name" | "notes";
  operator: string;
  values: unknown[];
}

export interface RunSearchParams {
  organizationId: string;
  search: string;
  projectId?: bigint;
  projectName?: string;
  tags?: string[];
  status?: string[];
  dateFilters?: DateFilter[];
  systemFilters?: SystemFilterSpec[];
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
/** Column name mapping for date filter fields */
const DATE_FIELD_COLUMNS: Record<string, string> = {
  createdAt: '"createdAt"',
  updatedAt: '"updatedAt"',
  statusUpdated: '"statusUpdated"',
};

function appendDateFilters(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  dateFilters?: DateFilter[],
) {
  if (!dateFilters || dateFilters.length === 0) return;
  for (const df of dateFilters) {
    const col = DATE_FIELD_COLUMNS[df.field];
    if (!col) continue;
    if (df.operator === "before") {
      queryParams.push(df.value);
      conditions.push(`r.${col} < $${queryParams.length}::timestamptz`);
    } else if (df.operator === "after") {
      queryParams.push(df.value);
      conditions.push(`r.${col} > $${queryParams.length}::timestamptz`);
    } else if (df.operator === "between" && df.value2) {
      queryParams.push(df.value);
      conditions.push(`r.${col} >= $${queryParams.length}::timestamptz`);
      queryParams.push(df.value2);
      conditions.push(`r.${col} <= $${queryParams.length}::timestamptz`);
    }
  }
}

export function buildRunSearchQuery(params: RunSearchParams): QueryResult {
  const { organizationId, search, projectId, projectName, tags, status, dateFilters, systemFilters, limit } = params;

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
    conditions.push(`r.status = ANY($${queryParams.length}::"RunStatus"[])`);
  }

  // Add date filters if provided
  appendDateFilters(conditions, queryParams, dateFilters);

  // Add system filters if provided
  const { needsCreatorJoin } = buildSearchSystemFilterConditions(conditions, queryParams, systemFilters);

  const joins: string[] = [];
  if (needsProjectJoin) {
    joins.push(`JOIN "projects" p ON r."projectId" = p.id`);
  }
  if (needsCreatorJoin) {
    joins.push(`LEFT JOIN "user" u ON r."createdById" = u.id`);
  }

  const fromClause = `FROM "runs" r ${joins.join(" ")}`;

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
  const { organizationId, search, projectId, projectName, tags, status, dateFilters, systemFilters } = params;

  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [organizationId];

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
    conditions.push(`r.status = ANY($${queryParams.length}::"RunStatus"[])`);
  }

  // Add date filters if provided
  appendDateFilters(conditions, queryParams, dateFilters);

  // Add system filters if provided
  const { needsCreatorJoin } = buildSearchSystemFilterConditions(conditions, queryParams, systemFilters);

  const joins: string[] = [];
  if (needsProjectJoin) {
    joins.push(`JOIN "projects" p ON r."projectId" = p.id`);
  }
  if (needsCreatorJoin) {
    joins.push(`LEFT JOIN "user" u ON r."createdById" = u.id`);
  }

  const fromClause = `FROM "runs" r ${joins.join(" ")}`;

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

  prisma: any,
  params: Omit<RunSearchParams, "limit">,
): Promise<number> {
  const { query, params: queryParams } = buildRunCountQuery(params);
  const results: { count: number }[] = await prisma.$queryRawUnsafe(query, ...queryParams);
  return results[0]?.count ?? 0;
}

/**
 * Build SQL conditions for system field filters used in search queries.
 * Returns whether a LEFT JOIN to "users" is needed for creator.name filters.
 */
function buildSearchSystemFilterConditions(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  systemFilters?: SystemFilterSpec[],
): { needsCreatorJoin: boolean } {
  let needsCreatorJoin = false;
  if (!systemFilters?.length) return { needsCreatorJoin };

  for (const sf of systemFilters) {
    const { field, operator, values } = sf;

    if (field === "name") {
      const v = values[0] != null ? String(values[0]) : "";
      if (operator === "contains") {
        queryParams.push(v);
        conditions.push(`r."name" ILIKE '%' || $${queryParams.length} || '%'`);
      } else if (operator === "does not contain") {
        queryParams.push(v);
        conditions.push(`(r."name" IS NULL OR r."name" NOT ILIKE '%' || $${queryParams.length} || '%')`);
      }
    } else if (field === "status") {
      if (operator === "is") {
        queryParams.push(String(values[0]));
        conditions.push(`r."status" = $${queryParams.length}::"RunStatus"`);
      } else if (operator === "is not") {
        queryParams.push(String(values[0]));
        conditions.push(`r."status" != $${queryParams.length}::"RunStatus"`);
      } else if (operator === "is any of") {
        const arr = (Array.isArray(values[0]) ? values[0] : values).map(String);
        queryParams.push(arr as any);
        conditions.push(`r."status" = ANY($${queryParams.length}::"RunStatus"[])`);
      } else if (operator === "is none of") {
        const arr = (Array.isArray(values[0]) ? values[0] : values).map(String);
        queryParams.push(arr as any);
        conditions.push(`r."status" != ALL($${queryParams.length}::"RunStatus"[])`);
      }
    } else if (field === "tags") {
      const tagValues = (Array.isArray(values[0]) ? values[0] : values).map(String);
      if (operator === "include") {
        queryParams.push(tagValues[0]);
        conditions.push(`$${queryParams.length} = ANY(r.tags)`);
      } else if (operator === "exclude") {
        queryParams.push(tagValues[0]);
        conditions.push(`NOT ($${queryParams.length} = ANY(r.tags))`);
      } else if (operator === "include any of") {
        queryParams.push(tagValues as any);
        conditions.push(`r.tags && $${queryParams.length}::text[]`);
      } else if (operator === "exclude if all") {
        // Exclude runs where ALL given tags are present
        queryParams.push(tagValues as any);
        conditions.push(`NOT (r.tags @> $${queryParams.length}::text[])`);
      } else if (operator === "include all of") {
        queryParams.push(tagValues as any);
        conditions.push(`r.tags @> $${queryParams.length}::text[]`);
      } else if (operator === "exclude if any of") {
        // Exclude runs where ANY of the given tags overlap
        queryParams.push(tagValues as any);
        conditions.push(`NOT (r.tags && $${queryParams.length}::text[])`);
      }
    } else if (field === "creator.name") {
      needsCreatorJoin = true;
      const v = values[0] != null ? String(values[0]) : "";
      if (operator === "contains") {
        queryParams.push(v);
        conditions.push(`u."name" ILIKE '%' || $${queryParams.length} || '%'`);
      } else if (operator === "does not contain") {
        queryParams.push(v);
        conditions.push(`(u."name" IS NULL OR u."name" NOT ILIKE '%' || $${queryParams.length} || '%')`);
      }
    } else if (field === "notes") {
      const v = values[0] != null ? String(values[0]) : "";
      if (operator === "contains") {
        queryParams.push(v);
        conditions.push(`r."notes" ILIKE '%' || $${queryParams.length} || '%'`);
      } else if (operator === "does not contain") {
        queryParams.push(v);
        conditions.push(`(r."notes" IS NULL OR r."notes" NOT ILIKE '%' || $${queryParams.length} || '%')`);
      } else if (operator === "exists") {
        conditions.push(`r."notes" IS NOT NULL AND r."notes" != ''`);
      } else if (operator === "not exists") {
        conditions.push(`(r."notes" IS NULL OR r."notes" = '')`);
      }
    }
  }

  return { needsCreatorJoin };
}
