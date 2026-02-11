import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";

/** Maximum number of keys to return per source */
const INITIAL_LOAD_LIMIT = 100;

/** Maximum number of keys to return from a search */
const SEARCH_RESULT_LIMIT = 100;

/**
 * Get the most recently discovered config and systemMetadata keys
 * for a project. Queries the project_column_keys table (ordered by id DESC)
 * for a fast initial load without fetching full run JSON blobs.
 */
export const distinctColumnKeysProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
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
      return { configKeys: [], systemMetadataKeys: [] };
    }

    const [configRows, sysMetaRows] = await Promise.all([
      ctx.prisma.projectColumnKey.findMany({
        where: {
          projectId: project.id,
          organizationId: input.organizationId,
          source: "config",
        },
        select: { key: true, dataType: true },
        orderBy: { id: "desc" },
        take: INITIAL_LOAD_LIMIT,
      }),
      ctx.prisma.projectColumnKey.findMany({
        where: {
          projectId: project.id,
          organizationId: input.organizationId,
          source: "systemMetadata",
        },
        select: { key: true, dataType: true },
        orderBy: { id: "desc" },
        take: INITIAL_LOAD_LIMIT,
      }),
    ]);

    // Sort alphabetically for display after fetching by recency
    const configKeys = configRows
      .map((r) => ({ key: r.key, type: r.dataType as "text" | "number" | "date" }))
      .sort((a, b) => a.key.localeCompare(b.key));

    const systemMetadataKeys = sysMetaRows
      .map((r) => ({ key: r.key, type: r.dataType as "text" | "number" | "date" }))
      .sort((a, b) => a.key.localeCompare(b.key));

    return { configKeys, systemMetadataKeys };
  });

/**
 * Search for distinct config/systemMetadata keys across ALL runs in a project.
 * Uses the project_column_keys table with an index for fast ILIKE searches.
 *
 * Returns at most SEARCH_RESULT_LIMIT (100) matching keys per source.
 */
export const searchColumnKeysProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().min(1).max(200),
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
      return { configKeys: [], systemMetadataKeys: [] };
    }

    const [configRows, sysMetaRows] = await Promise.all([
      ctx.prisma.projectColumnKey.findMany({
        where: {
          projectId: project.id,
          organizationId: input.organizationId,
          source: "config",
          key: { contains: input.search, mode: "insensitive" },
        },
        select: { key: true, dataType: true },
        orderBy: { key: "asc" },
        take: SEARCH_RESULT_LIMIT,
      }),
      ctx.prisma.projectColumnKey.findMany({
        where: {
          projectId: project.id,
          organizationId: input.organizationId,
          source: "systemMetadata",
          key: { contains: input.search, mode: "insensitive" },
        },
        select: { key: true, dataType: true },
        orderBy: { key: "asc" },
        take: SEARCH_RESULT_LIMIT,
      }),
    ]);

    const configKeys = configRows.map((r) => ({
      key: r.key,
      type: r.dataType as "text" | "number" | "date",
    }));

    const systemMetadataKeys = sysMetaRows.map((r) => ({
      key: r.key,
      type: r.dataType as "text" | "number" | "date",
    }));

    return { configKeys, systemMetadataKeys };
  });
