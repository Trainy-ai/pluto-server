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

function RouteComponent() {
  const { organizationId, projectName, runId } = Route.useRouteContext();
  const [logType, setLogType] = useState<"INFO" | "ERROR">("INFO");

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

  const processLogs = (logs: Log[], type: "INFO" | "ERROR") => {
    return logs
      .filter((log) => log.logType === type)
      .map((log) => ({
        text: log.message,
        timestamp: log.time,
        severity: log.logType.toLowerCase() as "info" | "error",
      }));
  };

  return (
    <Layout
      run={currentRun}
      projectName={projectName}
      runId={runId}
      title="Logs"
      organizationId={organizationId}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Logs</h1>
          <RefreshButton
            lastRefreshed={lastRefreshTime || undefined}
            onRefresh={handleRefresh}
            refreshInterval={10_000}
            defaultAutoRefresh={currentRun?.status === "RUNNING"}
          />
        </div>
        {isLoading ? (
          <Skeleton className="h-[calc(100vh-12rem)] w-full" />
        ) : logs ? (
          <TerminalLogs
            logs={processLogs(logs, logType)}
            logType={logType}
            onLogTypeChange={setLogType}
          />
        ) : (
          <p>No logs found</p>
        )}
      </div>
    </Layout>
  );
}
