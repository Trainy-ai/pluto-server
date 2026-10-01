import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCopilotPageContext } from "@/components/copilot/copilot-provider";
import type { CopilotPageContext } from "@/lib/copilot-page-context";

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

/** Publishes the run being viewed, and which tab of it, to the copilot. */
export function useRunCopilotContext(
  projectName: string,
  runId: string,
  run: RunCopilotRun,
): void {
  const tab = useRouterState({
    select: (s) => s.location.pathname.split("/").filter(Boolean).pop() ?? "",
  });
  const { name, status, displayId } = run;
  const ctx = useMemo<CopilotPageContext>(
    () => ({
      page: "run",
      projectName,
      view: TAB_LABELS[tab] ?? "Charts",
      runs: [{ id: runId, name, status, displayId }],
    }),
    [projectName, runId, name, status, displayId, tab],
  );
  useCopilotPageContext(ctx);
}
