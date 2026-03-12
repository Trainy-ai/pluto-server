import { useState, useCallback } from "react";

type DropPosition = "above" | "below";

interface SectionDragState {
  draggedId: string | null;
  dragOverId: string | null;
  dropPosition: DropPosition | null;
}

interface UseSectionDragOptions {
  onReorder: (fromIndex: number, toIndex: number) => void;
  sectionIds: string[];
}

function getDropPosition(e: React.DragEvent): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  return e.clientY < midY ? "above" : "below";
}

export function useSectionDrag({ onReorder, sectionIds }: UseSectionDragOptions) {
  const [dragState, setDragState] = useState<SectionDragState>({
    draggedId: null,
    dragOverId: null,
    dropPosition: null,
  });

  const handleDragStart = useCallback(
    (sectionId: string, e: React.DragEvent) => {
      setDragState({ draggedId: sectionId, dragOverId: null, dropPosition: null });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sectionId);
    },
    []
  );

  const handleDragOver = useCallback(
    (sectionId: string, e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const position = getDropPosition(e);

      setDragState((prev) => {
        if (prev.dragOverId === sectionId && prev.dropPosition === position) {
          return prev;
        }
        return { ...prev, dragOverId: sectionId, dropPosition: position };
      });
    },
    []
  );

  const handleDrop = useCallback(
    (sectionId: string, e: React.DragEvent) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain");
      if (!fromId || fromId === sectionId) {
        setDragState({ draggedId: null, dragOverId: null, dropPosition: null });
        return;
      }

      const fromIndex = sectionIds.indexOf(fromId);
      let toIndex = sectionIds.indexOf(sectionId);

      if (fromIndex === -1 || toIndex === -1) {
        setDragState({ draggedId: null, dragOverId: null, dropPosition: null });
        return;
      }

      const dropBelow = getDropPosition(e) === "below";

      // Adjust target index: if dropping below the target, insert after it
      if (dropBelow && toIndex < sectionIds.length - 1) {
        toIndex += 1;
      }
      // Adjust for removal of source element
      if (fromIndex < toIndex) {
        toIndex -= 1;
      }

      if (fromIndex !== toIndex) {
        onReorder(fromIndex, toIndex);
      }

      setDragState({ draggedId: null, dragOverId: null, dropPosition: null });
    },
    [sectionIds, onReorder]
  );

  const handleDragEnd = useCallback(() => {
    setDragState({ draggedId: null, dragOverId: null, dropPosition: null });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the element entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragState((prev) => ({
        ...prev,
        dragOverId: null,
        dropPosition: null,
      }));
    }
  }, []);

  return {
    dragState,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    handleDragLeave,
  };
}
