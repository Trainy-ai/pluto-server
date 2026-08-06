import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import { queryRunFileTree } from "../../../../../../lib/queries";
import type { RunFileMetadata } from "../../../../../../lib/queries/run-files";

export const fileTreeProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    return withCache<RunFileMetadata[]>(
      ctx,
      // v2: the row shape gained `caption` and `annotations`. The namespace is
      // part of the cache key, so bumping it retires entries written by the
      // previous shape — without it, L2 (Redis) survives the deploy and serves
      // annotation-less rows, and every annotated image renders bare until the
      // TTL expires.
      "fileTree:v2",
      { runId, organizationId, projectName },
      async () => {
        return queryRunFileTree(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
        });
      },
    );
  });
