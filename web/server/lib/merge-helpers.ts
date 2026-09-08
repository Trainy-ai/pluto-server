/**
 * Merge-runs planning: retroactively link a crashed run and its
 * checkpoint-restart(s) into one fork lineage. See
 * docs/superpowers/plans/2026-08-31-run-merge-design.md.
 */

import type { PrismaClient } from "@prisma/client";
import type { clickhouse } from "./clickhouse";

// Mirrors MAX_LINEAGE_DEPTH in trpc/routers/runs/procs/get-lineage.ts —
// merge must not build chains the read path refuses to walk.
const MAX_LINEAGE_DEPTH = 10;

export interface MergeCandidate {
  id: bigint;
  name: string;
  createdAt: Date;
  forkedFromRunId: bigint | null;
}

export interface StepBounds {
  minStep: number;
  maxStep: number;
}

export interface MergeLink {
  childId: bigint;
  parentId: bigint;
  forkStep: number;
}

export interface MergePlan {
  links: MergeLink[];
  alreadyLinked: bigint[];
}

export class MergePlanError extends Error {
  code: "CONFLICT" | "BAD_REQUEST";

  constructor(code: "CONFLICT" | "BAD_REQUEST", message: string) {
    super(message);
    this.code = code;
    this.name = "MergePlanError";
  }
}

/**
 * Compute the child→parent links for merging the given runs into one lineage.
 * Runs are ordered by createdAt (tiebreak: id) and each becomes the
 * continuation of the previous one. forkStep = child's first logged step − 1,
 * clamped to the parent's last logged step, so the stitched view drops the
 * parent's post-checkpoint tail and never exceeds the parent's real data.
 */
export function planMergeChain(
  runs: MergeCandidate[],
  boundsByRunId: Map<bigint, StepBounds>,
  ancestorIdsOf: (runId: bigint) => Set<bigint>,
): MergePlan {
  const ordered = [...runs].sort((a, b) => {
    const dt = a.createdAt.getTime() - b.createdAt.getTime();
    if (dt !== 0) return dt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const links: MergeLink[] = [];
  const alreadyLinked: bigint[] = [];

  for (let i = 1; i < ordered.length; i++) {
    const parent = ordered[i - 1];
    const child = ordered[i];

    if (child.forkedFromRunId !== null) {
      if (child.forkedFromRunId === parent.id) {
        alreadyLinked.push(child.id);
        continue;
      }
      throw new MergePlanError(
        "CONFLICT",
        `"${child.name}" is already linked to another run. Unlink it first, then merge.`,
      );
    }

    const childBounds = boundsByRunId.get(child.id);
    if (!childBounds) {
      throw new MergePlanError(
        "BAD_REQUEST",
        `"${child.name}" hasn't logged any metrics yet. Wait for it to log data, then merge.`,
      );
    }
    const parentBounds = boundsByRunId.get(parent.id);
    if (!parentBounds) {
      throw new MergePlanError(
        "BAD_REQUEST",
        `"${parent.name}" has no logged metrics, so there is nothing to inherit from it.`,
      );
    }
    if (childBounds.minStep === 0) {
      throw new MergePlanError(
        "BAD_REQUEST",
        `"${child.name}" starts at step 0, so it doesn't continue "${parent.name}" — merging would overlap the entire step range.`,
      );
    }
    if (ancestorIdsOf(parent.id).has(child.id)) {
      throw new MergePlanError(
        "BAD_REQUEST",
        `Merging "${child.name}" into "${parent.name}" would create a lineage cycle.`,
      );
    }

    links.push({
      childId: child.id,
      parentId: parent.id,
      forkStep: Math.min(childBounds.minStep - 1, parentBounds.maxStep),
    });
  }

  return { links, alreadyLinked };
}

/**
 * Batch min/max logged step per run from ClickHouse. Runs with no metric rows
 * are absent from the returned map.
 *
 * Excludes logGroup 'sys': the SDK auto-logs system metrics on their own step
 * counter starting near 0, which would drag minStep down and compute a
 * forkStep that truncates the entire parent. Only user-logged metrics define
 * where a restarted run continues from.
 */
export async function getStepBoundsByRunId(
  ch: typeof clickhouse,
  organizationId: string,
  projectName: string,
  runIds: bigint[],
): Promise<Map<bigint, StepBounds>> {
  const result = await ch.query(
    `SELECT runId, min(step) AS minStep, max(step) AS maxStep
     FROM mlop_metrics_v2 FINAL
     WHERE tenantId = {tenantId: String}
       AND projectName = {projectName: String}
       AND runId IN ({runIds: Array(UInt64)})
       AND logGroup != 'sys'
     GROUP BY runId`,
    {
      tenantId: organizationId,
      projectName,
      runIds: runIds.map(Number),
    },
  );
  const rows = (await result.json()) as Array<{
    runId: string | number;
    minStep: string | number;
    maxStep: string | number;
  }>;
  return new Map(
    rows.map((r) => [
      BigInt(r.runId),
      { minStep: Number(r.minStep), maxStep: Number(r.maxStep) },
    ]),
  );
}

/**
 * Walk a run's existing lineage upward (org-scoped, depth-capped) and return
 * the set of ancestor run IDs. Used for cycle detection before linking.
 */
export async function collectAncestorIds(
  prisma: PrismaClient,
  runId: bigint,
  organizationId: string,
): Promise<Set<bigint>> {
  const ancestors = new Set<bigint>();
  let current = runId;

  for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth++) {
    const row = await prisma.runs.findFirst({
      where: { id: current, organizationId },
      select: { forkedFromRunId: true },
    });
    if (!row?.forkedFromRunId) break;
    if (ancestors.has(row.forkedFromRunId)) break; // defensive: pre-existing cycle
    ancestors.add(row.forkedFromRunId);
    current = row.forkedFromRunId;
  }

  return ancestors;
}
