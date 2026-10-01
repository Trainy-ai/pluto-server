import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle, PanelSize } from "react-resizable-panels";

/** Which of the runs-list / graphs panels are visible. */
export type PanelLayout = "both" | "list-only" | "graphs-only";

/**
 * Visibility of the runs-list and graphs panels on the project page: the
 * imperative panel refs, the toolbar toggles, the `[` / `]` shortcuts, and
 * the resize handlers that keep `panelLayout` in sync when the user drags a
 * panel shut.
 */
export function usePanelLayout() {
  const [panelLayout, setPanelLayout] = useState<PanelLayout>("both");
  const listPanelRef = useRef<PanelImperativeHandle | null>(null);
  const graphsPanelRef = useRef<PanelImperativeHandle | null>(null);

  const toggleListPanel = useCallback(() => {
    setPanelLayout((prev) => {
      if (prev === "graphs-only") {
        // List is hidden — expand it to show both
        listPanelRef.current?.expand();
        return "both";
      }
      if (prev === "list-only") {
        // List is the only visible panel — expand graphs to show both
        graphsPanelRef.current?.expand();
        return "both";
      }
      // Both visible — collapse list
      listPanelRef.current?.collapse();
      return "graphs-only";
    });
  }, []);

  const toggleGraphsPanel = useCallback(() => {
    setPanelLayout((prev) => {
      if (prev === "list-only") {
        // Graphs hidden — expand to show both
        graphsPanelRef.current?.expand();
        return "both";
      }
      if (prev === "graphs-only") {
        // Graphs is the only visible panel — expand list to show both
        listPanelRef.current?.expand();
        return "both";
      }
      // Both visible — collapse graphs
      graphsPanelRef.current?.collapse();
      return "list-only";
    });
  }, []);

  // Keyboard shortcuts for panel toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        toggleListPanel();
      } else if (e.key === "]") {
        e.preventDefault();
        toggleGraphsPanel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleListPanel, toggleGraphsPanel]);

  const onListPanelResize = useCallback((size: PanelSize) => {
    if (size.asPercentage === 0) {
      setPanelLayout("graphs-only");
    } else {
      setPanelLayout((prev) => prev === "graphs-only" ? "both" : prev);
    }
  }, []);

  const onGraphsPanelResize = useCallback((size: PanelSize) => {
    if (size.asPercentage === 0) {
      setPanelLayout("list-only");
    } else {
      setPanelLayout((prev) => prev === "list-only" ? "both" : prev);
    }
  }, []);

  return {
    panelLayout,
    listPanelRef,
    graphsPanelRef,
    toggleListPanel,
    toggleGraphsPanel,
    onListPanelResize,
    onGraphsPanelResize,
  };
}
