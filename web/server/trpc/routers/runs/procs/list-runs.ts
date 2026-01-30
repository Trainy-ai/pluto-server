import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";
import { searchRunIds } from "../../../../lib/run-search";

export const listRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      limit: z.number().min(1).max(200).default(10),
      cursor: z.number().optional(),
      direction: z.enum(["forward", "backward"]).default("forward"),
    })
  )
  .query(async ({ ctx, input }) => {
    // If search is provided, get matching run IDs first via search
    let searchMatchIds: bigint[] | undefined;

    if (input.search && input.search.trim()) {
      // Get the project ID first
      const project = await ctx.prisma.projects.findFirst({
        where: {
          name: input.projectName,
          organizationId: input.organizationId,
        },
        select: { id: true },
      });

      if (!project) {
        return { runs: [], nextCursor: null };
      }

      const matchIds = await searchRunIds(ctx.prisma, {
        organizationId: input.organizationId,
        projectId: project.id,
        search: input.search.trim(),
        tags: input.tags,
        status: input.status,
      });

      // If no matches found, return empty
      if (matchIds.length === 0) {
        return { runs: [], nextCursor: null };
      }

      searchMatchIds = matchIds;
    }

    const runs = await ctx.prisma.runs.findMany({
      where: {
        project: {
          name: input.projectName,
        },
        organizationId: input.organizationId,
        // If search was provided, filter to only matching IDs
        ...(searchMatchIds ? { id: { in: searchMatchIds } } : {}),
        // Only apply tag/status filters if no search (search already includes them)
        ...(!searchMatchIds && input.tags && input.tags.length > 0
          ? { tags: { hasSome: input.tags } }
          : {}),
        ...(!searchMatchIds && input.status && input.status.length > 0
          ? { status: { in: input.status } }
          : {}),
      },
      orderBy: {
        createdAt: input.direction === "forward" ? "desc" : "asc",
      },
      include: {
        creator: {
          select: { name: true, email: true },
        },
      },
      take: input.limit,
      // skip: 1 when cursor is provided to avoid returning the cursor record itself
      // (Prisma cursor pagination includes the cursor record by default)
      skip: input.cursor ? 1 : 0,
      cursor: input.cursor ? { id: input.cursor } : undefined,
    });

    const nextCursor =
      runs.length === input.limit ? runs[runs.length - 1].id : null;

    const encodedRuns = runs.map((run) => ({
      ...run,
      id: sqidEncode(run.id),
    }));

    return {
      runs: encodedRuns,
      nextCursor,
    };
  });
