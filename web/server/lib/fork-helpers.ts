/**
 * Shared helpers for fork creation (used by both HTTP API and tRPC).
 */

import type { PrismaClient } from "@prisma/client";
import type { clickhouse } from "./clickhouse";

const MAX_RESOLVE_DEPTH = 10;

/** Minimal fork-related fields needed for lineage resolution */
export interface ForkParent {
  id: bigint;
  config: unknown;
  tags: string[];
  forkedFromRunId: bigint | null;
  forkStep: bigint | null;
}

const FORK_PARENT_SELECT = {
  id: true,
  config: true,
  tags: true,
  forkedFromRunId: true,
  forkStep: true,
} as const;

/**
 * Walk up the lineage chain to find the ancestor that actually "owns" the
 * given forkStep. If forkStep <= parent.forkStep, the parent inherited that
 * step from its own parent, so we keep walking.
 *
 * Returns the resolved parent (may be the same as the input if it owns the step).
 */
export async function resolveForkParent(
  prisma: PrismaClient,
  parent: ForkParent,
  forkStep: number,
  organizationId: string
): Promise<ForkParent> {
  let resolved: ForkParent = parent;
  let depth = 0;

  while (
    resolved.forkStep !== null &&
    forkStep <= Number(resolved.forkStep) &&
    resolved.forkedFromRunId !== null &&
    depth < MAX_RESOLVE_DEPTH
  ) {
    const ancestor = await prisma.runs.findFirst({
      where: {
        id: resolved.forkedFromRunId,
        organizationId,
      },
      select: FORK_PARENT_SELECT,
    });

    if (!ancestor) {
      break;
    }

    resolved = ancestor;
    depth++;
  }

  return resolved;
}

/**
 * Validate that forkStep does not exceed the resolved parent's actual max
 * step in ClickHouse. Returns an error message string if invalid, or null
 * if valid (or if the parent has no metrics).
 */
export async function validateForkStep(
  ch: typeof clickhouse,
  organizationId: string,
  projectName: string,
  resolvedParentId: bigint,
  forkStep: number
): Promise<string | null> {
  const result = await ch.query(
    `SELECT max(step) AS maxStep FROM mlop_metrics
     WHERE tenantId = {tenantId: String}
       AND projectName = {projectName: String}
       AND runId = {runId: UInt64}`,
    {
      tenantId: organizationId,
      projectName,
      runId: Number(resolvedParentId),
    }
  );
  const rows = (await result.json()) as Array<{ maxStep: number }>;
  const maxStep = rows.length > 0 ? rows[0].maxStep : null;

  if (maxStep != null && maxStep > 0 && forkStep > maxStep) {
    return `forkStep (${forkStep}) exceeds the parent run's max step (${maxStep})`;
  }

  return null;
}
