import { z } from "zod";

// Column configuration schema (mirrors ColumnConfig from use-column-config.ts)
export const ColumnConfigSchema = z.object({
  id: z.string(),
  source: z.enum(["system", "config", "systemMetadata", "metric"]),
  label: z.string(),
  customLabel: z.string().optional(),
  backgroundColor: z.string().optional(),
  aggregation: z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]).optional(),
  isPinned: z.boolean().optional(),
});

// Base column overrides schema (mirrors BaseColumnOverrides)
export const BaseColumnOverridesSchema = z.object({
  customLabel: z.string().optional(),
  backgroundColor: z.string().optional(),
});

// Filter schema (mirrors RunFilter from lib/run-filters.ts)
// Use z.any() for values to avoid Prisma InputJsonValue incompatibility
export const FilterSchema = z.object({
  id: z.string(),
  field: z.string(),
  source: z.enum(["system", "config", "systemMetadata", "metric"]),
  dataType: z.string(),
  operator: z.string(),
  values: z.array(z.any()),
  aggregation: z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]).optional(),
});

// Sort schema (mirrors @tanstack/react-table ColumnSort)
export const SortSchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

// Complete run table view config
export const RunTableViewConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  columns: z.array(ColumnConfigSchema).default([]),
  baseOverrides: z.record(z.string(), BaseColumnOverridesSchema).default({}),
  filters: z.array(FilterSchema).default([]),
  sorting: z.array(SortSchema).default([]),
  pageSize: z.number().int().positive().optional(),
  // W&B-style grouping: ordered list of encoded group fields, e.g.
  // ["tag-prefix:group", "system:status"]. Empty/missing = no grouping.
  // Lenient on read so v1 rows that stored groupBy as `"group" | null`
  // (a single string or null) load instead of throwing — the v1 sentinel
  // "group" is treated as the new `tag-prefix:group` field; null/missing
  // collapses to []. New writes always go through the array form.
  groupBy: z
    .preprocess((value) => {
      if (value == null) return undefined;
      if (typeof value === "string") {
        return value === "group" ? ["tag-prefix:group"] : [value];
      }
      return value;
    }, z.array(z.string()).optional()),
  // Encoded bucket trails the user has expanded — each entry is a
  // JSON-stringified array of `{field, value}` pairs. Saved views ride
  // the expand state with them; reload-without-view collapses to all.
  // Lenient on read for legacy v1 rows that stored `expanded` as
  // `true | Record<string, boolean>`; we just drop those (collapse all)
  // since the v1 row-id keys don't translate to v2 bucket trails.
  expanded: z
    .preprocess((value) => {
      if (value == null) return undefined;
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        return value;
      }
      // v1 sentinel values (`true` / `Record<string, boolean>`) are not
      // expressible in the v2 form; collapse all rather than throw.
      return undefined;
    }, z.array(z.string()).optional()),
});
export type RunTableViewConfig = z.infer<typeof RunTableViewConfigSchema>;

// Helper to create an empty run table view config
export const createEmptyRunTableViewConfig = (): RunTableViewConfig => ({
  version: 1,
  columns: [],
  baseOverrides: {},
  filters: [],
  sorting: [],
});
