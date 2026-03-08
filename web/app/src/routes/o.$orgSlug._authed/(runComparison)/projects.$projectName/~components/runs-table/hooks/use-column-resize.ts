import React, { useState, useRef, useCallback } from "react";

const MIN_COL_WIDTH = 50;

/**
 * Custom column resize hook — uses refs + direct DOM manipulation during drag
 * to avoid React re-renders entirely. This prevents the "Maximum update depth
 * exceeded" error caused by TanStack Table's internal state machine reacting
 * to state changes during resize. Only triggers one React re-render on mouseup.
 */
export function useColumnResize() {
  const columnWidthsRef = useRef<Record<string, number>>({});
  const [resizeGeneration, setRenderTrigger] = useState(0);

  const getWidth = useCallback(
    (columnId: string, defaultWidth: number) =>
      columnWidthsRef.current[columnId] ?? defaultWidth,
    [],
  );

  const handleMouseDown = useCallback(
    (columnId: string, currentWidth: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = currentWidth;
      const handle = e.target as HTMLElement;

      handle.classList.add("bg-primary", "shadow-sm");

      const outerBorder = handle.closest(".rounded-md.border");
      const tableEls = outerBorder
        ? Array.from(outerBorder.querySelectorAll("table"))
        : [];

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const diff = moveEvent.clientX - startX;
        const newWidth = Math.max(MIN_COL_WIDTH, startWidth + diff);
        columnWidthsRef.current[columnId] = newWidth;

        for (const tableEl of tableEls) {
          const colEl = tableEl.querySelector(
            `col[data-col-id="${CSS.escape(columnId)}"]`,
          );
          if (colEl) {
            (colEl as HTMLElement).style.width = `${newWidth}px`;
          }

          const allCols = tableEl.querySelectorAll("col");
          let total = 0;
          allCols.forEach((col) => {
            const w = (col as HTMLElement).style.width;
            total += w ? parseInt(w, 10) || 150 : 150;
          });
          tableEl.style.width = `${total}px`;
        }
      };

      const handleMouseUp = () => {
        handle.classList.remove("bg-primary", "shadow-sm");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setRenderTrigger((n) => n + 1);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  return { getWidth, handleMouseDown, resizeGeneration };
}

export { MIN_COL_WIDTH };
