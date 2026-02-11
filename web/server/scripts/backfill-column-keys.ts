/**
 * Backfill script to populate project_column_keys AND run_field_values
 * from existing runs' config and systemMetadata.
 *
 * Uses the shared extractAndUpsertColumnKeys() which handles both tables.
 * Safe to re-run — uses skipDuplicates and delete-then-insert for field values.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-column-keys.ts
 */

import { PrismaClient } from "@prisma/client";
import { extractAndUpsertColumnKeys } from "../lib/extract-column-keys";

const prisma = new PrismaClient();

const BATCH_SIZE = 500;

async function backfill() {
  let cursor: bigint | undefined;
  let totalProcessed = 0;

  console.log("Starting backfill of project_column_keys + run_field_values...");

  while (true) {
    const runs = await prisma.runs.findMany({
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        config: true,
        systemMetadata: true,
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (runs.length === 0) break;

    for (const run of runs) {
      await extractAndUpsertColumnKeys(
        prisma,
        run.organizationId,
        run.projectId,
        run.config,
        run.systemMetadata,
        run.id,
      );
    }

    totalProcessed += runs.length;
    cursor = runs[runs.length - 1].id;
    console.log(`Processed ${totalProcessed} runs...`);
  }

  console.log(
    `Done! Processed ${totalProcessed} runs (column keys + field values).`,
  );
}

backfill()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
