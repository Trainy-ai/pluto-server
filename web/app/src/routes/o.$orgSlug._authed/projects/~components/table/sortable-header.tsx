import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  label: string;
}

/**
 * Click-to-sort column header for the projects table.
 *
 * Sorting is server-side, so this only reports the current state and toggles
 * it — TanStack's handler cycles ascending → descending → unsorted, and the
 * page turns that into a new query.
 *
 * The `aria-sort` announcement belongs on the `<th>` rather than here; the
 * table applies it (see data-table.tsx).
 */
export function SortableHeader<TData, TValue>({
  column,
  label,
}: SortableHeaderProps<TData, TValue>) {
  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;

  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      data-testid={`projects-sort-${column.id}`}
      className={cn(
        "group -mx-2 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent/50",
        sorted && "text-foreground",
      )}
    >
      {label}
      {/* Kept mounted while unsorted so revealing it on hover doesn't shift the
          header row. */}
      <Icon
        className={cn(
          "size-3.5 shrink-0 transition-opacity",
          sorted ? "opacity-100" : "opacity-0 group-hover:opacity-60",
        )}
      />
    </button>
  );
}
