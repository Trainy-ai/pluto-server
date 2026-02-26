import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode } from "../../../../lib/sqid";

/** Default limit for project-wide discovery */
const DEFAULT_LIMIT = 500;
/** Higher limit when scoped to specific runs */
const SCOPED_LIMIT = 10000;

/** Log types that represent "file" data (non-metric, non-text) */
const FILE_LOG_TYPES = ["HISTOGRAM", "IMAGE", "VIDEO", "AUDIO"] as const;

/**
 * Discover distinct file-type log names (HISTOGRAM, IMAGE, VIDEO, AUDIO) in a project.
 * Queries PostgreSQL RunLogs table with optional fuzzy or regex search.
 * Mirrors distinctMetricNamesProcedure but targets RunLogs instead of ClickHouse.
 */
export const distinctFileLogNamesProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().optional(),
      regex: z.string().max(200).optional(),
      runIds: z.array(z.string()).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const project = await ctx.prisma.projects.findFirst({
      where: {
        name: input.projectName,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });

    if (!project) {
      return { files: [] as { logName: string; logType: string }[] };
    }

    const numericRunIds = input.runIds?.map((sqid) => sqidDecode(sqid));
    const hasRunIds = numericRunIds && numericRunIds.length > 0;
    const limit = hasRunIds ? SCOPED_LIMIT : DEFAULT_LIMIT;

    // Build the WHERE conditions
    const conditions: string[] = [
      `r."projectId" = $1`,
      `r."organizationId" = $2`,
      `rl."logType"::text = ANY($3)`,
    ];
    const params: unknown[] = [
      project.id,
      input.organizationId,
      FILE_LOG_TYPES as unknown as string[],
    ];

    let paramIdx = 4;

    // Scope to specific runs if provided
    if (hasRunIds) {
      conditions.push(`rl."runId" = ANY($${paramIdx})`);
      params.push(numericRunIds);
      paramIdx++;
    }

    // Track search param index for ORDER BY similarity reference
    let searchParamIdx: number | null = null;

    // Fuzzy search: similarity() + ILIKE (mirrors searchColumnKeysProcedure)
    if (input.search) {
      searchParamIdx = paramIdx;
      conditions.push(
        `(similarity(rl."logName", $${paramIdx}) > 0.01 OR rl."logName" ILIKE $${paramIdx + 1})`
      );
      params.push(input.search, `%${input.search}%`);
      paramIdx += 2;
    }

    // Regex search: PostgreSQL ~ operator
    if (input.regex) {
      conditions.push(`rl."logName" ~ $${paramIdx}`);
      params.push(input.regex);
      paramIdx++;
    }

    // Add limit as the last parameter
    const limitParamIdx = paramIdx;
    params.push(limit);

    // Use a subquery with DISTINCT ON, then sort the outer query
    // DISTINCT ON requires ORDER BY to start with the DISTINCT ON columns
    const innerOrderBy = input.search && searchParamIdx
      ? `ORDER BY rl."logName", similarity(rl."logName", $${searchParamIdx}) DESC`
      : `ORDER BY rl."logName"`;

    const outerOrderBy = input.search && searchParamIdx
      ? `ORDER BY similarity(sub."logName", $${searchParamIdx}) DESC, sub."logName" ASC`
      : `ORDER BY sub."logName" ASC`;

    const query = `
      SELECT sub."logName", sub."logType"
      FROM (
        SELECT DISTINCT ON (rl."logName") rl."logName", rl."logType"::text as "logType"
        FROM run_logs rl
        INNER JOIN runs r ON rl."runId" = r.id
        WHERE ${conditions.join(" AND ")}
        ${innerOrderBy}
      ) sub
      ${outerOrderBy}
      LIMIT $${limitParamIdx}
    `;

    const rows = await ctx.prisma.$queryRawUnsafe<
      { logName: string; logType: string }[]
    >(query, ...params);

    return { files: rows };
  });
