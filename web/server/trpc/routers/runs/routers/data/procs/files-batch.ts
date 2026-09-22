import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunIdsResilient } from "../../../../../../lib/resolve-run-id";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";
import { queryRunFilesByLogName } from "../../../../../../lib/queries";
import { MAX_RUNS_PER_BATCH } from "./histogram.schema";
import type { FileData } from "./files";
import type { clickhouse } from "../../../../../../lib/clickhouse";
import { resolveLineageChain, type LineageSegment } from "./lineage-helpers";

// S3 presigned URLs expire in ~15-60 min; cap cache TTL so cached URLs stay valid.
const S3_URL_MAX_TTL_MS = 15 * 60 * 1000;

// Batched file metadata (image/video/audio) for many runs in ONE request,
// keyed by encoded runId. Replaces the per-run runs.data.files fan-out in the
// media widgets (one query per run) that bloated batched GET URLs into 414s.
//
// Reuses the single-run per-run withCache (namespace "files:v2" + same key), so
// entries are shared with runs.data.files. NOTE: callers must NOT accumulate
// this client-side — presigned URLs expire (~15min), so the media widgets keep
// a normal staleTime and refetch on selection change to refresh URLs (unlike
// the histogram/bars accumulators, whose values don't expire). Additive: the
// single-run `files` proc is unchanged.
//
// `includeLineage` (the Experiments view) stitches each run's fork lineage the
// same way the line charts do: every ancestor contributes files up to the step
// its child forked at, all returned under the requested run's id. Each segment
// is cached on its own under the same "files:v2" key a plain request uses (a
// root segment has no bounds, so its key is identical), and the chain is
// resolved per request, so a merge/unmerge takes effect immediately.
export const filesBatchProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(MAX_RUNS_PER_BATCH),
      projectName: z.string(),
      logName: z.string(),
      includeLineage: z.boolean().optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { runIds: encodedRunIds, projectName, organizationId, logName, includeLineage } =
      input;

    // Resolve resiliently: a deleted/unauthorized run is skipped, not fatal
    // to the whole batch — one bad id must not 500 the media widget for every
    // other run.
    const resolved = await resolveRunIdsResilient(
      ctx.prisma,
      encodedRunIds,
      organizationId,
      projectName,
    );

    const entries = await Promise.all(
      resolved.map(async ({ enc, num: runId }) => {
        const data = await queryRunFilesWithLineage(ctx, {
          organizationId,
          projectName,
          runId,
          logName,
          includeLineage,
        });
        return [enc, data] as const;
      }),
    );

    const result: Record<string, FileData> = {};
    for (const [enc, data] of entries) {
      if (data && data.length > 0) result[enc] = data;
    }
    return result;
  });

/**
 * One run's files for `logName`, stitched across its fork lineage when
 * `includeLineage` is set. Each segment is read from the run that logged it
 * (so its presigned URLs point at that run's S3 prefix), bounded to the steps
 * it owns, and cached on its own. Exported for unit tests.
 */
export async function queryRunFilesWithLineage(
  ctx: Parameters<typeof withCache>[0] & { clickhouse: typeof clickhouse },
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    includeLineage?: boolean;
  },
): Promise<FileData> {
  const { organizationId, projectName, runId, logName, includeLineage } = params;
  const logGroup = getLogGroupName(logName);
  const segments: LineageSegment[] = includeLineage
    ? await resolveLineageChain(ctx.prisma, runId, organizationId)
    : [{ runId, minStep: 0, maxStep: null }];

  // Segments are ordered root → requested run with disjoint step ranges, so
  // concatenating keeps the step-ascending order.
  const parts = await Promise.all(
    segments.map((seg) => {
      const stepMin = seg.minStep > 0 ? seg.minStep : undefined;
      const stepMax = seg.maxStep ?? undefined;
      return withCache<FileData>(
        ctx,
        // Must stay in step with files.ts — the shared namespace is what
        // lets the batch and single-run paths hit each other's entries. A
        // segment with no bounds has exactly the single-run key.
        "files:v2",
        { runId: seg.runId, organizationId, projectName, logName, logGroup, stepMin, stepMax },
        () =>
          queryRunFilesByLogName(ctx.clickhouse, {
            organizationId,
            projectName,
            runId: seg.runId,
            logName,
            stepMin,
            stepMax,
          }),
        { maxTtlMs: S3_URL_MAX_TTL_MS },
      );
    }),
  );
  return parts.flat();
}
