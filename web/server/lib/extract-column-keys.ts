import type { PrismaClient } from "@prisma/client";
import { flattenObject } from "./flatten-object";

/** Prefixes that identify imported (e.g. Neptune) metadata keys */
const IMPORTED_KEY_PREFIXES = ["sys/", "source_code/"];

/** ISO 8601 date string pattern */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Infer the data type from a sample value */
function inferType(value: unknown): "text" | "number" | "date" {
  if (typeof value === "number") return "number";
  if (typeof value === "string" && ISO_DATE_REGEX.test(value)) return "date";
  return "text";
}

interface ColumnKeyRecord {
  organizationId: string;
  projectId: bigint;
  source: string;
  key: string;
  dataType: string;
}

interface FieldValueRecord {
  runId: bigint;
  organizationId: string;
  projectId: bigint;
  source: string;
  key: string;
  textValue: string | null;
  numericValue: number | null;
}

/**
 * Extract flattened keys from config and systemMetadata,
 * then upsert them into the project_column_keys table.
 * Also writes per-run flattened values into run_field_values
 * for fast server-side sorting and filtering.
 *
 * Uses createMany with skipDuplicates for efficient bulk insert.
 * Should be called fire-and-forget so it doesn't block run creation.
 */
export async function extractAndUpsertColumnKeys(
  prisma: PrismaClient,
  organizationId: string,
  projectId: bigint,
  config: unknown,
  systemMetadata: unknown,
  runId?: bigint,
): Promise<void> {
  const keyRecords: ColumnKeyRecord[] = [];
  const valueRecords: FieldValueRecord[] = [];

  // Extract config keys
  const flatConfig = flattenObject(config);
  for (const [key, value] of Object.entries(flatConfig)) {
    if (IMPORTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    const dataType = inferType(value);
    keyRecords.push({
      organizationId,
      projectId,
      source: "config",
      key,
      dataType,
    });
    if (runId != null) {
      valueRecords.push({
        runId,
        organizationId,
        projectId,
        source: "config",
        key,
        textValue: value != null ? String(value) : null,
        numericValue: dataType === "number" ? Number(value) : null,
      });
    }
  }

  // Extract systemMetadata keys
  const flatSysMeta = flattenObject(systemMetadata);
  for (const [key, value] of Object.entries(flatSysMeta)) {
    const dataType = inferType(value);
    keyRecords.push({
      organizationId,
      projectId,
      source: "systemMetadata",
      key,
      dataType,
    });
    if (runId != null) {
      valueRecords.push({
        runId,
        organizationId,
        projectId,
        source: "systemMetadata",
        key,
        textValue: value != null ? String(value) : null,
        numericValue: dataType === "number" ? Number(value) : null,
      });
    }
  }

  if (keyRecords.length === 0 && valueRecords.length === 0) return;

  // Upsert keys (existing behavior)
  if (keyRecords.length > 0) {
    await prisma.projectColumnKey.createMany({
      data: keyRecords,
      skipDuplicates: true,
    });
  }

  // Upsert values: delete existing for this run, then insert fresh (atomic)
  if (runId != null && valueRecords.length > 0) {
    await prisma.$transaction([
      prisma.runFieldValue.deleteMany({ where: { runId } }),
      prisma.runFieldValue.createMany({
        data: valueRecords,
        skipDuplicates: true,
      }),
    ]);
  }
}
