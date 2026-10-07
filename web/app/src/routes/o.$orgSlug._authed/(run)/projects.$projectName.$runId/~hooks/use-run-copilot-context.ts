import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCopilotPageContext } from "@/components/copilot/copilot-provider";
import type {
  CopilotDashboardRef,
  CopilotPageContext,
} from "@/lib/copilot-page-context";

/** Run sub-route (last path segment) → the label the copilot reports. */
const TAB_LABELS: Record<string, string> = {
  logs: "Logs",
  files: "Files",
  graph: "Model graph",
  system: "System metadata",
  summary: "Summary",
};

interface RunCopilotRun {
  name: string;
  status: string;
  displayId: string | null;
}

interface RunCopilotView {
  /** Set when a saved dashboard is on screen instead of the charts tab. */
  dashboard?: CopilotDashboardRef;
  /** Panels the active tab renders. */
  visiblePanels?: string[];
}

/**
 * Publishes the run being viewed, which tab of it, and the panels on screen
 * to the copilot. Only the index route knows about dashboards and panels, so
 * the other tabs pass nothing and keep their tab label.
 */
export function useRunCopilotContext(
  projectName: string,
  runId: string,
  run: RunCopilotRun,
  view: RunCopilotView = {},
): void {
  const tab = useRouterState({
    select: (s) => s.location.pathname.split("/").filter(Boolean).pop() ?? "",
  });
  const { name, status, displayId } = run;
  const { dashboard, visiblePanels } = view;
  const ctx = useMemo<CopilotPageContext>(
    () => ({
      page: "run",
      projectName,
      // A dashboard on the index route would otherwise report "Charts":
      // the route's last segment is the run id, not the view.
      view: dashboard ? "Custom dashboard" : (TAB_LABELS[tab] ?? "Charts"),
      runs: [{ id: runId, name, status, displayId }],
      dashboard,
      visiblePanels,
    }),
    [
      projectName,
      runId,
      name,
      status,
      displayId,
      tab,
      dashboard,
      visiblePanels,
    ],
  );
  useCopilotPageContext(ctx);
}
