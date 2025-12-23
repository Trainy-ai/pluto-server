import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";

export const listProjectsProcedure = protectedOrgProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(10),
      includeNRuns: z.number().default(0),
      cursor: z.number().default(0),
      direction: z.enum(["forward", "backward"]).default("forward"),
    })
  )
  .query(async ({ ctx, input }) => {
    const { organizationId, limit, cursor, direction, includeNRuns } = input;

    // Get one extra item to determine if there's a next page
    const take = limit + 1;

    const projects = await ctx.prisma.projects.findMany({
      where: {
        organizationId,
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
      orderBy: {
        createdAt: direction === "forward" ? "asc" : "desc",
      },
      take,
      skip: cursor,
    });

    const hasNextPage = projects.length === take;
    const items = hasNextPage ? projects.slice(0, -1) : projects;

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
