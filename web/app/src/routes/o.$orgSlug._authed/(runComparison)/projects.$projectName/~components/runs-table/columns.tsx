import { Link } from "@tanstack/react-router";
import { TruncatedLabel } from "@/components/shared/truncated-label";
import type { ColumnDef, Row, SortingState } from "@tanstack/react-table";
import { Eye, EyeOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorPicker } from "@/components/ui/color-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { SELECTED_RUNS_LIMIT } from "./config";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
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
import { memo } from "react";
import { useHiddenRunIds } from "@/hooks/use-hidden-run-ids";
import { ColumnHeaderMenu } from "./column-header-menu";
import { StatusColumnHeader } from "./status-column-header";
import { getRowRange, getCustomColumnValue, formatCellValue } from "./columns-utils";

type RunId = string;
type RunColor = string;

/**
 * Eye cell — a pure chart-VISIBILITY toggle for runs that are already selected.
 *
 * Selection (adding/removing a run from the charts) is owned by the checkbox
 * column; the eye no longer selects or deselects. It renders only for selected
 * runs:
 * - Selected + visible: Eye. Click → hide from charts (stays selected).
 * - Selected + hidden: EyeOff with colored dot. Click → show on charts.
 * - Unselected: nothing to show/hide → renders null.
 */
interface SelectionCellProps {
  row: Row<Run>;
  onToggleVisibility: (runId: RunId) => void;
  runColor?: string;
}

