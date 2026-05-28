import { Prisma } from "@prisma/client";
import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { getCached, setCached, buildBatchCacheKey } from "../../../../lib/cache";

/** 30s TTL — tags change when users add/remove tags from runs */
const TAGS_CACHE_TTL = 30 * 1000;

/** Hard ceiling on rows returned, mirrors the frontend render cap. */
const MAX_LIMIT = 500;

/**
 * Search distinct tags across all runs in a project.
 *
 * This is a *search* endpoint, not a bulk dump: the web app derives its
 * default tag list from the runs already loaded in the table, and only
 * calls this when the user types a query. Results are always bounded by
 * `limit` so a project with tens of thousands of tags can't blow up the
 * response or the dropdown DOM.
 */
export const distinctTagsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      /** Case-insensitive substring to match against tag names. */
      search: z.string().optional(),
      /** Max tags to return (clamped to MAX_LIMIT). */
      limit: z.number().int().positive().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const limit = Math.min(input.limit ?? MAX_LIMIT, MAX_LIMIT);
    const search = input.search?.trim() ?? "";

    const cacheKey = buildBatchCacheKey("distinctTags", {
      orgId: input.organizationId,
      projectName: input.projectName,
      search,
      limit,
    });

    const cached = await getCached<{ tags: string[] }>(cacheKey);
    if (cached) return cached;

    const project = await ctx.prisma.projects.findFirst({
      where: {
        name: input.projectName,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });

    if (!project) {
      return { tags: [] };
    }

    // PostgreSQL UNNEST expands the tags[] column into rows; GROUP BY
    // collapses duplicates and lets us order by usage frequency so the
    // tags users actually apply bubble to the top of the dropdown. Ties
    // break on the most recently created run carrying the tag, so freshly
    // added tags surface ahead of dormant ones with the same count. When
    // searching, LIKE metacharacters in the user input are escaped so a
    // literal "%" stays literal, then the unnested set is filtered before
    // grouping. Tag-ascending is the final stable tiebreaker.
    const searchClause = search
      ? Prisma.sql`WHERE tag ILIKE ${`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`
      : Prisma.empty;
    const results = await ctx.prisma.$queryRaw<{ tag: string }[]>`
      SELECT tag FROM (
        SELECT UNNEST(tags) AS tag, "createdAt"
        FROM "runs"
        WHERE "organizationId" = ${input.organizationId}
          AND "projectId" = ${project.id}
          AND tags IS NOT NULL
          AND array_length(tags, 1) > 0
      ) t
      ${searchClause}
      GROUP BY tag
      ORDER BY COUNT(*) DESC, MAX("createdAt") DESC, tag ASC
      LIMIT ${limit}
    `;

    const result = { tags: results.map((r) => r.tag) };
    await setCached(cacheKey, result, TAGS_CACHE_TTL);
    return result;
  });
