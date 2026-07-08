import { Link } from "@tanstack/react-router";
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
import { cn } from "@/lib/utils";
import { TruncatedLabel } from "@/components/shared/truncated-label";
import { columnTableId } from "./column-table-id";
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
  // (the memoized column definition can't pass a reactive isHidden prop).
  // Cascade-hide (ancestor bucket hidden) is folded into hiddenRunIds via the
  // setRunsHidden fan-out, so a single lookup covers both explicit + cascade.
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
            // No padding — the button hugs the 16px icon so it never exceeds
            // the always-present 16px checkbox, keeping row height identical
            // whether or not the (selected-only) eye is showing. `inline-flex
            // items-center` centres the icon so the hidden EyeOff (wrapped in an
            // inline-flex span, which otherwise sits high from the line-box
            // baseline gap) lines up with the visible Eye.
            className="relative inline-flex items-center justify-center"
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
  // 3rd-arg `runFallback` is load-bearing for grouped mode: bucket
  // runs typically aren't in the flat-table `currentRuns` slice, so
  // `handleRunSelection` (use-selected-runs.ts:571-572) silently
  // no-ops without a fallback. Per-row eye click passes `row.original`
  // so the click registers regardless of which mode rendered the row.
  onSelectionChange: (runId: RunId, isSelected: boolean, runFallback?: Run) => void;
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
  onSetChecked?: (runIds: string[], checked: boolean, runFallbacks?: Run[]) => void;
  /** Grouped-mode header select-all: the flat row model is empty when grouping
   *  is active, so the header checkbox selects/deselects across all runs in the
   *  page's buckets via these handlers (same ones the visibility menu uses).
   *  `groupedPageRunCount` is the total run count on the page — used to render
   *  the checked / indeterminate state. */
  groupedPageRunCount?: number;
  onGroupedSelectAllOnPage?: () => void;
  onGroupedDeselectAllOnPage?: () => void;
  /** Active chart view ID — passed as search param when navigating to a run */
  activeChartViewId?: string | null;
  /** True when the page is rendering grouped buckets. Hides the per-row
   *  color picker in the name cell — the bucket assigns one color to
   *  every run in it, so individual overrides are meaningless. */
  isGrouped?: boolean;
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
  onSetChecked?: (runIds: string[], checked: boolean, runFallbacks?: Run[]) => void;
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
          range.map((r) => r.original),
        );
      } catch {
        onSetChecked?.([runId], !checked, [row.original]);
      }
    } else {
      onSetChecked?.([runId], !checked, [row.original]);
    }
    lastCheckedIdRef.current = row.id;
  };

  const label = atLimit
    ? `Limit of ${SELECTED_RUNS_LIMIT} selected runs reached — deselect one to add another`
    : checked
      ? "Deselect run"
      : "Select run";

  return (
    <div className="flex items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Checkbox
            checked={checked}
            onClick={handleClick}
            // `aria-disabled` (not `disabled`) so the Tooltip's pointer listener
            // still fires and the limit-reached message shows — browsers swallow
            // hover events on truly-disabled elements. handleClick already
            // early-returns when atLimit, so the control stays inert either way.
            aria-disabled={atLimit}
            className={atLimit ? "cursor-not-allowed opacity-50" : undefined}
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
  groupedPageRunCount = 0,
  onGroupedSelectAllOnPage,
  onGroupedDeselectAllOnPage,
  activeChartViewId,
  isGrouped = false,
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
        let allChecked: boolean;
        let someChecked: boolean;
        let onChange: (checked: boolean) => void;
        if (isGrouped) {
          // The flat row model is empty in grouped mode, so drive the state off
          // the selected count vs the page's total bucket-run count, and route
          // the click to the bucket-aware select/deselect-all-on-page handlers
          // (the same ones behind the visibility menu's "Select all on page").
          const selected = checkedRunIds.size;
          allChecked = groupedPageRunCount > 0 && selected >= groupedPageRunCount;
          someChecked = selected > 0 && !allChecked;
          onChange = (checked) =>
            checked ? onGroupedSelectAllOnPage?.() : onGroupedDeselectAllOnPage?.();
        } else {
          const checkedCount = ids.filter((id) => checkedRunIds.has(id)).length;
          allChecked = ids.length > 0 && checkedCount === ids.length;
          someChecked = checkedCount > 0 && !allChecked;
          onChange = (checked) =>
            onSetChecked?.(ids, checked, rows.map((r) => r.original));
        }
        return (
          <div className="flex items-center justify-center">
            {/* Tooltip-wrapped to match the per-run / group checkboxes (the
                `asChild` trigger overrides data-state, giving every checkbox
                the same dark look and stopping the fully-checked header from
                flashing white). */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Checkbox
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  onCheckedChange={(v) => onChange(v === true)}
                  aria-label="Select all runs on this page"
                  data-testid="select-all-checkbox"
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Select all runs on this page
              </TooltipContent>
            </Tooltip>
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
            {/* Per-row color picker is hidden in grouped view — the
                bucket assigns a single color to all its runs and the
                eye + bucket-header swatch already convey it. */}
            {!isGrouped && (
              <ColorPicker
                color={color}
                defaultColor="#6B7280"
                onChange={(newColor) => onColorChange(runId, newColor)}
                className="h-5 w-5 flex-shrink-0"
              />
            )}
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
    const colTableId = columnTableId(col);
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
        // TruncatedLabel measures scrollWidth vs clientWidth (with a
        // ResizeObserver) so the tooltip appears ONLY when the cell
        // is actually visually truncated — no arbitrary length gate,
        // no tooltip on fully-visible short text. The Radix content
        // is capped at max-w-[28rem] with `text-wrap break-all` so
        // long dependency lists wrap inside the box instead of
        // running off the viewport into a corner.
        return (
          <TruncatedLabel
            text={display}
            className={cn("text-xs", display === "-" && "text-muted-foreground/50")}
          />
        );
      },
    };
  });

  return [...baseColumns, ...dynamicColumns];
};
