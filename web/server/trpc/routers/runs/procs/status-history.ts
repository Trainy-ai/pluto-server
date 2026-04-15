import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";

/**
 * Return the run's full status transition timeline, oldest first.
 *
 * The shape is kept simple: a flat array of events. The UI is responsible
 * for any grouping/visualisation. Cascading deletes on `Runs` guarantee
 * that a stale runId returns an empty array rather than events for an
 * unrelated run.
 */
export const statusHistoryProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = await resolveRunId(
      ctx.prisma,
      encodedRunId,
      organizationId,
      projectName
    );

    // Verify the run belongs to the caller's org before returning events.
    const run = await ctx.prisma.runs.findFirst({
      where: {
        id: BigInt(runId),
        organizationId,
        project: { name: projectName },
      },
      select: { id: true },
    });
    if (!run) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    }

    const events = await ctx.prisma.runStatusEvent.findMany({
      where: { runId: BigInt(runId) },
      orderBy: { createdAt: "asc" },
      include: {
        actor: { select: { id: true, name: true, email: true, image: true } },
        apiKey: { select: { id: true, name: true } },
      },
    });

    return events.map((e) => ({
      id: e.id.toString(),
      runId: e.runId.toString(),
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      source: e.source,
      metadata: e.metadata,
      createdAt: e.createdAt.toISOString(),
      actor: e.actor
        ? {
            id: e.actor.id,
            name: e.actor.name,
            email: e.actor.email,
            image: e.actor.image,
          }
        : null,
      apiKey: e.apiKey ? { id: e.apiKey.id, name: e.apiKey.name } : null,
    }));
  });
