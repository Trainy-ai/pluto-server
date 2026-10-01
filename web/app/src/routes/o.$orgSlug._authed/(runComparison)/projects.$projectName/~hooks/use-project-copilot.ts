import { useEffect, useMemo, useRef } from "react";
import { useIsCopilotDocked } from "@/components/copilot/copilot-dock";
import {
  useCopilotPageContext,
  useCopilotState,
} from "@/components/copilot/copilot-provider";
import { nextAutoCollapse } from "@/lib/copilot-auto-collapse";
import type {
  CopilotPageContext,
  CopilotRunRef,
} from "@/lib/copilot-page-context";
import type { Run } from "../~queries/list-runs";
import { getDisplayIdForRun } from "../~lib/metrics-utils";
import { SELECTED_RUNS_LIMIT } from "../~components/runs-table/config";
import type { PanelLayout } from "./use-panel-layout";

interface UseProjectCopilotOptions {
  projectName: string;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  /** Runs loaded in the table; offered by the copilot's run picker. */
  runs: Run[];
  viewLabel: string;
  onToggleRun: (runId: string, selected: boolean) => void;
  panelLayout: PanelLayout;
  toggleListPanel: () => void;
}

/**
 * Connects the project page to the copilot: publishes the selected runs and
 * active view as context, and hides the runs table while a docked copilot is
 * open on a screen too narrow for table, charts and copilot side by side.
 */
export function useProjectCopilot({
  projectName,
  selectedRunsWithColors,
  runs,
  viewLabel,
  onToggleRun,
  panelLayout,
  toggleListPanel,
}: UseProjectCopilotOptions) {
  const selected = useMemo(
    () =>
      Object.values(selectedRunsWithColors).map(({ run, color }) =>
        toRunRef(run, color),
      ),
    [selectedRunsWithColors],
  );
  const candidates = useMemo(() => runs.map((run) => toRunRef(run)), [runs]);

  const ctx = useMemo<CopilotPageContext>(
    () => ({
      page: "project",
      projectName,
      view: viewLabel,
      runs: selected,
      runPicker: {
        candidates,
        onToggle: onToggleRun,
        limit: SELECTED_RUNS_LIMIT,
      },
    }),
    [projectName, viewLabel, selected, candidates, onToggleRun],
  );
  useCopilotPageContext(ctx);

  const isOpen = useCopilotState()?.isOpen ?? false;
  const isDocked = useIsCopilotDocked();
  const wasOpen = useRef(false);
  const autoCollapsed = useRef(false);
  const listVisible = panelLayout !== "graphs-only";

  useEffect(() => {
    const result = nextAutoCollapse({
      wasOpen: wasOpen.current,
      isOpen,
      isDocked,
      viewportWidth: window.innerWidth,
      listVisible,
      autoCollapsed: autoCollapsed.current,
    });
    wasOpen.current = isOpen;
    autoCollapsed.current = result.autoCollapsed;
    // `[` semantics toggle whichever panel is hidden, so only collapse from
    // the both-visible layout — from list-only it would expand the graphs.
    if (
      result.action === "expand" ||
      (result.action === "collapse" && panelLayout === "both")
    ) {
      toggleListPanel();
    } else if (result.action === "collapse") {
      autoCollapsed.current = false;
    }
  }, [isOpen, isDocked, listVisible, panelLayout, toggleListPanel]);
}

function toRunRef(run: Run, color?: string): CopilotRunRef {
  return {
    id: run.id,
    name: run.name,
    displayId: getDisplayIdForRun(run),
    status: run.status,
    color,
  };
}
