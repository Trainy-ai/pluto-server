import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode, sqidEncode } from "../../../../lib/sqid";

export const getFieldValuesProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()), // SQID-encoded run IDs
      projectName: z.string(),
      keys: z
        .array(z.object({ source: z.enum(["config", "systemMetadata"]), key: z.string() }))
        .optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (input.runIds.length === 0) {
      return {};
    }

    const decodedIds = input.runIds.map(sqidDecode);

    const where: Prisma.RunFieldValueWhereInput = {
      runId: { in: decodedIds },
      run: {
        organizationId: input.organizationId,
        project: { name: input.projectName },
      },
    };

    // Optionally filter by specific keys
    if (input.keys?.length) {
      where.OR = input.keys.map((k) => ({
        source: k.source,
        key: k.key,
      }));
    }

    const rows = await ctx.prisma.runFieldValue.findMany({
      where,
      select: {
        runId: true,
        source: true,
        key: true,
        textValue: true,
        numericValue: true,
      },
    });

    // Group by encoded runId → { "source::key": value }
    const result: Record<string, Record<string, string | number | null>> = {};

    for (const row of rows) {
      const encodedId = sqidEncode(row.runId);
      if (!result[encodedId]) {
        result[encodedId] = {};
      }
      const compositeKey = `${row.source}::${row.key}`;
      result[encodedId][compositeKey] = row.numericValue ?? row.textValue ?? null;
    }

    return result;
  });
