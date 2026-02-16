/**
 * Backfill script to fix numericValue for run_field_values rows where
 * textValue is a numeric string but numericValue is null.
 *
 * Config values stored as JSON strings (e.g. "0.001" instead of 0.001)
 * were previously inferred as "text" with numericValue=null, causing them to
 * sort to the bottom (NULLS LAST). This script detects numeric strings and
 * sets numericValue for correct sorting. Excludes leading-zero integers
 * like "007" (IDs) and hex strings like "0x1F".
 *
 * Usage:
 *   DATABASE_URL="..." pnpm exec tsx scripts/backfill-field-values.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;

/** Returns true if the string is a valid numeric value that should have numericValue set.
 * Excludes leading-zero integers like "007" (IDs) and hex "0x1F". */
function isNumericString(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.startsWith("0x") || trimmed.startsWith("0X")) return false;
  if (/^0\d+$/.test(trimmed)) return false;
  const num = Number(trimmed);
  return !isNaN(num) && isFinite(num);
}

async function backfill() {
  let cursor: bigint | undefined;
  let totalProcessed = 0;
  let totalUpdated = 0;

  console.log("Starting backfill of numericValue for numeric string rows...");

  while (true) {
    const rows = await prisma.runFieldValue.findMany({
      select: { id: true, textValue: true },
      where: {
        numericValue: null,
        textValue: { not: null },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (rows.length === 0) break;

    const updates: { id: bigint; numericValue: number }[] = [];
    for (const row of rows) {
      if (row.textValue && isNumericString(row.textValue)) {
        updates.push({ id: row.id, numericValue: Number(row.textValue) });
      }
    }

    if (updates.length > 0) {
      await Promise.all(
        updates.map((u) =>
          prisma.runFieldValue.update({
            where: { id: u.id },
            data: { numericValue: u.numericValue },
          })
        )
      );
      totalUpdated += updates.length;
    }

    totalProcessed += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`Processed ${totalProcessed} rows, updated ${totalUpdated} so far...`);
  }

  console.log(`Done! Processed ${totalProcessed} rows, updated ${totalUpdated} with numericValue.`);
}

backfill()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
