import { Link } from "@tanstack/react-router";
import type { ColumnDef, Row, SortingState } from "@tanstack/react-table";
import { Eye, EyeOff, X } from "lucide-react";
import { ColorPicker } from "@/components/ui/color-picker";
import { SELECTED_RUNS_LIMIT } from "./config";
import { StatusIndicator } from "@/components/layout/dashboard/sidebar";
import type { Run } from "../../~queries/list-runs";
import { TagsCell } from "./tags-cell";
import type { ColumnConfig } from "../../~hooks/use-column-config";
import type { BaseColumnOverrides } from "../../~hooks/use-column-config";
import { NotesCell } from "./notes-cell";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useState, useEffect, useCallback, memo, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { useHiddenRunIds } from "@/hooks/use-hidden-run-ids";
import { ColumnHeaderMenu } from "./column-header-menu";
import { getRowRange, getCustomColumnValue, formatCellValue } from "./columns-utils";

type RunId = string;
type RunColor = string;

/**
 * Selection cell component with optimistic UI updates
 * Uses local state for immediate visual feedback while global state updates
 *
 * Behavior:
 * - Unselected: EyeOff (gray). Click → select (visible by default)
 * - Selected + visible: Eye. Click → hide from charts (stays selected). Hover shows X to deselect.
 * - Selected + hidden: EyeOff with colored dot. Click → show on charts. Hover shows X to deselect.
 */
interface SelectionCellProps {
  row: Row<Run>;
  table: any;
  totalSelected: number;
  onSelectionChange: (runId: RunId, isSelected: boolean) => void;
  onToggleVisibility: (runId: RunId) => void;
  runColor?: string;
  lastSelectedIdRef: MutableRefObject<string>;
}

