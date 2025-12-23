import { Card, CardTitle, CardHeader, CardContent } from "@/components/ui/card";
import { createFileRoute } from "@tanstack/react-router";
import { RunNotFound } from "@/components/layout/run/not-found";
import { JsonViewer } from "@/components/ui/json-tree-viewer";
import {
  ChevronDown,
  Bug,
  Settings,
  Info,
  Clock,
  GitBranch,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Loader from "@/components/loader";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import { prefetchGetRun, useGetRun } from "../~queries/get-run";
import { prefetchGetTrigger, useGetTrigger } from "../~queries/get-trigger";
import { Layout } from "../~components/layout";
import { z } from "zod";
import { Requirements } from "./~components/requirements";
import { GpuDisplay } from "./~components/gpu-display";
import { Spinner } from "@/components/ui/spinner";
import { stripSystemMetadata } from "./~utils/strip-system-metadat";
import { GitStatus } from "./~components/git-status";
import { Process } from "./~components/process";
import { SystemDisplay } from "./~components/system-display";
import { useDuration } from "@/lib/hooks/use-duration";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/summary/",
)({
  errorComponent: RunNotFound,
  beforeLoad: async ({ context, params }) => {
    const auth = context.auth;

    await Promise.all([
      prefetchGetRun(
        auth.activeOrganization.id,
        params.projectName,
        params.runId,
      ),
      prefetchGetTrigger(
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
  component: RouteComponent,
});

function RouteComponent() {
  const { projectName, runId, organizationId } = Route.useRouteContext();

  const { data: currentRun, isLoading } = useGetRun(
    organizationId,
    projectName,
    runId,
  );

  const { data: currentTriggers } = useGetTrigger(
    organizationId,
    projectName,
    runId,
  );

  const { formattedDuration } = useDuration({
    startTime: currentRun?.createdAt ?? new Date(),
    endTime: currentRun?.updatedAt,
    runStatus: currentRun?.status ?? "RUNNING",
  });

  if (isLoading || !currentRun) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader />
      </div>
    );
  }

  return (
    <Layout
      run={currentRun}
      projectName={projectName}
      runId={runId}
      title="Summary"
      organizationId={organizationId}
    >
      <div className="flex flex-col gap-6 p-6">
        {/* Run Information Card */}
        <Card className="overflow-hidden border-t-4 border-t-primary shadow-md dark:shadow-primary/10">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-2xl font-bold">
                  Run Information
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Overview of the current run status and details
                </p>
              </div>
              <RunStatusBadge run={currentRun} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Run Name
                </p>
                <p className="text-lg font-semibold">{currentRun.name}</p>
              </div>
              <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Run ID
                </p>
                <p className="font-mono text-lg font-semibold">{runId}</p>
              </div>
              <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Project
                </p>
                <p className="text-lg font-semibold">{projectName}</p>
              </div>
              <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Created At
                </p>
                <p className="text-lg font-semibold">
                  {new Date(currentRun.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Last Updated
                </p>
                <p className="text-lg font-semibold">
                  {new Date(currentRun.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">
                    Duration
                  </p>
                </div>
                <p className="text-lg font-semibold">{formattedDuration}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Section */}
        {currentRun.config && (
          <Card className="overflow-hidden border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-blue-500" />
                <div className="space-y-1">
                  <CardTitle className="text-xl">Configuration</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Run configuration and parameters
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-muted/50 p-4">
                <JsonViewer data={currentRun.config} rootName="" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* System Information Section */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SystemDisplay systemMetadata={currentRun.systemMetadata} />
          <GpuDisplay systemMetadata={currentRun.systemMetadata} />
        </div>

        {/* Git and Process Information */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <GitStatus systemMetadata={currentRun.systemMetadata} />
          <Process systemMetadata={currentRun.systemMetadata} />
        </div>

        {/* Requirements Section */}
        <Requirements systemMetadata={currentRun.systemMetadata} />

        {/* System Metadata Section */}
        {currentRun.systemMetadata && (
          <Card className="overflow-hidden border-l-4 border-l-purple-500">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-purple-500" />
                <div className="space-y-1">
                  <CardTitle className="text-xl">System Metadata</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Detailed system-level information
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-muted/50 p-4">
                <JsonViewer
                  data={stripSystemMetadata(currentRun.systemMetadata)}
                  rootName=""
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Logger Settings Section */}
        {currentRun.loggerSettings && (
          <Card className="overflow-hidden border-l-4 border-l-amber-500">
            <CardHeader className="pb-2">
              <Collapsible>
                <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Bug className="h-5 w-5 text-amber-500" />
                    <div className="space-y-1">
                      <CardTitle className="text-xl">Logger Settings</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Debug and logging configuration
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      Debug
                    </span>
                  </div>
                  <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <div className="rounded-lg bg-muted/50 p-4">
                    <JsonViewer data={currentRun.loggerSettings} rootName="" />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardHeader>
          </Card>
        )}

        {/* Triggers Section */}
        <Card className="overflow-hidden border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-green-500" />
                <div className="space-y-1">
                  <CardTitle className="text-xl">Triggers</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Events that initiated this run
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {currentTriggers && currentTriggers.length > 0 ? (
              <div className="space-y-4">
                {currentTriggers.map((trigger, index) => (
                  <div
                    key={index}
                    className="rounded-lg border bg-muted/50 p-4 transition-colors hover:bg-muted/70"
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">
                          Type: {trigger.triggerType}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Created:{" "}
                          {new Date(trigger.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <RunStatusBadge run={currentRun} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                No triggers found for this run
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