const SelectionCell = memo(function SelectionCell({
  row,
  onToggleVisibility,
  runColor,
}: SelectionCellProps) {
  const isSelected = row.getIsSelected();
  const runId = row.original.id;

  // Read hidden state directly via hook so the icon stays in sync
  // (the memoized column definition can't pass a reactive isHidden prop)
  const hiddenRunIds = useHiddenRunIds();
  const isHidden = hiddenRunIds.has(runId);

  // The eye is a pure visibility toggle for SELECTED runs. Selection is owned
  // by the checkbox column now, so an unselected run has nothing to show/hide.
  if (!isSelected) return null;

  const eyeTooltip = isHidden ? "Show on charts" : "Hide from charts";

  return (
    <div className="relative flex items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility(runId);
            }}
            aria-label={eyeTooltip}
            className="relative p-1"
          >
            {isHidden ? (
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
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {eyeTooltip}
        </TooltipContent>
      </Tooltip>
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
  /** Status column header filter — selected RunStatus values + setter */
  statusFilterValues?: string[];
  onStatusFilterChange?: (values: string[]) => void;
  /** Bulk-actions checkbox selection (decoupled from the eye/chart selection) */
  checkedRunIds?: Set<string>;
  onSetChecked?: (runIds: string[], checked: boolean) => void;
  /** Active chart view ID — passed as search param when navigating to a run */
  activeChartViewId?: string | null;
  /** Set of pinned column table IDs (includes base + user-pinned custom columns) */
  pinnedColumnIds?: Set<string>;
  /** Callback to toggle pin on a custom column */
  onToggleColumnPin?: (colId: string, source: string, aggregation?: string) => void;
  /** Callback to pin images at the best step for a metric */
  onPinImagesToBestStep?: (
    logName: string,
    mode: "argmin" | "argmax" | "argmin-with-image" | "argmax-with-image",
    toleranceOverride?: number,
  ) => void;
  /** Project-wide nearest-snap tolerance for "with image" pin variants */
  bestStepToleranceSteps?: number;
  /** Persist a new tolerance value on the project */
  onChangeBestStepTolerance?: (next: number) => void;
}

// Shift-click range anchor for the selection checkbox column.
const lastCheckedIdRef = { current: "" };

// Stable empty default so an unset checkedRunIds prop doesn't allocate a new
// Set on every columns() call.
const EMPTY_CHECKED_SET: Set<string> = new Set();

/**
 * Selection checkbox cell — the sole control for selecting a run: checking it
 * adds the run to the charts (?runs=) AND marks it as the target of bulk actions
 * (delete); unchecking removes it. Disabled once SELECTED_RUNS_LIMIT runs are
 * selected (matching the cap the eye used to enforce). Shift-click selects a
 * contiguous range mirroring the anchor row's state. A hover tooltip mirrors the
 * aria-label ("Select run" / "Deselect run") — the latter also keeps the shared
 * E2E helper `selectSpecificRuns` targeting the right control.
 */
function CheckboxCell({
  row,
  table,
  checkedRunIds,
  onSetChecked,
}: {
  row: Row<Run>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  checkedRunIds: Set<string>;
  onSetChecked?: (runIds: string[], checked: boolean) => void;
}) {
  const runId = row.original.id;
  const checked = checkedRunIds.has(runId);
  // Cap selection like the old eye did: can't add more once at the limit.
  const atLimit = !checked && checkedRunIds.size >= SELECTED_RUNS_LIMIT;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (atLimit) return;
    if (
      e.shiftKey &&
      lastCheckedIdRef.current &&
      lastCheckedIdRef.current !== row.id
    ) {
      try {
        const { rows } = table.getRowModel();
        const range = getRowRange<Run>(rows, row.id, lastCheckedIdRef.current);
        const anchorChecked = checkedRunIds.has(lastCheckedIdRef.current);
        onSetChecked?.(
          range.map((r) => r.original.id),
          anchorChecked,
        );
      } catch {
        onSetChecked?.([runId], !checked);
      }
    } else {
      onSetChecked?.([runId], !checked);
    }
    lastCheckedIdRef.current = row.id;
  };

  const label = checked ? "Deselect run" : "Select run";

  return (
    <div className="flex items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Checkbox
            checked={checked}
            onClick={handleClick}
            disabled={atLimit}
            aria-label={label}
            data-testid="run-checkbox"
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export const columns = ({
  orgSlug,
  projectName,
  organizationId,
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
  statusFilterValues = [],
  onStatusFilterChange,
  checkedRunIds = EMPTY_CHECKED_SET,
  onSetChecked,
  activeChartViewId,
  pinnedColumnIds,
  onToggleColumnPin,
  onPinImagesToBestStep,
  bestStepToleranceSteps,
  onChangeBestStepTolerance,
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
      id: "check",
      size: 36,
      minSize: 36,
      maxSize: 36,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => {
        const rows = table.getRowModel().rows as Row<Run>[];
        const ids = rows.map((r) => r.original.id);
        const checkedCount = ids.filter((id) => checkedRunIds.has(id)).length;
        const allChecked = ids.length > 0 && checkedCount === ids.length;
        const someChecked = checkedCount > 0 && !allChecked;
        return (
          <div className="flex items-center justify-center">
            <Checkbox
              checked={allChecked ? true : someChecked ? "indeterminate" : false}
              onCheckedChange={(v) => onSetChecked?.(ids, v === true)}
              aria-label="Select all runs on this page"
              data-testid="select-all-checkbox"
            />
          </div>
        );
      },
      cell: ({ row, table }) => (
        <CheckboxCell
          row={row}
          table={table}
          checkedRunIds={checkedRunIds}
          onSetChecked={onSetChecked}
        />
      ),
    },
    {
      id: "select",
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableResizing: false,
      // Empty header - VisibilityOptions is now rendered in the toolbar for better performance
      header: () => null,
      cell: ({ row }) => {
        const runId = row.original.id;
        return (
          <SelectionCell
            row={row}
            onToggleVisibility={onToggleVisibility}
            runColor={getRunColor(runId)}
          />
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "status",
      header: () => (
        <StatusColumnHeader
          label="Status"
          sortDirection={getSortDirection("status")}
          onSort={(dir) => handleSort("status", dir)}
          statusValues={statusFilterValues}
          onStatusChange={(values) => onStatusFilterChange?.(values)}
        />
      ),
      size: 116,
      minSize: 116,
      maxSize: 116,
      enableResizing: false,
      enableSorting: true,
      cell: ({ row }) => {
        return (
          <div className="flex items-center">
            <RunStatusBadge
              run={{
                status: row.original.status,
                updatedAt: row.original.updatedAt
                  ? new Date(row.original.updatedAt)
                  : new Date(),
              }}
            />
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
            <Link
              to="/o/$orgSlug/projects/$projectName/$runId"
              preload="intent"
              className="group flex min-w-0 flex-1 items-center rounded-md transition-colors hover:bg-accent/50"
              params={{ orgSlug, projectName, runId: displayId ?? runId }}
              search={activeChartViewId ? { chart: activeChartViewId } : {}}
            >
              <TruncatedLabel
                text={name}
                className="text-xs font-medium group-hover:underline"
              />
            </Link>
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
              projectName={projectName}
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
              ? (mode, toleranceOverride) =>
                  onPinImagesToBestStep(col.id, mode, toleranceOverride)
              : undefined
          }
          bestStepToleranceSteps={bestStepToleranceSteps}
          onChangeBestStepTolerance={
            col.source === "metric" ? onChangeBestStepTolerance : undefined
          }
        />
      ),
      meta: { backgroundColor: col.backgroundColor },
      size: 120,
      minSize: 80,
      enableSorting: canSort,
      cell: ({ row }: { row: Row<Run> }) => {
        const value = getCustomColumnValue(row.original, col);
        // Metric columns: distinguish "still fetching" from "value is
        // genuinely null/NaN". Both used to render as "-", which made
        // it impossible to tell whether to wait or accept the empty.
        if (
          col.source === "metric" &&
          value == null &&
          (row.original as { _metricsLoading?: boolean })._metricsLoading
        ) {
          return <Skeleton className="h-3 w-12" />;
        }
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
