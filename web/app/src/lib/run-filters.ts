/**
 * Core types, constants, and logic for the unified run filter system.
 */
import {
  type ColumnDataType,
  textFilterDetails,
  numberFilterDetails,
  dateFilterDetails,
  optionFilterDetails,
  multiOptionFilterDetails,
} from "./filters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterCondition {
  operator: string;
  values: unknown[];
}

export type MetricAggregation = "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";

export interface RunFilter {
  id: string;
  field: string;
  source: "system" | "config" | "systemMetadata" | "metric";
  dataType: ColumnDataType;
  operator: string;
  values: unknown[];
  /** Additional AND conditions on the same field */
  conditions?: FilterCondition[];
  /** Metric aggregation — required when source === "metric" */
  aggregation?: MetricAggregation;
}

export interface FilterableField {
  id: string;
  source: "system" | "config" | "systemMetadata" | "metric";
  label: string;
  dataType: ColumnDataType;
  options?: { label: string; value: string }[];
  aggregation?: MetricAggregation;
}

export interface DateFilterParam {
  field: "createdAt" | "updatedAt" | "statusUpdated";
  operator: "before" | "after" | "between";
  value: string;
  value2?: string;
}

export interface FieldFilterParam {
  source: "config" | "systemMetadata";
  key: string;
  dataType: "text" | "number" | "date" | "option";
  operator: string;
  values: unknown[];
}

export interface MetricFilterParam {
  logName: string;
  aggregation: MetricAggregation;
  operator: string;
  values: unknown[];
}

export interface SystemFilterParam {
  field: "name" | "status" | "tags" | "creator.name" | "notes";
  operator: string;
  values: unknown[];
}

export interface SortParam {
  field: string;
  source: "system" | "config" | "systemMetadata" | "metric";
  direction: "asc" | "desc";
  aggregation?: MetricAggregation;
}

export interface ServerFilters {
  status?: string[];
  tags?: string[];
  dateFilters?: DateFilterParam[];
  fieldFilters?: FieldFilterParam[];
  metricFilters?: MetricFilterParam[];
  systemFilters?: SystemFilterParam[];
}

// ---------------------------------------------------------------------------
// System fields
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { label: "Running", value: "RUNNING" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Failed", value: "FAILED" },
  { label: "Terminated", value: "TERMINATED" },
  { label: "Cancelled", value: "CANCELLED" },
];

export const SYSTEM_FILTERABLE_FIELDS: FilterableField[] = [
  { id: "name", source: "system", label: "Name", dataType: "text" },
  { id: "createdAt", source: "system", label: "Created", dataType: "date" },
  { id: "updatedAt", source: "system", label: "Updated", dataType: "date" },
  { id: "statusUpdated", source: "system", label: "Status Changed", dataType: "date" },
  { id: "creator.name", source: "system", label: "Owner", dataType: "text" },
  { id: "status", source: "system", label: "Status", dataType: "option", options: STATUS_OPTIONS },
  { id: "tags", source: "system", label: "Tags", dataType: "multiOption" },
  { id: "notes", source: "system", label: "Notes", dataType: "text" },
];

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

const FILTER_DETAILS_MAP: Record<ColumnDataType, Record<string, { label: string }>> = {
  text: textFilterDetails,
  number: numberFilterDetails,
  date: dateFilterDetails,
  option: optionFilterDetails,
  multiOption: multiOptionFilterDetails,
};

export function getOperatorsForType(dataType: ColumnDataType): { value: string; label: string }[] {
  const details = FILTER_DETAILS_MAP[dataType];
  if (!details) return [];
  return Object.entries(details).map(([value, d]) => ({ value, label: d.label }));
}

export function getDefaultOperator(dataType: ColumnDataType): string {
  switch (dataType) {
    case "text":
      return "contains";
    case "number":
      return "is";
    case "date":
      return "is after";
    case "option":
      return "is any of";
    case "multiOption":
      return "include any of";
    default:
      return "contains";
  }
}

// ---------------------------------------------------------------------------
// Server filter extraction
// ---------------------------------------------------------------------------

const DATE_FIELDS = new Set(["createdAt", "updatedAt", "statusUpdated"]);

