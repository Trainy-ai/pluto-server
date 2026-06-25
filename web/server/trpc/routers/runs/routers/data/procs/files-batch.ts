import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";
import { queryRunFilesByLogName } from "../../../../../../lib/queries";
import { MAX_RUNS_PER_BATCH } from "./histogram.schema";
import type { FileData } from "./files";

// S3 presigned URLs expire in ~15-60 min; cap cache TTL so cached URLs stay valid.
const S3_URL_MAX_TTL_MS = 15 * 60 * 1000;

// Batched file metadata (image/video/audio) for many runs in ONE request,
// keyed by encoded runId. Replaces the per-run runs.data.files fan-out in the
// media widgets (one query per run) that bloated batched GET URLs into 414s.
//
// Reuses the single-run per-run withCache (namespace "files" + same key), so
// entries are shared with runs.data.files. NOTE: callers must NOT accumulate
// this client-side — presigned URLs expire (~15min), so the media widgets keep
// a normal staleTime and refetch on selection change to refresh URLs (unlike
// the histogram/bars accumulators, whose values don't expire). Additive: the
// single-run `files` proc is unchanged.
export const filesBatchProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(MAX_RUNS_PER_BATCH),
      projectName: z.string(),
      logName: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { runIds: encodedRunIds, projectName, organizationId, logName } = input;
    const logGroup = getLogGroupName(logName);

    const entries = await Promise.all(
      encodedRunIds.map(async (enc) => {
        // Resolve resiliently: a deleted/unauthorized run is skipped (returns
        // null here, filtered out below), not fatal to the whole batch — one
        // bad id must not 500 the media widget for every other run.
        let runId: number;
        try {
          runId = await resolveRunId(
            ctx.prisma,
            enc,
            organizationId,
            projectName,
          );
        } catch {
          return [enc, null] as const;
        }
        const data = await withCache<FileData>(
          ctx,
          "files",
          { runId, organizationId, projectName, logName, logGroup },
          () =>
            queryRunFilesByLogName(ctx.clickhouse, {
              organizationId,
              projectName,
              runId,
              logName,
            }),
          { maxTtlMs: S3_URL_MAX_TTL_MS },
        );
        return [enc, data] as const;
      }),
    );

    const result: Record<string, FileData> = {};
    for (const [enc, data] of entries) {
      if (data && data.length > 0) result[enc] = data;
    }
    return result;
  });
