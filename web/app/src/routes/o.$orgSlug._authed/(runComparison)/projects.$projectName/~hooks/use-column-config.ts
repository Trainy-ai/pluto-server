import { useState, useCallback, useEffect } from "react";

export type MetricAggregation = "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";

export interface ColumnConfig {
  id: string; // e.g., "createdAt", "config.lr", "systemMetadata.hostname", "train/loss"
  source: "system" | "config" | "systemMetadata" | "metric";
  label: string; // Display name
  customLabel?: string; // user-set display name (rename)
  backgroundColor?: string; // hex color for column tinting
  aggregation?: MetricAggregation; // Only for source === "metric"
  isPinned?: boolean; // Whether the column is pinned to the left
}

/** Default columns — pre-checked on first visit. Shown in "Defaults" group. */
export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "runId", source: "system", label: "Id" },
  { id: "createdAt", source: "system", label: "Created" },
  { id: "creator.name", source: "system", label: "Owner" },
  { id: "tags", source: "system", label: "Tags" },
  { id: "notes", source: "system", label: "Notes" },
];

/** Additional system columns — not checked by default. Shown in "System" group. */
export const EXTRA_SYSTEM_COLUMNS: ColumnConfig[] = [
  { id: "updatedAt", source: "system", label: "Updated" },
  { id: "statusUpdated", source: "system", label: "Status Changed" },
];

/** All system columns for lookup */
export const ALL_SYSTEM_COLUMNS: ColumnConfig[] = [
  ...DEFAULT_COLUMNS,
  ...EXTRA_SYSTEM_COLUMNS,
];

/** Storage version — bump to reset saved columns when schema changes */
const STORAGE_VERSION = 5;

function getStorageKey(orgSlug: string, projectName: string): string {
  return `mlop:columns:v${STORAGE_VERSION}:${orgSlug}:${projectName}`;
}

function loadColumns(orgSlug: string, projectName: string): ColumnConfig[] | null {
  try {
    const raw = localStorage.getItem(getStorageKey(orgSlug, projectName));
    if (!raw) return null; // null = no saved config, use defaults
    return JSON.parse(raw) as ColumnConfig[];
  } catch {
    return null;
  }
}

function saveColumns(
  orgSlug: string,
  projectName: string,
  columns: ColumnConfig[],
): void {
  try {
    localStorage.setItem(
      getStorageKey(orgSlug, projectName),
      JSON.stringify(columns),
    );
  } catch {
    // localStorage full or unavailable
  }
}

export function useColumnConfig(orgSlug: string, projectName: string) {
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = loadColumns(orgSlug, projectName);
    // First visit: use defaults
    return saved ?? [...DEFAULT_COLUMNS];
  });

  // Sync when orgSlug/projectName changes
  useEffect(() => {
    const saved = loadColumns(orgSlug, projectName);
    setColumns(saved ?? [...DEFAULT_COLUMNS]);
  }, [orgSlug, projectName]);

  const updateColumns = useCallback(
    (newColumns: ColumnConfig[]) => {
      setColumns(newColumns);
      saveColumns(orgSlug, projectName, newColumns);
    },
    [orgSlug, projectName],
  );

  const addColumn = useCallback(
    (col: ColumnConfig) => {
      setColumns((prev) => {
        if (prev.some((c) =>
          c.id === col.id && c.source === col.source && c.aggregation === col.aggregation
        )) {
          return prev;
        }
        const next = [...prev, col];
        saveColumns(orgSlug, projectName, next);
        return next;
      });
    },
    [orgSlug, projectName],
  );

  const removeColumn = useCallback(
    (col: ColumnConfig) => {
      setColumns((prev) => {
        const next = prev.filter(
          (c) => !(c.id === col.id && c.source === col.source && c.aggregation === col.aggregation),
        );
        saveColumns(orgSlug, projectName, next);
        return next;
      });
    },
    [orgSlug, projectName],
  );

  const reorderColumns = useCallback(
    (fromIndex: number, toIndex: number) => {
      setColumns((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        saveColumns(orgSlug, projectName, next);
        return next;
      });
    },
    [orgSlug, projectName],
  );

  const toggleColumnPin = useCallback(
    (colId: string, source: string, aggregation?: string) => {
      setColumns((prev) => {
        const next = prev.map((c) => {
          if (c.id === colId && c.source === source && c.aggregation === aggregation) {
            return { ...c, isPinned: !c.isPinned };
          }
          return c;
        });
        saveColumns(orgSlug, projectName, next);
        return next;
      });
    },
    [orgSlug, projectName],
  );

  return { columns, addColumn, removeColumn, updateColumns, reorderColumns, toggleColumnPin };
}

/** Overrides for base columns (Name, Status) that aren't in customColumns */
export interface BaseColumnOverrides {
  customLabel?: string;
  backgroundColor?: string;
}

const BASE_OVERRIDES_VERSION = 1;

function getBaseOverridesKey(orgSlug: string, projectName: string): string {
  return `mlop:col-base-overrides:v${BASE_OVERRIDES_VERSION}:${orgSlug}:${projectName}`;
}

function loadBaseOverrides(
  orgSlug: string,
  projectName: string,
): Record<string, BaseColumnOverrides> | null {
  try {
    const raw = localStorage.getItem(getBaseOverridesKey(orgSlug, projectName));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, BaseColumnOverrides>;
  } catch {
    return null;
  }
}

function saveBaseOverrides(
  orgSlug: string,
  projectName: string,
  overrides: Record<string, BaseColumnOverrides>,
): void {
  try {
    localStorage.setItem(
      getBaseOverridesKey(orgSlug, projectName),
      JSON.stringify(overrides),
    );
  } catch {
    // localStorage full or unavailable
  }
}

export function useBaseColumnOverrides(orgSlug: string, projectName: string) {
  const [overrides, setOverrides] = useState<Record<string, BaseColumnOverrides>>(() => {
    return loadBaseOverrides(orgSlug, projectName) ?? {};
  });

  useEffect(() => {
    setOverrides(loadBaseOverrides(orgSlug, projectName) ?? {});
  }, [orgSlug, projectName]);

  const updateOverride = useCallback(
    (columnId: string, updates: Partial<BaseColumnOverrides>) => {
      setOverrides((prev) => {
        const next = { ...prev, [columnId]: { ...prev[columnId], ...updates } };
        saveBaseOverrides(orgSlug, projectName, next);
        return next;
      });
    },
    [orgSlug, projectName],
  );

  const setAllOverrides = useCallback(
    (newOverrides: Record<string, BaseColumnOverrides>) => {
      setOverrides(newOverrides);
      saveBaseOverrides(orgSlug, projectName, newOverrides);
    },
    [orgSlug, projectName],
  );

  return { overrides, updateOverride, setAllOverrides };
}
