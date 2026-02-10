import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";
import { searchRunIds } from "../../../../lib/run-search";

export const latestRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string().optional(),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      limit: z.number().min(1).max(200).default(10),
    })
  )
  .query(async ({ ctx, input }) => {
    const { projectName, search, tags, status, organizationId, limit } = input;

    // If search is provided, get matching run IDs first via search
    let searchMatchIds: bigint[] | null = null;

    if (search && search.trim()) {
      searchMatchIds = await searchRunIds(ctx.prisma, {
        organizationId,
        projectName,
        search: search.trim(),
        tags,
        status,
        limit,
      });

      // If no matches found, return empty
      if (searchMatchIds.length === 0) {
        return [];
      }
    }

    const runs = await ctx.prisma.runs.findMany({
      select: {
        project: {
          select: {
            name: true,
          },
        },
        id: true,
        createdAt: true,
        name: true,
        status: true,
        updatedAt: true,
        statusUpdated: true,
        tags: true,
      },
      where: {
        project: {
          name: projectName,
          organizationId: organizationId,
        },
        // If search was provided, filter to only matching IDs
        ...(searchMatchIds ? { id: { in: searchMatchIds } } : {}),
        // Only apply tag/status filters if no search (search already includes them)
        ...(!searchMatchIds && tags && tags.length > 0 ? { tags: { hasSome: tags } } : {}),
        ...(!searchMatchIds && status && status.length > 0 ? { status: { in: status } } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    });

    // for all the runs, encode the id and return the runs with the encoded id
    const encodedRuns = runs.map((run) => ({
      ...run,
      id: sqidEncode(run.id),
    }));

    return encodedRuns;
  });
