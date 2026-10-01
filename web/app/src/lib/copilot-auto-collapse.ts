/**
 * Below this viewport width a docked copilot leaves too little room for the
 * runs table and the chart grid together, so opening it hides the table.
 * At ~1920px and up all three columns fit comfortably.
 */
export const AUTO_HIDE_TABLE_BELOW_PX = 1920;

export interface AutoCollapseInput {
  wasOpen: boolean;
  isOpen: boolean;
  /** Docked copilot takes width from the page; an overlay does not. */
  isDocked: boolean;
  viewportWidth: number;
  listVisible: boolean;
  /** Whether the table is currently hidden because the copilot hid it. */
  autoCollapsed: boolean;
}

export interface AutoCollapseResult {
  action: "collapse" | "expand" | null;
  autoCollapsed: boolean;
}

/**
 * Decides whether the runs table should follow the copilot. The copilot only
 * ever undoes what it did: a table the user hid stays hidden on close, and
 * once the user re-shows the table while the copilot is open the copilot
 * stops owning it.
 */
export function nextAutoCollapse({
  wasOpen,
  isOpen,
  isDocked,
  viewportWidth,
  listVisible,
  autoCollapsed,
}: AutoCollapseInput): AutoCollapseResult {
  if (isOpen && !wasOpen) {
    if (isDocked && listVisible && viewportWidth < AUTO_HIDE_TABLE_BELOW_PX) {
      return { action: "collapse", autoCollapsed: true };
    }
    return { action: null, autoCollapsed: false };
  }
  if (!isOpen && wasOpen) {
    if (autoCollapsed && !listVisible) {
      return { action: "expand", autoCollapsed: false };
    }
    return { action: null, autoCollapsed: false };
  }
  if (isOpen && autoCollapsed && listVisible) {
    return { action: null, autoCollapsed: false };
  }
  return { action: null, autoCollapsed };
}