/** Label lookup for system fields only — config/metric fields fall through to raw field name */
const FIELD_LABEL_MAP = new Map<string, string>(
  SYSTEM_FILTERABLE_FIELDS.map((f) => [`${f.source}:${f.id}`, f.label])
);

/** Map frontend date operators to backend operators */
function mapDateOperator(op: string): "before" | "after" | "between" | null {
  switch (op) {
    case "is before":
    case "is on or before":
      return "before";
    case "is after":
    case "is on or after":
      return "after";
    case "is between":
      return "between";
    default:
      return null;
  }
}

export function extractServerFilters(filters: RunFilter[]): ServerFilters {
  const result: ServerFilters = {};

  // Status filters — extract positive operators as flat array for backward compat
  // (used by run-search.ts for pre-filtering when search is active).
  // Full operator semantics are handled via systemFilters below.
  const POSITIVE_STATUS_OPS = new Set(["is", "is any of"]);
  const statuses = filters
    .filter((f) => f.field === "status" && f.source === "system" && POSITIVE_STATUS_OPS.has(f.operator))
    .flatMap((f) => (Array.isArray(f.values[0]) ? f.values[0] : f.values))
    .filter((v): v is string => typeof v === "string");
  if (statuses.length > 0) {
    result.status = [...new Set(statuses)];
  }

  // Tags filters — extract positive operators as flat array for backward compat
  // (used by run-search.ts for pre-filtering when search is active).
  // Full operator semantics are handled via systemFilters below.
  const POSITIVE_TAG_OPS = new Set(["include", "include any of", "include all of"]);
  const tags = filters
    .filter((f) => f.field === "tags" && f.source === "system" && POSITIVE_TAG_OPS.has(f.operator))
    .flatMap((f) => (Array.isArray(f.values[0]) ? f.values[0] : f.values))
    .filter((v): v is string => typeof v === "string");
  if (tags.length > 0) {
    result.tags = tags;
  }

  // Date filters
  const dateFilters = filters.filter(
    (f) => DATE_FIELDS.has(f.field) && f.source === "system"
  );
  if (dateFilters.length > 0) {
    const mapped: DateFilterParam[] = [];
    for (const df of dateFilters) {
      const op = mapDateOperator(df.operator);
      if (!op) continue;
      const val = df.values[0];
      if (!val) continue;
      const entry: DateFilterParam = {
        field: df.field as DateFilterParam["field"],
        operator: op,
        value: val instanceof Date ? val.toISOString() : String(val),
      };
      if (op === "between" && df.values[1]) {
        const v2 = df.values[1];
        entry.value2 = v2 instanceof Date ? v2.toISOString() : String(v2);
      }
      mapped.push(entry);
    }
    if (mapped.length > 0) {
      result.dateFilters = mapped;
    }
  }

  // Field filters (config / systemMetadata) — extracted for the backend's fieldFilters param
  const fieldFilters = extractFieldFilters(filters);
  if (fieldFilters.length > 0) {
    result.fieldFilters = fieldFilters;
  }

  // Metric filters — extracted for the backend's metricFilters param
  const metricFilters = extractMetricFilters(filters);
  if (metricFilters.length > 0) {
    result.metricFilters = metricFilters;
  }

  // System filters — extract ALL system filters with full operator semantics
  // (name, status, tags, creator.name — each chip becomes a separate SystemFilterParam)
  const systemFilterParams: SystemFilterParam[] = [];
  for (const f of filters) {
    if (f.source !== "system") continue;
    if (DATE_FIELDS.has(f.field)) continue; // handled by dateFilters
    // Primary condition
    systemFilterParams.push({
      field: f.field as SystemFilterParam["field"],
      operator: f.operator,
      values: f.values,
    });
    // Compound AND conditions
    if (f.conditions) {
      for (const c of f.conditions) {
        systemFilterParams.push({
          field: f.field as SystemFilterParam["field"],
          operator: c.operator,
          values: c.values,
        });
      }
    }
  }
  if (systemFilterParams.length > 0) {
    result.systemFilters = systemFilterParams;
  }

  return result;
}

/**
 * Convert RunFilter[] entries for config/systemMetadata sources into
 * the backend's FieldFilterParam format.
 * Compound conditions are flattened — each condition becomes a separate
 * FieldFilterParam, and they're AND'd via separate EXISTS subqueries.
 */
