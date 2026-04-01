import { useState, useCallback } from "react";

export type DropPosition = "above" | "below" | "inside";

interface SectionDragState {
  draggedId: string | null;
  draggedParentId: string | undefined;
  dragOverId: string | null;
  dropPosition: DropPosition | null;
}

interface UseSectionDragOptions {
  onReorder: (fromIndex: number, toIndex: number) => void;
  sectionIds: string[];
  /** Called when a section is dropped onto a folder's "inside" zone */
  onMoveIntoFolder?: (sectionId: string, fromParentId: string | undefined, folderId: string) => void;
  /** Called when a child section is dropped at the top level, near a specific target */
  onMoveOutOfFolder?: (sectionId: string, fromParentId: string, targetSectionId: string, position: "above" | "below") => void;
  /**
   * Called when a section is dropped above/below a child section inside a folder.
   * The handler should move the source into that folder at the correct position.
   * targetChildId is the child section it was dropped relative to.
   * position is "above" or "below" that child.
   * targetParentId is the folder containing the target child.
   */
  onDropNearChild?: (
    sectionId: string,
    fromParentId: string | undefined,
    targetParentId: string,
    targetChildId: string,
    position: "above" | "below",
  ) => void;
  /** Called to reorder children within the same folder */
  onReorderChildren?: (
    parentId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  /** IDs of sections that are folders */
  folderIds?: string[];
  /** Map from child section ID → parent folder ID */
  childToParentMap?: Record<string, string>;
  /** Map from parent folder ID → ordered child IDs */
  folderChildIds?: Record<string, string[]>;
}

/** Fixed pixel threshold for above/below zones on expanded folders. */
const FOLDER_EDGE_PX = 40;
/** Percentage threshold for above/below zones on collapsed folders. */
const FOLDER_COLLAPSED_EDGE_RATIO = 0.25;

/**
 * For folders: 3-zone drop.
 *   - Collapsed: 25%/50%/25% ratio zones.
 *   - Expanded: fixed 40px edge zones, everything else = inside.
 * For regular sections: 2-zone — top half = above, bottom half = below.
 */
function getDropPosition(e: React.DragEvent, isFolder: boolean): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect();

  if (isFolder) {
    const height = rect.height;
    const offsetFromTop = e.clientY - rect.top;
    const offsetFromBottom = rect.bottom - e.clientY;

    if (height < FOLDER_EDGE_PX * 3) {
      const ratio = offsetFromTop / height;
      if (ratio < FOLDER_COLLAPSED_EDGE_RATIO) return "above";
      if (ratio > 1 - FOLDER_COLLAPSED_EDGE_RATIO) return "below";
      return "inside";
    }

    if (offsetFromTop < FOLDER_EDGE_PX) return "above";
    if (offsetFromBottom < FOLDER_EDGE_PX) return "below";
    return "inside";
  }

  const midY = rect.top + rect.height / 2;
  return e.clientY < midY ? "above" : "below";
}

function encodeDragData(sectionId: string, parentId?: string, isFolder?: boolean): string {
  return JSON.stringify({ sectionId, parentId, isFolder: !!isFolder });
}

function decodeDragData(data: string): { sectionId: string; parentId?: string; isFolder: boolean } {
  try {
    const parsed = JSON.parse(data);
    return { sectionId: parsed.sectionId, parentId: parsed.parentId || undefined, isFolder: !!parsed.isFolder };
  } catch {
    return { sectionId: data, parentId: undefined, isFolder: false };
  }
}

