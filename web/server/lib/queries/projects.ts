/**
 * Shared query function for fetching projects from PostgreSQL.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { PrismaClient } from "@prisma/client";

export interface QueryProjectsParams {
  organizationId: string;
  limit?: number;
  cursor?: number;
  direction?: "forward" | "backward";
  includeNRuns?: number;
}

export interface ProjectSummary {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  runCount: number;
}

export interface ProjectWithRuns extends ProjectSummary {
  runs: {
    id: bigint;
    name: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    statusUpdated: Date | null;
  }[];
}

export interface QueryProjectsResult {
  projects: ProjectSummary[] | ProjectWithRuns[];
  nextCursor: number | null;
}

/**
 * List projects for an organization with optional pagination.
 */
export async function queryProjects(
  prisma: PrismaClient,
  params: QueryProjectsParams
): Promise<QueryProjectsResult> {
  const {
    organizationId,
    limit = 50,
    cursor = 0,
    direction = "backward",
    includeNRuns = 0,
  } = params;

  // Get one extra item to determine if there's a next page
  const take = limit + 1;

  const projects = await prisma.projects.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      tags: true,
      _count: {
        select: { runs: true },
      },
      ...(includeNRuns > 0 && {
        runs: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            statusUpdated: true,
          },
          orderBy: { updatedAt: "desc" as const },
          take: includeNRuns,
        },
      }),
    },
    orderBy: { createdAt: direction === "forward" ? "asc" : "desc" },
    take,
    skip: cursor,
  });

  const hasNextPage = projects.length === take;
  const items = hasNextPage ? projects.slice(0, -1) : projects;

  const result = items.map((project) => ({
    id: Number(project.id),
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tags: project.tags,
    runCount: project._count.runs,
    ...("runs" in project && {
      runs: project.runs,
    }),
  }));

  return {
    projects: result,
    nextCursor: hasNextPage ? cursor + limit : null,
  };
}

/**
 * Simple project list without pagination (for MCP/API use).
 * Note: Limited to 1000 projects to prevent excessive memory usage.
 */
export async function queryAllProjects(
  prisma: PrismaClient,
  organizationId: string
): Promise<ProjectSummary[]> {
  // Safety limit - while orgs typically have few projects, this prevents edge cases
  const MAX_PROJECTS = 1000;

  const projects = await prisma.projects.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: MAX_PROJECTS,
    include: {
      _count: {
        select: { runs: true },
      },
    },
  });

  return projects.map((p) => ({
    id: Number(p.id),
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    tags: p.tags,
    runCount: p._count.runs,
  }));
}
