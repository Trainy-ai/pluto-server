import type { Row } from "@tanstack/react-table";
import type { ColumnConfig } from "../../~hooks/use-column-config";
import type { Run } from "../../~queries/list-runs";
import { formatValue } from "@/lib/flatten-object";

/** Returns the contiguous slice of rows between idA and idB (inclusive, in array order). */
export function getRowRange<T>(rows: Array<Row<T>>, idA: string, idB: string) {
  const range: Array<Row<T>> = [];
  let foundStart = false;
  let foundEnd = false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.id === idA || row.id === idB) {
      if (foundStart) {
        foundEnd = true;
      }
      if (!foundStart) {
        foundStart = true;
      }
    }
    if (foundStart) {
      range.push(row);
    }
    if (foundEnd) {
      break;
    }
  }
  // added this check
  if (!foundEnd) {
    throw Error("Could not find whole row range");
  }
  return range;
}

/** Extracts a value from a Run for a given custom column config */
export function getCustomColumnValue(run: Run, col: ColumnConfig): unknown {
  if (col.source === "system") {
    switch (col.id) {
      case "runId": {
        const prefix = (run as any).project?.runPrefix;
        const num = run.number;
        return num != null && prefix ? `${prefix}-${num}` : run.id;
      }
      case "createdAt":
        return run.createdAt;
      case "updatedAt":
        return run.updatedAt;
      case "statusUpdated":
        return run.statusUpdated;
      case "creator.name":
        return run.creator?.name ?? run.creator?.email ?? "-";
      case "notes":
        return run.notes;
      default:
        return "-";
    }
  }

  // Metric columns — look up from metricSummaries attached to the run
  if (col.source === "metric" && col.aggregation) {
    const summaries = (run as any).metricSummaries as Record<string, number> | undefined;
    if (!summaries) return undefined;
    const key = `${col.id}|${col.aggregation}`;
    return summaries[key];
  }

  // Config and systemMetadata are pre-flattened once at data load time
  const flat = col.source === "config"
    ? (run as any)._flatConfig
    : (run as any)._flatSystemMetadata;
  return flat?.[col.id];
}

/** Formats a custom column value for display as a string */
export function formatCellValue(value: unknown, col: ColumnConfig): string {
  if (value === null || value === undefined) return "-";
  if (col.source === "system" && (col.id === "createdAt" || col.id === "updatedAt" || col.id === "statusUpdated")) {
    try {
      return new Date(value as string).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(value);
    }
  }
  return formatValue(value);
}