const SelectionCell = memo(function SelectionCell({
  row,
  table,
  totalSelected,
  onSelectionChange,
  onToggleVisibility,
  runColor,
  lastSelectedIdRef,
}: SelectionCellProps) {
  const isSelected = row.getIsSelected();
  const isDisabled = totalSelected >= SELECTED_RUNS_LIMIT && !isSelected;
  const runId = row.original.id;

  // Read hidden state directly via hook so the icon stays in sync
  // (the memoized column definition can't pass a reactive isHidden prop)
  const hiddenRunIds = useHiddenRunIds();
  const isHidden = hiddenRunIds.has(runId);

  // Local optimistic state for immediate visual feedback
  const [optimisticSelected, setOptimisticSelected] = useState(isSelected);

  // Sync with actual state when it catches up
  useEffect(() => {
    setOptimisticSelected(isSelected);
  }, [isSelected]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) return;

    if (!e.shiftKey) {
      if (optimisticSelected) {
        // Already selected → toggle chart visibility
        onToggleVisibility(runId);
      } else {
        // Not selected → select (visible by default)
        flushSync(() => {
          setOptimisticSelected(true);
        });
        row.toggleSelected(true);
        onSelectionChange(runId, true);
      }
    } else {
      // Shift-click: range selection (unchanged behavior)
      try {
        const { rows, rowsById } = table.getRowModel();
        const rowsToToggle = getRowRange<Run>(rows, row.id, lastSelectedIdRef.current);
        const isLastSelected = rowsById[lastSelectedIdRef.current].getIsSelected();
        rowsToToggle.forEach((r) => {
          r.toggleSelected(isLastSelected);
          onSelectionChange(r.original.id, isLastSelected);
        });
      } catch (e) {
        const newValue = !row.getIsSelected();
        row.toggleSelected(newValue);
        onSelectionChange(runId, newValue);
      }
    }
    lastSelectedIdRef.current = row.id;
  }, [optimisticSelected, isDisabled, runId, row, table, onSelectionChange, onToggleVisibility, lastSelectedIdRef]);

  const handleDeselect = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    flushSync(() => {
      setOptimisticSelected(false);
    });
    row.toggleSelected(false);
    onSelectionChange(runId, false);
  }, [runId, row, onSelectionChange]);

  const eyeTooltip = !optimisticSelected
    ? "Select run"
    : isHidden
      ? "Show on charts"
      : "Hide from charts";

  return (
    <div className="relative flex items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            disabled={isDisabled}
            aria-label={eyeTooltip}
            className="relative p-1"
          >
            {optimisticSelected ? (
              isHidden ? (
                <span className="relative inline-flex">
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                  {runColor && (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-background"
                      style={{ backgroundColor: runColor }}
                    />
                  )}
                </span>
              ) : (
                <Eye className="h-4 w-4" />
              )
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground transition-colors hover:text-primary/80" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {eyeTooltip}
        </TooltipContent>
      </Tooltip>
      {optimisticSelected && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleDeselect}
              aria-label="Deselect run"
              className="absolute -right-3 -top-1 z-20 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 hover:border-destructive/50 hover:bg-destructive/10"
            >
              <X className="h-2.5 w-2.5 text-muted-foreground group-hover/row:text-foreground hover:!text-destructive" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Deselect run
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});

interface ColumnsProps {
  orgSlug: string;
  projectName: string;
  organizationId?: string;
  onSelectionChange: (runId: RunId, isSelected: boolean) => void;
  onToggleVisibility: (runId: RunId) => void;
  onColorChange: (runId: RunId, color: RunColor) => void;
  onTagsUpdate: (runId: RunId, tags: string[]) => void;
  onNotesUpdate: (runId: RunId, notes: string | null) => void;
  /** Getter function for run colors - avoids column recreation on color changes */
  getRunColor: (runId: RunId) => RunColor | undefined;
  /** Getter function to check if a run is hidden from charts */
  getIsHidden: (runId: RunId) => boolean;
  /** Getter function for all tags - avoids column recreation on tag changes */
  getAllTags: () => string[];
  allTags?: never;
  /** Custom columns from the column picker */
  customColumns?: ColumnConfig[];
  /** Column header dropdown callbacks */
  onColumnRename?: (colId: string, source: string, newName: string, aggregation?: string) => void;
  onColumnSetColor?: (colId: string, source: string, color: string | undefined, aggregation?: string) => void;
  onColumnRemove?: (colId: string, source: string, aggregation?: string) => void;
  /** Base column (Name) overrides */
  nameOverrides?: BaseColumnOverrides;
  onNameRename?: (newName: string) => void;
  onNameSetColor?: (color: string | undefined) => void;
  /** Sorting state — managed externally */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Active chart view ID — passed as search param when navigating to a run */
  activeChartViewId?: string | null;
  /** Set of pinned column table IDs (includes base + user-pinned custom columns) */
  pinnedColumnIds?: Set<string>;
  /** Callback to toggle pin on a custom column */
  onToggleColumnPin?: (colId: string, source: string, aggregation?: string) => void;
  /** Callback to pin images at the best step for a metric */
  onPinImagesToBestStep?: (logName: string, mode: "argmin" | "argmax") => void;
}

// Shared ref for tracking last selected row ID (for shift-click range selection)
const lastSelectedIdRef = { current: "" };

export const columns = ({
  orgSlug,
  projectName,
  organizationId,
  onSelectionChange,
  onToggleVisibility,
  onColorChange,
  onTagsUpdate,
  onNotesUpdate,
  getRunColor,
  getIsHidden,
  getAllTags,
  customColumns = [],
  onColumnRename,
  onColumnSetColor,
  onColumnRemove,
  nameOverrides,
  onNameRename,
  onNameSetColor,
  sorting = [],
  onSortingChange,
  activeChartViewId,
  pinnedColumnIds,
  onToggleColumnPin,
  onPinImagesToBestStep,
}: ColumnsProps): ColumnDef<Run>[] => {
  // Helper to get sort direction for a column
  const getSortDirection = (colId: string): "asc" | "desc" | false => {
    const sort = sorting.find((s) => s.id === colId);
    if (!sort) return false;
    return sort.desc ? "desc" : "asc";
  };

  // Helper to toggle sort on a column (single-column sort — replaces previous)
  const handleSort = (colId: string, direction: "asc" | "desc" | false) => {
    if (!onSortingChange) return;
    if (direction === false) {
      onSortingChange([]);
    } else {
      onSortingChange([{ id: colId, desc: direction === "desc" }]);
    }
  };
  // Base columns (always shown)
  const baseColumns: ColumnDef<Run>[] = [
    {
      id: "select",
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableResizing: false,
      // Empty header - VisibilityOptions is now rendered in the toolbar for better performance
      header: () => null,
      cell: ({ row, table }) => {
        const totalSelected = table.getSelectedRowModel().rows.length;
        const runId = row.original.id;
        return (
          <SelectionCell
            row={row}
            table={table}
            totalSelected={totalSelected}
            onSelectionChange={onSelectionChange}
            onToggleVisibility={onToggleVisibility}
            runColor={getRunColor(runId)}
            lastSelectedIdRef={lastSelectedIdRef}
          />
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "status",
      header: "",
      size: 36,
      minSize: 36,
      maxSize: 36,
      enableResizing: false,
      cell: ({ row }) => {
        return (
          <div className="flex items-center justify-end pr-1">
            <StatusIndicator status={row.original.status} />
          </div>
        );
      },
    },
    {
      id: "name",
      accessorKey: "name",
      header: () => (
        <ColumnHeaderMenu
          label={nameOverrides?.customLabel ?? "Name"}
          columnId="name"
          canRemove={false}
          canSort={true}
          sortDirection={getSortDirection("name")}
          backgroundColor={nameOverrides?.backgroundColor}
          onSort={(dir) => handleSort("name", dir)}
          onRename={(newName) => onNameRename?.(newName)}
          onSetColor={(color) => onNameSetColor?.(color)}
        />
      ),
      meta: { backgroundColor: nameOverrides?.backgroundColor },
      size: 140,
      minSize: 100,
      enableSorting: true,
      cell: ({ row }) => {
        const runId = row.original.id;
        const name = row.original.name;
        const color = getRunColor(runId);
        const runNumber = row.original.number;
        const runPrefix = (row.original as Run & { project?: { runPrefix: string | null } }).project?.runPrefix;
        const displayId = runNumber != null && runPrefix
          ? `${runPrefix}-${runNumber}`
          : null;
        return (
          <div className="flex w-full items-center gap-2 overflow-hidden">
            <ColorPicker
              color={color}
              defaultColor="#6B7280"
              onChange={(newColor) => onColorChange(runId, newColor)}
              className="h-5 w-5 flex-shrink-0"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/o/$orgSlug/projects/$projectName/$runId"
                  preload="intent"
                  className="group flex min-w-0 flex-1 items-center rounded-md transition-colors hover:bg-accent/50"
                  params={{ orgSlug, projectName, runId: displayId ?? runId }}
                  search={activeChartViewId ? { chart: activeChartViewId } : {}}
                >
                  <span className="truncate text-sm font-medium group-hover:underline">
                    {name}
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                <p className="max-w-xs">{name}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  // Dynamic custom columns — accessorFn must return a primitive (string).
  // Returning objects/arrays causes infinite re-render loops with column resize.
  const dynamicColumns = customColumns.map((col): ColumnDef<Run> => {
    const colTableId = col.source === "metric" && col.aggregation
      ? `custom-${col.source}-${col.id}-${col.aggregation}`
      : `custom-${col.source}-${col.id}`;
    const displayLabel = col.customLabel ?? col.label;

    // Tags column needs special rendering with TagsCell
    if (col.source === "system" && col.id === "tags") {
      return {
        id: colTableId,
        header: () => (
          <ColumnHeaderMenu
            label={displayLabel}
            columnId={colTableId}
            canRemove={true}
            canSort={false}
            sortDirection={false}
            backgroundColor={col.backgroundColor}
            isPinned={pinnedColumnIds?.has(colTableId)}
            onTogglePin={onToggleColumnPin ? () => onToggleColumnPin(col.id, col.source, col.aggregation) : undefined}
            onSort={() => {}}
            onRename={(newName) => onColumnRename?.(col.id, col.source, newName, col.aggregation)}
            onSetColor={(color) => onColumnSetColor?.(col.id, col.source, color, col.aggregation)}
            onRemove={() => onColumnRemove?.(col.id, col.source, col.aggregation)}
          />
        ),
        meta: { backgroundColor: col.backgroundColor },
        size: 180,
        minSize: 100,
        enableSorting: false,
        cell: ({ row }: { row: Row<Run> }) => {
          const runId = row.original.id;
          const tags = row.original.tags || [];
          return (
            <TagsCell
              tags={tags}
              allTags={getAllTags()}
              onTagsUpdate={(newTags) => onTagsUpdate(runId, newTags)}
              organizationId={organizationId}
            />
          );
        },
      };
    }

    // Notes column needs special rendering with NotesCell
    if (col.source === "system" && col.id === "notes") {
      return {
        id: colTableId,
        accessorFn: (row: Run) => row.notes ?? "",
        header: () => (
          <ColumnHeaderMenu
            label={displayLabel}
            columnId={colTableId}
            canRemove={true}
            canSort={true}
            sortDirection={getSortDirection(colTableId)}
            backgroundColor={col.backgroundColor}
            isPinned={pinnedColumnIds?.has(colTableId)}
            onTogglePin={onToggleColumnPin ? () => onToggleColumnPin(col.id, col.source, col.aggregation) : undefined}
            onSort={(dir) => handleSort(colTableId, dir)}
            onRename={(newName) => onColumnRename?.(col.id, col.source, newName, col.aggregation)}
            onSetColor={(color) => onColumnSetColor?.(col.id, col.source, color, col.aggregation)}
            onRemove={() => onColumnRemove?.(col.id, col.source, col.aggregation)}
          />
        ),
        meta: { backgroundColor: col.backgroundColor },
        size: 120,
        minSize: 80,
        enableSorting: true,
        cell: ({ row }: { row: Row<Run> }) => {
          const runId = row.original.id;
          const notes = row.original.notes ?? null;
          return (
            <NotesCell
              notes={notes}
              onNotesUpdate={(newNotes) => onNotesUpdate(runId, newNotes)}
            />
          );
        },
      };
    }

    // Disable sorting for runId — displayed SQID strings don't preserve numeric order
    const canSort = !(col.source === "system" && col.id === "runId");

    return {
      id: colTableId,
      // accessorFn is required for TanStack Table's getCanSort() to return true.
      // Must return a primitive (string) to avoid infinite re-render loops.
      accessorFn: (row: Run) => {
        const val = getCustomColumnValue(row, col);
        if (val == null) return "";
        return String(val);
      },
      header: () => (
        <ColumnHeaderMenu
          label={displayLabel}
          columnId={colTableId}
          canRemove={true}
          canSort={canSort}
          sortDirection={canSort ? getSortDirection(colTableId) : false}
          backgroundColor={col.backgroundColor}
          isPinned={pinnedColumnIds?.has(colTableId)}
          onTogglePin={onToggleColumnPin ? () => onToggleColumnPin(col.id, col.source, col.aggregation) : undefined}
          onSort={(dir) => canSort && handleSort(colTableId, dir)}
          onRename={(newName) => onColumnRename?.(col.id, col.source, newName, col.aggregation)}
          onSetColor={(color) => onColumnSetColor?.(col.id, col.source, color, col.aggregation)}
          onRemove={() => onColumnRemove?.(col.id, col.source, col.aggregation)}
          isMetric={col.source === "metric"}
          onPinImagesToBestStep={
            col.source === "metric" && onPinImagesToBestStep
              ? (mode) => onPinImagesToBestStep(col.id, mode)
              : undefined
          }
        />
      ),
      meta: { backgroundColor: col.backgroundColor },
      size: 120,
      minSize: 80,
      enableSorting: canSort,
      cell: ({ row }: { row: Row<Run> }) => {
        const value = getCustomColumnValue(row.original, col);
        const display = formatCellValue(value, col);
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`truncate text-xs ${display === "-" ? "text-muted-foreground/50" : ""}`}
              >
                {display}
              </span>
            </TooltipTrigger>
            {display !== "-" && display.length > 20 && (
              <TooltipContent side="top" sideOffset={4}>
                <p className="max-w-xs break-all">{display}</p>
              </TooltipContent>
            )}
          </Tooltip>
        );
      },
    };
  });

  return [...baseColumns, ...dynamicColumns];
};
