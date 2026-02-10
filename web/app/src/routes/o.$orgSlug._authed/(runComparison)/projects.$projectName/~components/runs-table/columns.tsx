import { Link } from "@tanstack/react-router";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { Eye, EyeOff } from "lucide-react";
import { ColorPicker } from "@/components/ui/color-picker";
import { SELECTED_RUNS_LIMIT } from "./config";
import { StatusIndicator } from "@/components/layout/dashboard/sidebar";
import type { Run } from "../../~queries/list-runs";
import { TagsCell } from "./tags-cell";
import { NotesCell } from "./notes-cell";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useState, useEffect, useCallback, memo, type MutableRefObject } from "react";
import { flushSync } from "react-dom";

type RunId = string;
type RunColor = string;

/**
 * Selection cell component with optimistic UI updates
 * Uses local state for immediate visual feedback while global state updates
 */
interface SelectionCellProps {
  row: Row<Run>;
  table: any;
  totalSelected: number;
  onSelectionChange: (runId: RunId, isSelected: boolean) => void;
  lastSelectedIdRef: MutableRefObject<string>;
}

const SelectionCell = memo(function SelectionCell({
  row,
  table,
  totalSelected,
  onSelectionChange,
  lastSelectedIdRef,
}: SelectionCellProps) {
  const isSelected = row.getIsSelected();
  const isDisabled = totalSelected >= SELECTED_RUNS_LIMIT && !isSelected;
  const runId = row.original.id;

  // Local optimistic state for immediate visual feedback
  const [optimisticSelected, setOptimisticSelected] = useState(isSelected);

  // Sync with actual state when it catches up
  useEffect(() => {
    setOptimisticSelected(isSelected);
  }, [isSelected]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) return;

    if (!e.shiftKey) {
      // Regular click: update optimistically then sync global state
      const newValue = !optimisticSelected;

      // Use flushSync to immediately commit the visual update before React batches
      // This ensures the checkbox icon changes instantly
      flushSync(() => {
        setOptimisticSelected(newValue);
      });

      row.toggleSelected(newValue);

      // Call onSelectionChange directly - useDeferredValue in parent handles deferral
      // Double-deferral (requestIdleCallback + useDeferredValue) was causing chart updates to be lost
      onSelectionChange(runId, newValue);
    } else {
      // Shift-click: range selection
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
  }, [optimisticSelected, isDisabled, runId, row, table, onSelectionChange, lastSelectedIdRef]);

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      aria-label="Toggle select row"
      className="p-1"
    >
      {optimisticSelected ? (
        <Eye className="h-4 w-4" />
      ) : (
        <EyeOff className="h-4 w-4 text-muted-foreground transition-colors hover:text-primary/80" />
      )}
    </button>
  );
});

interface ColumnsProps {
  orgSlug: string;
  projectName: string;
  onSelectionChange: (runId: RunId, isSelected: boolean) => void;
  onColorChange: (runId: RunId, color: RunColor) => void;
  onTagsUpdate: (runId: RunId, tags: string[]) => void;
  onNotesUpdate: (runId: RunId, notes: string | null) => void;
  /** Getter function for run colors - avoids column recreation on color changes */
  getRunColor: (runId: RunId) => RunColor | undefined;
  allTags: string[];
}

function getRowRange<T>(rows: Array<Row<T>>, idA: string, idB: string) {
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

// Shared ref for tracking last selected row ID (for shift-click range selection)
const lastSelectedIdRef = { current: "" };

export const columns = ({
  orgSlug,
  projectName,
  onSelectionChange,
  onColorChange,
  onTagsUpdate,
  onNotesUpdate,
  getRunColor,
  allTags,
}: ColumnsProps): ColumnDef<Run>[] => {
  return [
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
        return (
          <SelectionCell
            row={row}
            table={table}
            totalSelected={totalSelected}
            onSelectionChange={onSelectionChange}
            lastSelectedIdRef={lastSelectedIdRef}
          />
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
    {
      header: "Name",
      accessorKey: "name",
      size: 140,
      minSize: 100,
      cell: ({ row }) => {
        const runId = row.original.id;
        const name = row.original.name;
        const color = getRunColor(runId);

        return (
          <div className="flex w-full items-center gap-2 overflow-hidden">
            <ColorPicker
              color={color}
              onChange={(newColor) => onColorChange(runId, newColor)}
              className="h-5 w-5 flex-shrink-0"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/o/$orgSlug/projects/$projectName/$runId"
                  preload="intent"
                  className="group flex min-w-0 flex-1 items-center rounded-md transition-colors hover:bg-accent/50"
                  params={{ orgSlug, projectName, runId }}
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
    {
      header: "Tags",
      accessorKey: "tags",
      size: 110,
      minSize: 80,
      cell: ({ row }) => {
        const runId = row.original.id;
        const tags = row.original.tags || [];

        return (
          <TagsCell
            tags={tags}
            allTags={allTags}
            onTagsUpdate={(newTags) => onTagsUpdate(runId, newTags)}
          />
        );
      },
    },
    {
      header: "Notes",
      accessorKey: "notes",
      size: 120,
      minSize: 80,
      cell: ({ row }) => {
        const runId = row.original.id;
        const notes = row.original.notes ?? null;

        return (
          <NotesCell
            notes={notes}
            onNotesUpdate={(newNotes) => onNotesUpdate(runId, newNotes)}
          />
        );
      },
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
  ];
};
