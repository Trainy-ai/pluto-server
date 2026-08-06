import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import {
  queryRunFileLogTypes,
  type RunFileLogType,
} from "../../../../../../lib/queries";

/**
 * The distinct `(logName, fileType)` pairs a run logged.
 *
 * The metrics views need exactly this and nothing else: `RunLogs` records a
 * log's TYPE (FILE / TEXT / ARTIFACT) but not its files' EXTENSIONS, and only
 * the extension says whether a widget can draw the thing. They used to ask
 * `fileTree` for it, which returns a row per FILE (up to 10,000) carrying
 * `caption` and per-image `annotations` — a multi-MB answer to a question with
 * a handful of distinct pairs in it, paid on every All Metrics visit by any run
 * with a lot of annotated images.
 *
 * Distinct-ing in ClickHouse rather than in the client is the whole point: the
 * rows never leave the database.
 */
export const fileLogTypesProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    return withCache<RunFileLogType[]>(
      ctx,
      "fileLogTypes:v1",
      { runId, organizationId, projectName },
      async () => {
        return queryRunFileLogTypes(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
        });
      },
    );
  });
