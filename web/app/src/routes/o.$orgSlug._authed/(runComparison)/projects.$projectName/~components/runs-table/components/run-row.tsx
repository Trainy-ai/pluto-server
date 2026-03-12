import React from "react";
import { flexRender } from "@tanstack/react-table";
import type { Row } from "@tanstack/react-table";
import { TableRow, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Run } from "../../../~queries/list-runs";

interface RunRowProps {
  row: Row<Run>;
  pinnedColumnMap: Record<string, { left: number; isLast: boolean }>;
  tableBodyRef: React.RefObject<HTMLTableSectionElement | null>;
  isHidden?: boolean;
}

export function RunRow({ row, pinnedColumnMap, tableBodyRef, isHidden }: RunRowProps) {
  return (
    <TableRow
      className={cn("group/row", isHidden && "opacity-60")}
      data-run-id={row.original.id}
      data-run-name={row.original.name}
      data-state={row.getIsSelected() ? "selected" : ""}
      data-hidden={isHidden ? "true" : undefined}
      onMouseEnter={() => {
        // Don't dispatch chart hover for hidden runs (chart can't highlight them)
        if (row.getIsSelected() && !isHidden) {
          const container = tableBodyRef.current?.closest("[data-table-container]");
          if (container) {
            // Clear previous highlight
            container
              .querySelector("[data-hover-highlight]")
              ?.removeAttribute("data-hover-highlight");
            (
              container.querySelector(
                `[data-run-id="${row.original.id}"]`,
              ) as HTMLElement | null
            )?.setAttribute("data-hover-highlight", "true");
          }
          document.dispatchEvent(
            new CustomEvent("run-table-hover", { detail: row.original.id }),
          );
        }
      }}
      onMouseLeave={() => {
        const container = tableBodyRef.current?.closest("[data-table-container]");
        if (container) {
          container
            .querySelector("[data-hover-highlight]")
            ?.removeAttribute("data-hover-highlight");
        }
        document.dispatchEvent(
          new CustomEvent("run-table-hover", { detail: null }),
        );
      }}
    >
      {row.getVisibleCells().map((cell) => {
        const cellBgColor = (cell.column.columnDef.meta as any)?.backgroundColor;
        const colPinned = pinnedColumnMap[cell.column.id];
        return (
          <TableCell
            key={cell.id}
            className={cn(
              "px-2 py-2 text-sm",
              colPinned && [
                "sticky",
                "before:absolute before:inset-0 before:-z-10 before:bg-background",
                "group-hover/row:bg-muted/50",
                "group-data-[state=selected]/row:bg-muted",
              ],
            )}
            style={{
              ...(cellBgColor
                ? colPinned
                  ? { background: `linear-gradient(${cellBgColor}10, ${cellBgColor}10), hsl(var(--background))` }
                  : { backgroundColor: `${cellBgColor}10` }
                : undefined),
              ...(colPinned && {
                left: colPinned.left,
                zIndex: 1,
                ...(colPinned.isLast && { boxShadow: '3px 0 6px -2px rgba(0,0,0,0.15)' }),
              }),
            }}
          >
            <div className={cell.column.id === "select" ? "overflow-visible" : "truncate"}>
              {flexRender(
                cell.column.columnDef.cell,
                cell.getContext(),
              )}
            </div>
          </TableCell>
        );
      })}
    </TableRow>
  );
}