function extractFieldFilters(filters: RunFilter[]): FieldFilterParam[] {
  const result: FieldFilterParam[] = [];
  for (const f of filters) {
    if (f.source !== "config" && f.source !== "systemMetadata") continue;
    const dt = f.dataType === "multiOption" ? "option" as const : f.dataType as "text" | "number" | "date" | "option";
    // Primary condition
    result.push({
      source: f.source as "config" | "systemMetadata",
      key: f.field,
      dataType: dt,
      operator: f.operator,
      values: f.values,
    });
    // Additional compound conditions
    if (f.conditions) {
      for (const c of f.conditions) {
        result.push({
          source: f.source as "config" | "systemMetadata",
          key: f.field,
          dataType: dt,
          operator: c.operator,
          values: c.values,
        });
      }
    }
  }
  return result;
}

/**
 * Convert RunFilter[] entries for metric sources into
 * the backend's MetricFilterParam format.
 * Compound conditions are flattened — each condition becomes a separate
 * MetricFilterParam, and they're AND'd via INTERSECT in ClickHouse.
 */
function extractMetricFilters(filters: RunFilter[]): MetricFilterParam[] {
  const result: MetricFilterParam[] = [];
  for (const f of filters) {
    if (f.source !== "metric" || !f.aggregation) continue;
    // Primary condition
    result.push({
      logName: f.field,
      aggregation: f.aggregation,
      operator: f.operator,
      values: f.values,
    });
    // Additional compound conditions
    if (f.conditions) {
      for (const c of f.conditions) {
        result.push({
          logName: f.field,
          aggregation: f.aggregation,
          operator: c.operator,
          values: c.values,
        });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function storageKey(orgSlug: string, projectName: string): string {
  return `mlop:filters:v1:${orgSlug}:${projectName}`;
}

export function serializeFilters(orgSlug: string, projectName: string, filters: RunFilter[]): void {
  try {
    localStorage.setItem(storageKey(orgSlug, projectName), JSON.stringify(filters));
  } catch {
    // Ignore storage errors
  }
}

export function deserializeFilters(orgSlug: string, projectName: string): RunFilter[] {
  try {
    const raw = localStorage.getItem(storageKey(orgSlug, projectName));
    if (!raw) return [];
    return JSON.parse(raw) as RunFilter[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatCondition(
  dataType: ColumnDataType,
  op: string,
  vals: unknown[],
): string {
  if (op === "exists") return "exists";
  if (op === "not exists") return "not exists";

  if (vals.length === 0) return op;

  if (dataType === "multiOption" && Array.isArray(vals[0])) {
    const items = vals[0] as string[];
    const display = items.length <= 2 ? items.join(", ") : `${items.length} values`;
    return `${op} ${display}`;
  }

  if (dataType === "date") {
    const d = vals[0];
    const dateObj = d instanceof Date ? d : new Date(String(d));
    const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
    if (op === "is between" && vals[1]) {
      const d2 = vals[1];
      const dateObj2 = d2 instanceof Date ? d2 : new Date(String(d2));
      const dateStr2 = `${dateObj2.getMonth() + 1}/${dateObj2.getDate()}/${dateObj2.getFullYear()}`;
      return `between ${dateStr} – ${dateStr2}`;
    }
    return `${op} ${dateStr}`;
  }

  const display = vals.length <= 2 ? vals.join(", ") : `${vals.length} values`;
  return `${op} ${display}`;
}

export function formatFilterChip(filter: RunFilter): string {
  let field = FIELD_LABEL_MAP.get(`${filter.source}:${filter.field}`) ?? filter.field;
  if (filter.source === "metric" && filter.aggregation) {
    field = `${filter.field} (${filter.aggregation})`;
  }
  const primary = formatCondition(filter.dataType, filter.operator, filter.values);

  if (!filter.conditions?.length) {
    return `${field} ${primary}`;
  }

  const parts = [primary];
  for (const c of filter.conditions) {
    parts.push(formatCondition(filter.dataType, c.operator, c.values));
  }
  return `${field} ${parts.join(" & ")}`;
}
