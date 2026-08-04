import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";
import { MAX_PROJECT_SEARCH_LENGTH } from "../../../../lib/project-search";
import {
  buildProjectListQuery,
  PROJECT_SORT_FIELDS,
} from "../../../../lib/project-list-query";

export const listProjectsProcedure = protectedOrgProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(10),
      includeNRuns: z.number().default(0),
      cursor: z.number().default(0),
      direction: z.enum(["forward", "backward"]).default("forward"),
      /** Case-insensitive substring filter on project name. */
      search: z.string().max(MAX_PROJECT_SEARCH_LENGTH).optional(),
      /** Column to order by. Defaults to createdAt, the page's original order. */
      sortBy: z.enum(PROJECT_SORT_FIELDS).optional(),
      /** Falls back to `direction` so existing callers keep their ordering. */
      sortDirection: z.enum(["asc", "desc"]).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const {
      organizationId,
      limit,
      cursor,
      direction,
      includeNRuns,
      search,
      sortBy,
      sortDirection,
    } = input;

    // Get one extra item to determine if there's a next page
    const take = limit + 1;

    // Ordering happens in SQL because three sortable columns live on the
    // project's latest run rather than on `projects` itself.
    const { query, params } = buildProjectListQuery({
      organizationId,
      search,
      sortBy,
      sortDirection: sortDirection ?? (direction === "forward" ? "asc" : "desc"),
      limit: take,
      offset: cursor,
    });

    const rows = await ctx.prisma.$queryRawUnsafe<{ id: bigint }[]>(
      query,
      ...params
    );

    const hasNextPage = rows.length === take;
    const pageIds = (hasNextPage ? rows.slice(0, -1) : rows).map((row) => row.id);

    if (pageIds.length === 0) {
      return { projects: [], nextCursor: null };
    }

    const projects = await ctx.prisma.projects.findMany({
      where: {
        organizationId,
        id: { in: pageIds },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        tags: true,
        _count: {
          select: {
            runs: true,
          },
        },
        ...(includeNRuns > 0 && {
          runs: {
            select: {
              id: true,
              createdAt: true,
              name: true,
              status: true,
              updatedAt: true,
              statusUpdated: true,
            },
            orderBy: {
              updatedAt: "desc",
            },
            take: includeNRuns,
          },
        }),
      },
    });

    // findMany ignores the ordering the SQL query established, so restore it
    // from pageIds — otherwise the chosen sort is silently discarded.
    const byId = new Map(projects.map((project) => [project.id, project]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((project): project is (typeof projects)[number] => Boolean(project));

    // for all the runs, encode the id and return the project with the encoded runs
    const encodedProjects = items.map((project) => ({
      ...project,
      runCount: project._count.runs,
      runs:
        project.runs?.map((run) => ({
          ...run,
          id: sqidEncode(run.id),
        })) ?? [],
    }));

    return {
      projects: encodedProjects,
      nextCursor: hasNextPage ? cursor + limit : null,
    };
  });
