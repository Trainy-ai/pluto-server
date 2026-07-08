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
  /** In experiments mode, all run IDs belonging to this experiment (for group highlight) */
  experimentRunIds?: string[];
  /** When grouping is active, the first column has been widened by
   *  this much in the colgroup. Push the cell's inner content right
   *  by the same amount so the eye sits at the right end of the wider
   *  cell (visually "deeper" than the leaf bucket above). Zero in
   *  flat mode. */
  firstCellPaddingLeft?: number;
  /** Marks this row as rendered from the pinned (PSTT-sticky) block.
   *  Emitted as a `data-pinned="true"` attribute so tests can count
   *  the pinned section without depending on a wrapper CSS class that
   *  no longer exists (the pinned/unpinned split is now a sibling
   *  `pin-divider` row inside a single TableBody, not two boxes).
   *  Unset on unpinned rows so `tr[data-pinned]` selects only the
   *  pinned half. */
  isPinned?: boolean;
}

export function RunRow({ row, pinnedColumnMap, tableBodyRef, isHidden, experimentRunIds, firstCellPaddingLeft, isPinned }: RunRowProps) {
  const isSelected = row.getIsSelected();
  return (
    <TableRow
      className={cn(
        "group/row",
        // Deselected rows: mute the cell text so bright-foreground
        // reads as "in the comparison" and gray reads as "not in
        // the comparison." Hidden rows get a per-cell `opacity-60`
        // applied BELOW (excluding the select column) so the
        // hover-revealed X badge — which extends past the select
        // cell into the next cell — isn't trapped inside an
        // opacity-induced stacking context. Wrapping the WHOLE row
        // in opacity-60 caused the X badge's right half to be
        // clipped by the next sticky cell once isHidden flipped.
        !isSelected && !isHidden && "text-muted-foreground",
      )}
      data-run-id={row.original.id}
      data-run-name={row.original.name}
      data-state={isSelected ? "selected" : ""}
      data-hidden={isHidden ? "true" : undefined}
      data-pinned={isPinned ? "true" : undefined}
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
            new CustomEvent("run-table-hover", {
              detail: experimentRunIds ?? row.original.id,
            }),
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
      {row.getVisibleCells().map((cell, idx) => {
        const cellBgColor = (cell.column.columnDef.meta as any)?.backgroundColor;
        const colPinned = pinnedColumnMap[cell.column.id];
        const isFirstCell = idx === 0;
        return (
          <TableCell
            key={cell.id}
            className={cn(
              "px-2 py-2 text-sm",
              colPinned && [
                "sticky",
                "group-hover/row:bg-muted/50",
                "group-data-[state=selected]/row:bg-muted",
              ],
            )}
            style={{
              ...(cellBgColor
                ? colPinned
                  ? { background: `linear-gradient(${cellBgColor}10, ${cellBgColor}10), hsl(var(--background))` }
                  : { backgroundColor: `${cellBgColor}10` }
                : colPinned
                  ? { backgroundColor: 'hsl(var(--background))' }
                  : undefined),
              ...(colPinned && {
                left: colPinned.left,
                // Select cell sits above its right neighbor so the
                // floating deselect (X) badge — anchored with
                // `-right-3` — isn't covered by the status cell's
                // background.
                // Bumped from 2 to 50 so the X-badge (positioned at
                // `-right-4` past the eye-column cell boundary) renders
                // above the next sticky cell's solid background. Same
                // rationale as the previous 2 > 1 ordering, just at a
                // higher floor.
                zIndex: cell.column.id === "select" ? 50 : 1,
                ...(colPinned.isLast && { borderRight: '2px solid hsl(var(--border))' }),
              }),
              // Pad the FIRST cell's left edge in grouped mode — the
              // colgroup widened it by `firstCellPaddingLeft`, so this
              // pushes the inner content (eye + selection chip) to
              // the right end of the widened cell, lining up with the
              // bucket-tree depth indent above.
              ...(isFirstCell && firstCellPaddingLeft
                ? { paddingLeft: firstCellPaddingLeft + 8 }
                : undefined),
            }}
          >
            <div
              className={cn(
                cell.column.id === "select" ? "overflow-visible" : "truncate",
                // Dim only the inner content of non-select cells when
                // the row is hidden. The TableCell's background (which
                // pinned cells need to stay opaque + identical across
                // visible/hidden states) is unaffected. Select column
                // is skipped to keep the X badge fully opaque.
                isHidden && cell.column.id !== "select" && "opacity-60",
              )}
            >
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
