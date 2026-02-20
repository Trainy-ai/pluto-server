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
      "fileTree",
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
