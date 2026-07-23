import { createContext, useContext } from "react";

/**
 * WYSIWYG edit mode for the default Charts (All Metrics) view.
 *
 * While the layout editor is active, MetricsDisplay provides this context and
 * every DropdownRegion section consumes it to grow drag/hide chrome in place:
 * section headers become draggable (reorder sections) with an eye toggle
 * (hide/show), and each chart card gets a hover drag handle to reorder charts
 * within its section. All mutations land in a draft that is only persisted
 * when the user saves.
 *
 * Sections are addressed by DropdownRegion's `groupId`; charts by their
 * absolute index into the section's rendered metric list. The provider owns
 * the groupId → group-key mapping and the index → metric-name resolution so
 * DropdownRegion stays ignorant of layout-overlay internals.
 */
export interface ChartsLayoutEditApi {
  /** Stable overlay key for a section (used in data attributes / tests). */
  getSectionKey(groupId: string): string | undefined;
  isSectionHidden(groupId: string): boolean;
  toggleSectionHidden(groupId: string): void;

  /** groupId of the section being dragged, null when none. */
  draggedSectionId: string | null;
  startSectionDrag(groupId: string): void;
  endSectionDrag(): void;
  /**
   * Live-preview move while dragging over a target section: the dragged
   * section reflows before/after it immediately (dashboard-editor style), so
   * the drop position is always visible. Converges to a no-op once in place.
   */
  moveSectionOver(targetGroupId: string, position: "before" | "after"): void;

  /** Metric (chart) name at an absolute index of a section's rendered list. */
  getItemName(groupId: string, index: number): string | undefined;
  /** The chart being dragged, null when none. */
  draggedItem: { groupId: string; name: string } | null;
  startItemDrag(groupId: string, index: number): void;
  endItemDrag(): void;
  /**
   * Live-preview move while dragging over a sibling chart: the dragged chart
   * reflows before/after it immediately. Converges to a no-op once in place.
   */
  moveItemOver(
    groupId: string,
    targetIndex: number,
    position: "before" | "after",
  ): void;
}

const ChartsLayoutEditContext = createContext<ChartsLayoutEditApi | null>(null);

export const ChartsLayoutEditProvider = ChartsLayoutEditContext.Provider;

/** Non-null only while the Charts view's layout edit mode is active. */
export function useChartsLayoutEdit(): ChartsLayoutEditApi | null {
  return useContext(ChartsLayoutEditContext);
}