export function useSectionDrag({
  onReorder,
  sectionIds,
  onMoveIntoFolder,
  onMoveOutOfFolder,
  onDropNearChild,
  onReorderChildren,
  folderIds = [],
  childToParentMap = {},
  folderChildIds = {},
}: UseSectionDragOptions) {
  const [dragState, setDragState] = useState<SectionDragState>({
    draggedId: null,
    draggedParentId: undefined,
    dragOverId: null,
    dropPosition: null,
  });

  const resetState = useCallback(() =>
    setDragState({ draggedId: null, draggedParentId: undefined, dragOverId: null, dropPosition: null }),
  []);

  const handleDragStart = useCallback(
    (sectionId: string, e: React.DragEvent, parentId?: string) => {
      e.stopPropagation();
      const isSourceFolder = folderIds.includes(sectionId);
      setDragState({ draggedId: sectionId, draggedParentId: parentId, dragOverId: null, dropPosition: null });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", encodeDragData(sectionId, parentId, isSourceFolder));
    },
    [folderIds]
  );

  const handleDragOver = useCallback(
    (sectionId: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      const isTargetFolder = folderIds.includes(sectionId);
      const position = getDropPosition(e, isTargetFolder);

      setDragState((prev) => {
        if (prev.dragOverId === sectionId && prev.dropPosition === position) {
          return prev;
        }
        return { ...prev, dragOverId: sectionId, dropPosition: position };
      });
    },
    [folderIds]
  );

  const handleDrop = useCallback(
    (sectionId: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rawData = e.dataTransfer.getData("text/plain");
      if (!rawData) { resetState(); return; }

      const { sectionId: fromId, parentId: fromParentId, isFolder: isSourceFolder } = decodeDragData(rawData);

      // Dropped on itself — no-op
      if (fromId === sectionId) { resetState(); return; }

      const isTargetTopLevel = sectionIds.includes(sectionId);
      const isTargetFolder = folderIds.includes(sectionId);
      const targetParentId = childToParentMap[sectionId]; // undefined if target is top-level

      // --- Target is a folder ---
      if (isTargetFolder) {
        const position = getDropPosition(e, true);

        if (position === "inside" && !isSourceFolder) {
          // Move into folder (non-folders only)
          if (fromParentId === sectionId) { resetState(); return; } // already in this folder
          onMoveIntoFolder?.(fromId, fromParentId, sectionId);
          resetState();
          return;
        }

        // "above" or "below" on a folder = reorder at top level
        if (isTargetTopLevel) {
          // If source is a child, move it out and place relative to this folder
          if (fromParentId && onMoveOutOfFolder) {
            onMoveOutOfFolder(fromId, fromParentId, sectionId, position as "above" | "below");
            resetState();
            return;
          }
          // Normal top-level reorder
          reorderTopLevel(fromId, sectionId, position as "above" | "below");
          resetState();
          return;
        }
      }

      // --- Target is a child section inside a folder ---
      if (targetParentId) {
        const position = getDropPosition(e, false) as "above" | "below";

        // Source is in the SAME folder → reorder within folder
        if (fromParentId === targetParentId && onReorderChildren) {
          const childIds = folderChildIds[targetParentId] ?? [];
          const fromIndex = childIds.indexOf(fromId);
          const toIndex = childIds.indexOf(sectionId);
          if (fromIndex !== -1 && toIndex !== -1) {
            let adjustedTo = position === "below" ? toIndex + 1 : toIndex;
            if (fromIndex < adjustedTo) adjustedTo -= 1;
            if (fromIndex !== adjustedTo) onReorderChildren(targetParentId, fromIndex, adjustedTo);
          }
          resetState();
          return;
        }

        // Source is from a DIFFERENT location → move into this folder near this child
        if (onDropNearChild && !isSourceFolder) {
          onDropNearChild(fromId, fromParentId, targetParentId, sectionId, position);
          resetState();
          return;
        }
      }

      // --- Target is a regular top-level section ---
      if (isTargetTopLevel) {
        const position = getDropPosition(e, false) as "above" | "below";

        // If source is a child, move it out of folder and place relative to target
        if (fromParentId && onMoveOutOfFolder) {
          onMoveOutOfFolder(fromId, fromParentId, sectionId, position);
          resetState();
          return;
        }

        // Normal top-level reorder
        reorderTopLevel(fromId, sectionId, position);
        resetState();
        return;
      }

      // Fallback — no-op
      resetState();
    },
    [sectionIds, onReorder, onMoveIntoFolder, onMoveOutOfFolder, onDropNearChild, onReorderChildren, folderIds, childToParentMap, folderChildIds, resetState]
  );

  /** Reorder two top-level sections based on drop position. */
  function reorderTopLevel(fromId: string, targetId: string, position: "above" | "below") {
    const fromIndex = sectionIds.indexOf(fromId);
    const toIndex = sectionIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    let adjustedTo = position === "below" ? toIndex + 1 : toIndex;
    if (fromIndex < adjustedTo) adjustedTo -= 1;
    if (fromIndex !== adjustedTo) onReorder(fromIndex, adjustedTo);
  }

  const handleDragEnd = useCallback(() => {
    resetState();
  }, [resetState]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
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
