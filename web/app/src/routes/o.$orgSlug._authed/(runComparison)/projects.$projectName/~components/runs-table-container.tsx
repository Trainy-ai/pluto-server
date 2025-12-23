import { useMemo } from "react";
import { DataTable } from "./runs-table/data-table";
import { columns } from "./runs-table/columns";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { trpc } from "@/utils/trpc";

type Run = inferOutput<typeof trpc.runs.list>["runs"][number];

interface RunsTableContainerProps {
  runs: Run[];
  orgSlug: string;
  projectName: string;
  onColorChange: (runId: string, color: string) => void;
  onSelectionChange: (runId: string, isSelected: boolean) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  runColors: Record<string, string>;
  defaultRowSelection: Record<number, boolean>;
}

/**
 * Container component for the runs data table
 * Provides column configuration and memoizes the table to prevent unnecessary re-renders
 */
export function RunsTableContainer({
  runs,
  orgSlug,
  projectName,
  onColorChange,
  onSelectionChange,
  selectedRunsWithColors,
  runColors,
  defaultRowSelection,
}: RunsTableContainerProps) {
  // Calculate current row selection based on actual selectedRunsWithColors
  // This ensures the table checkboxes stay in sync with the actual selected runs
  const currentRowSelection = useMemo(() => {
    const selection: Record<number, boolean> = {};

    // Map through the runs array to find indices of selected runs
    runs.forEach((run, index) => {
      if (selectedRunsWithColors[run.id]) {
        selection[index] = true;
      } else {
        selection[index] = false;
      }
    });

    return selection;
  }, [runs, selectedRunsWithColors]);

  // Memoize the DataTable component to prevent unnecessary re-renders
  const memoizedDataTable = useMemo(
    () => (
      <DataTable
        columns={columns({
          orgSlug,
          projectName,
          onColorChange,
          onSelectionChange,
          runColors,
        })}
        data={runs ?? []}
        defaultRowSelection={currentRowSelection}
      />
    ),
    [
      orgSlug,
      projectName,
      onColorChange,
      onSelectionChange,
      selectedRunsWithColors,
      runColors,
      runs,
      currentRowSelection,
    ],
  );

  return memoizedDataTable;
}
