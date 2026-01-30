/**
 * Shared query function for fetching run details from PostgreSQL.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { PrismaClient } from "@prisma/client";

export interface QueryRunDetailsParams {
  organizationId: string;
  runId: number;
  projectName?: string;
}

export interface RunDetails {
  id: number;
  name: string;
  status: string;
  tags: string[];
  config: unknown;
  systemMetadata: unknown;
  loggerSettings: unknown;
  statusMetadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  statusUpdated: Date | null;
  projectName: string;
  externalId: string | null;
  logNames: {
    logName: string;
    logType: string;
    logGroup: string | null;
  }[];
}

/**
 * Get full run details including metadata and available log names.
 */
export async function queryRunDetails(
  prisma: PrismaClient,
  params: QueryRunDetailsParams
): Promise<RunDetails | null> {
  const { organizationId, runId, projectName } = params;

  const whereClause: {
    id: bigint;
    organizationId: string;
    project?: { name: string };
  } = {
    id: BigInt(runId),
    organizationId,
  };

  if (projectName) {
    whereClause.project = { name: projectName };
  }

  const run = await prisma.runs.findFirst({
    where: whereClause,
    include: {
      project: { select: { name: true } },
      logs: {
        select: { logName: true, logType: true, logGroup: true },
        // Limit to 1000 unique log names - sufficient for all practical use cases.
        // Runs rarely have more than 100 unique log names; 1000 provides headroom.
        take: 1000,
      },
    },
  });

  if (!run) {
    return null;
  }

  return {
    id: Number(run.id),
    name: run.name,
    status: run.status,
    tags: run.tags,
    config: run.config,
    systemMetadata: run.systemMetadata,
    loggerSettings: run.loggerSettings,
    statusMetadata: run.statusMetadata,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    statusUpdated: run.statusUpdated,
    projectName: run.project.name,
    externalId: run.externalId,
    logNames: run.logs.map((log) => ({
      logName: log.logName,
      logType: log.logType,
      logGroup: log.logGroup,
    })),
  };
}
