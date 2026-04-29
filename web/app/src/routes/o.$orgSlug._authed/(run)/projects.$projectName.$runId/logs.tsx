import TerminalLogs from "@/components/core/runs/terminal-logs";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { RunNotFound } from "@/components/layout/run/not-found";
import { RefreshButton } from "@/components/core/refresh-button";

import { useRefreshTime } from "./~hooks/use-refresh-time";
import { prefetchGetRun, useGetRun } from "./~queries/get-run";
import { prefetchGetLogs, useGetLogs } from "./~queries/get-logs";
import { Layout } from "./~components/layout";

type Log = inferOutput<typeof trpc.runs.data.logs>[0];

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/logs",
)({
  component: RouteComponent,
  errorComponent: RunNotFound,
  beforeLoad: async ({ context, params }) => {
    const auth = context.auth;

    await Promise.all([
      prefetchGetRun(
        auth.activeOrganization.id,
        params.projectName,
        params.runId,
      ),
      prefetchGetLogs(
        auth.activeOrganization.id,
        params.projectName,
        params.runId,
      ),
    ]);

    return {
      organizationId: auth.activeOrganization.id,
      projectName: params.projectName,
      runId: params.runId,
    };
  },
});

// mlop_logs.logType comes from the SDK and historically contained five
// values: info / debug / print (stdout-ish) and error / warning (stderr-ish).
// The previous filter only accepted exact "INFO" / "ERROR" matches, so any
// debug, print, or warning lines were silently invisible — which was the
// "logs cut off early" half of Pylon #708. We now group by stream and
// normalize to upper-case before comparing, since some seed paths write
// upper-case and some write lower-case.
const STDOUT_LOG_TYPES = new Set(["INFO", "DEBUG", "PRINT"]);
const STDERR_LOG_TYPES = new Set(["ERROR", "WARNING"]);
type LogStream = "stdout" | "stderr";

function RouteComponent() {
  const { organizationId, projectName, runId } = Route.useRouteContext();
  const [stream, setStream] = useState<LogStream>("stdout");

  const { data: currentRun } = useGetRun(organizationId, projectName, runId);

  const refreshAllData = async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.runs.data.logs.queryKey(),
      refetchType: "all",
    });
  };

  const { lastRefreshTime, handleRefresh } = useRefreshTime({
    runId,
    onRefresh: refreshAllData,
    defaultAutoRefresh: currentRun?.status === "RUNNING",
    refreshInterval: 5000,
  });

  const { data: logs, isLoading } = useGetLogs(
    organizationId,
    projectName,
    runId,
  );

  const processLogs = (logs: Log[], stream: LogStream) => {
    const allowed = stream === "stdout" ? STDOUT_LOG_TYPES : STDERR_LOG_TYPES;
    return logs
      .filter((log) => allowed.has((log.logType ?? "").toUpperCase()))
      .map((log) => ({
        text: log.message,
        timestamp: log.time,
      }));
  };

  return (
    <Layout
      run={currentRun}
      projectName={projectName}
      runId={runId}
      title="Logs"
      organizationId={organizationId}
      // Bypass PageBody's Radix ScrollArea — TerminalLogs has its own
      // virtualized scroll container, and the outer ScrollArea was
      // intercepting wheel events before they could reach it. (Pylon #708)
      disableScroll
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Logs</h1>
          <RefreshButton
            lastRefreshed={lastRefreshTime || undefined}
            onRefresh={handleRefresh}
            defaultInterval={currentRun?.status === "RUNNING" ? 10_000 : null}
            storageKey={`refresh-interval:logs:${runId}`}
          />
        </div>
        {isLoading ? (
          <Skeleton className="h-[calc(100vh-12rem)] w-full" />
        ) : logs ? (
          <TerminalLogs
            logs={processLogs(logs, stream)}
            stream={stream}
            onStreamChange={setStream}
          />
        ) : (
          <p>No logs found</p>
        )}
      </div>
    </Layout>
  );
}
