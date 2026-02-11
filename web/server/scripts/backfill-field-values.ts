/**
 * Backfill script to populate run_field_values table from existing runs.
 * Processes runs in batches and uses createMany with skipDuplicates.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-field-values.ts
 */

import { PrismaClient } from "@prisma/client";
import { flattenObject } from "../lib/flatten-object";

const prisma = new PrismaClient();

const BATCH_SIZE = 500;
const IMPORTED_KEY_PREFIXES = ["sys/", "source_code/"];
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function inferType(value: unknown): "text" | "number" | "date" {
  if (typeof value === "number") return "number";
  if (typeof value === "string" && ISO_DATE_REGEX.test(value)) return "date";
  return "text";
}

async function backfill() {
  let cursor: bigint | undefined;
  let totalProcessed = 0;
  let totalValuesInserted = 0;

  console.log("Starting backfill of run_field_values...");

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

    const records: {
      runId: bigint;
      organizationId: string;
      projectId: bigint;
      source: string;
      key: string;
      textValue: string | null;
      numericValue: number | null;
    }[] = [];

    for (const run of runs) {
      const flatConfig = flattenObject(run.config);
      for (const [key, value] of Object.entries(flatConfig)) {
        if (IMPORTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          continue;
        }
        const dataType = inferType(value);
        records.push({
          runId: run.id,
          organizationId: run.organizationId,
          projectId: run.projectId,
          source: "config",
          key,
          textValue: value != null ? String(value) : null,
          numericValue: dataType === "number" ? Number(value) : null,
        });
      }

      const flatSysMeta = flattenObject(run.systemMetadata);
      for (const [key, value] of Object.entries(flatSysMeta)) {
        const dataType = inferType(value);
        records.push({
          runId: run.id,
          organizationId: run.organizationId,
          projectId: run.projectId,
          source: "systemMetadata",
          key,
          textValue: value != null ? String(value) : null,
          numericValue: dataType === "number" ? Number(value) : null,
        });
      }
    }

    if (records.length > 0) {
      const result = await prisma.runFieldValue.createMany({
        data: records,
        skipDuplicates: true,
      });
      totalValuesInserted += result.count;
    }

    totalProcessed += runs.length;
    cursor = runs[runs.length - 1].id;
    console.log(`Processed ${totalProcessed} runs, ${totalValuesInserted} values inserted so far...`);
  }

  console.log(`Done! Processed ${totalProcessed} runs, inserted ${totalValuesInserted} values.`);
}

backfill()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
