import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, ArrowDown, ArrowUpDown, ListFilter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS } from "@/lib/run-filters";

export interface StatusColumnHeaderProps {
  label: string;
  sortDirection: "asc" | "desc" | false;
  onSort: (direction: "asc" | "desc" | false) => void;
  /** Currently-selected status values (subset of the RunStatus enum). */
  statusValues: string[];
  onStatusChange: (values: string[]) => void;
}

/**
 * Header for the Status column: sortable + an inline "filter by state" menu so
 * a prune workflow (grab every FAILED/OOM run → bulk delete) doesn't require
 * the toolbar filter builder. The filter writes through the same RunFilter
 * state as the toolbar, so the two stay in sync.
 */
export function StatusColumnHeader({
  label,
  sortDirection,
  onSort,
  statusValues,
  onStatusChange,
}: StatusColumnHeaderProps) {
  const isFiltered = statusValues.length > 0;

  const toggle = (value: string) => {
    const next = statusValues.includes(value)
      ? statusValues.filter((v) => v !== value)
      : [...statusValues, value];
    onStatusChange(next);
  };

  return (
    <div className="flex w-full items-center gap-1 pr-5">
      <span className="truncate text-xs font-medium">{label}</span>
      {sortDirection && (
        <span className="flex-shrink-0">
          {sortDirection === "asc" ? (
            <ArrowUp className="h-3 w-3 text-primary" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" />
          )}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="status-header-trigger"
            aria-label="Sort or filter by status"
            className={cn(
              "absolute right-2.5 top-1/2 -translate-y-1/2 flex-shrink-0 rounded p-px transition-opacity z-10",
              // Always faintly visible (and solid when a filter is active) so
              // "filter by state" is discoverable, not hover-only.
              isFiltered
                ? "text-primary opacity-100"
                : "opacity-50 group-hover:opacity-100 hover:bg-zinc-300 dark:hover:bg-zinc-600",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <ListFilter className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onClick={() => onSort(sortDirection === "asc" ? false : "asc")}
          >
            <ArrowUp className="mr-2 h-4 w-4" />
            Sort ascending
            {sortDirection === "asc" && (
              <span className="ml-auto text-xs text-primary">Active</span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onSort(sortDirection === "desc" ? false : "desc")}
          >
            <ArrowDown className="mr-2 h-4 w-4" />
            Sort descending
            {sortDirection === "desc" && (
              <span className="ml-auto text-xs text-primary">Active</span>
            )}
          </DropdownMenuItem>
          {sortDirection && (
            <DropdownMenuItem onClick={() => onSort(false)}>
              <ArrowUpDown className="mr-2 h-4 w-4" />
              Clear sort
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Filter by state
          </DropdownMenuLabel>
          {STATUS_OPTIONS.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              data-testid={`status-filter-${opt.value}`}
              checked={statusValues.includes(opt.value)}
              // Keep the menu open while toggling multiple states.
              onSelect={(e) => {
                e.preventDefault();
                toggle(opt.value);
              }}
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))}
          {isFiltered && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onStatusChange([])}>
                <X className="mr-2 h-4 w-4" />
                Clear filter
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
