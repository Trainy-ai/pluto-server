import React, { useState, useCallback } from "react";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { getColumnTableId } from "../lib/pinned-columns";

/** Hook for drag-and-drop column reordering (native HTML drag events). */
export function useColumnDrag(
  customColumns: ColumnConfig[],
  onReorder?: (fromIndex: number, toIndex: number) => void,
) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const getCustomIndex = useCallback(
    (columnId: string) => {
      return customColumns.findIndex(
        (col) => getColumnTableId(col) === columnId,
      );
    },
    [customColumns],
  );

  const handleDragStart = useCallback(
    (columnId: string, e: React.DragEvent) => {
      setDraggedId(columnId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", columnId);
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (columnId: string, e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverId(columnId);
    },
    [],
  );

  const handleDrop = useCallback(
    (columnId: string, e: React.DragEvent) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain");
      if (fromId && fromId !== columnId && onReorder) {
        const fromIndex = getCustomIndex(fromId);
        const toIndex = getCustomIndex(columnId);
        if (fromIndex !== -1 && toIndex !== -1) {
          onReorder(fromIndex, toIndex);
        }
      }
      setDraggedId(null);
      setDragOverId(null);
    },
    [onReorder, getCustomIndex],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "";
    }
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  return { draggedId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd };
}
