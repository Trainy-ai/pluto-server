import { useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { CopilotPanel } from "./copilot-panel";
import {
  COPILOT_MAX_WIDTH,
  COPILOT_MIN_WIDTH,
  useCopilotActions,
  useCopilotState,
} from "./copilot-provider";

/**
 * At and above this width the copilot docks beside the page and takes width
 * from it; below it the copilot overlays the page instead, because docking
 * would squeeze the charts past usefulness.
 */
export const COPILOT_DOCK_MIN_PX = 1280;

export function useIsCopilotDocked(): boolean {
  return useMediaQuery(`(min-width: ${COPILOT_DOCK_MIN_PX}px)`, { ssr: false });
}

/** The full-page chat already is a chat; a second one beside it is noise. */
export function useIsCopilotSuppressed(): boolean {
  return useRouterState({
    select: (s) => /^\/o\/[^/]+\/chat\/?$/.test(s.location.pathname),
  });
}

/**
 * Rendered by each page layout as a sibling of `SidebarInset`, so when docked
 * it is a flex column that the page shrinks to make room for — the same way
 * the left sidebar works — rather than a layer on top of the charts.
 */
export function CopilotDock() {
  const state = useCopilotState();
  const actions = useCopilotActions();
  const isDocked = useIsCopilotDocked();
  const isSuppressed = useIsCopilotSuppressed();
  // Width while dragging. Only a guide line moves during the drag; the page
  // (and every chart on it) reflows once, on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Ends an in-flight drag without saving. A drag can outlive the docked
  // panel (closed, undocked or suppressed mid-gesture), and its window
  // listeners must not.
  const cancelDrag = useRef<(() => void) | null>(null);
  const isShownDocked = Boolean(state?.isOpen) && isDocked && !isSuppressed;
  useEffect(() => {
    if (!isShownDocked) cancelDrag.current?.();
  }, [isShownDocked]);
  useEffect(() => () => cancelDrag.current?.(), []);

  if (!state || !actions || !state.isOpen || isSuppressed) return null;

  if (!isDocked) {
    // data-tooltip-keep-pinned: reading a pinned chart tooltip and clicking
    // in here to ask about it must not dismiss the tooltip.
    return (
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[min(420px,100vw)] flex-col border-l bg-background shadow-2xl"
        data-testid="copilot-panel"
        data-tooltip-keep-pinned=""
        data-docked="false"
        aria-label="Copilot"
      >
        <CopilotPanel />
      </aside>
    );
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state!.width;
    const clamp = (w: number) =>
      Math.min(COPILOT_MAX_WIDTH, Math.max(COPILOT_MIN_WIDTH, w));
    let latest = startWidth;
    const onMove = (e: PointerEvent) => {
      latest = clamp(startWidth + (startX - e.clientX));
      setDragWidth(latest);
    };
    const finish = (save: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      cancelDrag.current = null;
      setDragWidth(null);
      // Only a completed gesture changes the saved width.
      if (save) actions!.setWidth(latest);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    cancelDrag.current?.();
    cancelDrag.current = onCancel;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  }

  return (
    <aside
      className="sticky top-0 flex h-svh shrink-0 flex-col border-l bg-background"
      style={{ width: state.width }}
      data-testid="copilot-panel"
      data-tooltip-keep-pinned=""
      data-docked="true"
      aria-label="Copilot"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize copilot"
        onPointerDown={startResize}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/20"
        data-testid="copilot-resize-handle"
      />
      {dragWidth !== null && (
        <div
          className="pointer-events-none fixed inset-y-0 z-50 w-0.5 bg-primary"
          style={{ right: dragWidth }}
        />
      )}
      <CopilotPanel />
    </aside>
  );
}
