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
