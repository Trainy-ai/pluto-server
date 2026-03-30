import { useState, useMemo, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { RunNotFound } from "@/components/layout/run/not-found";
import { RefreshButton } from "@/components/core/refresh-button";
import { File, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { queryClient, trpc } from "@/utils/trpc";

import { useRefreshTime } from "./~hooks/use-refresh-time";
import { useStepNavigation } from "./~hooks/use-step-navigation";
import { prefetchGetRun, useGetRun } from "./~queries/get-run";
import { prefetchGetFileTree, useGetFileTree } from "./~queries/get-file-tree";
import {
  prefetchGetMetricValues,
  useGetMetricValues,
} from "./~queries/get-metric-values";
import { Layout } from "./~components/layout";
import { FileTree, type FileEntry, type MetricEntry } from "./~components/files/file-tree";
import { FilePreview } from "./~components/files/file-preview";
import { StepNavigator } from "./~components/shared/step-navigator";
import { LineChartWithFetch } from "./~components/group/line-chart";
import { useLineSettings } from "./~components/use-line-settings";
import { SmoothingSlider } from "@/components/charts/smoothing-slider";
import { ChartSyncProvider } from "@/components/charts/context/chart-sync-context";
import LineSettings from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/line-settings";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/files",
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
      prefetchGetFileTree(
        auth.activeOrganization.id,
        params.projectName,
        params.runId,
      ),
      prefetchGetMetricValues(
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
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [selectedLogFiles, setSelectedLogFiles] = useState<FileEntry[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(288); // w-72 = 288px
  const isResizingRef = useRef(false);

  const stepNav = useStepNavigation(selectedLogFiles);

  // When step changes, update selectedFile to the file at that step
  const currentFile = useMemo(() => {
    if (selectedLogFiles.length <= 1) return selectedFile;
    return selectedLogFiles.find((f) => f.step === stepNav.currentStepValue) ?? selectedFile;
  }, [selectedLogFiles, stepNav.currentStepValue, selectedFile]);

  const handleSelectFile = useCallback((file: FileEntry, allFiles?: FileEntry[]) => {
    setSelectedFile(file);
    setSelectedLogFiles(allFiles ?? [file]);
    setSelectedMetric(null);
  }, []);

  const handleMetricClick = useCallback((metric: MetricEntry) => {
    setSelectedMetric(metric);
    setSelectedFile(null);
    setSelectedLogFiles([]);
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, 180), 600);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  const {
    settings,
    updateSettings,
    updateSmoothingSettings,
    getSmoothingConfig,
  } = useLineSettings(organizationId, projectName, runId);

  const { data: currentRun } = useGetRun(organizationId, projectName, runId);

  const refreshAllData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.runs.data.fileTree.queryKey({
          organizationId,
          projectName,
          runId,
        }),
        refetchType: "all",
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.runs.data.metricValues.queryKey({
          organizationId,
          projectName,
          runId,
        }),
        refetchType: "all",
      }),
    ]);
  };

  const { lastRefreshTime, handleRefresh } = useRefreshTime({
    runId,
    onRefresh: refreshAllData,
    defaultAutoRefresh: currentRun?.status === "RUNNING",
    refreshInterval: 10000,
  });

  const { data: files, isLoading: isLoadingFiles } = useGetFileTree(
    organizationId,
    projectName,
    runId,
  );

  const { data: metricValues, isLoading: isLoadingMetrics } =
    useGetMetricValues(organizationId, projectName, runId);

  const isLoading = isLoadingFiles || isLoadingMetrics;
  const hasContent =
    (files && files.length > 0) ||
    (metricValues && metricValues.length > 0);

  const filteredFiles = useMemo(() => {
    if (!files) return [];
    if (!searchQuery) return files;
    const query = searchQuery.toLowerCase();
    return files.filter(
      (f) =>
        f.fileName.toLowerCase().includes(query) ||
        f.logName.toLowerCase().includes(query),
    );
  }, [files, searchQuery]);

  const filteredMetrics = useMemo(() => {
    if (!metricValues) return [];
    if (!searchQuery) return metricValues;
    const query = searchQuery.toLowerCase();
    return metricValues.filter((m) =>
      m.logName.toLowerCase().includes(query),
    );
  }, [metricValues, searchQuery]);

  return (
    <Layout
      run={currentRun}
      projectName={projectName}
      runId={runId}
      title="Files"
      organizationId={organizationId}
    >
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-2xl font-bold">Files</h1>
          <RefreshButton
            lastRefreshed={lastRefreshTime || undefined}
            onRefresh={handleRefresh}
            defaultInterval={currentRun?.status === "RUNNING" ? 10_000 : null}
            storageKey={`refresh-interval:files:${runId}`}
          />
        </div>

        {isLoading ? (
          <div className="flex flex-1 gap-4 p-4">
            <div className="w-72 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-3/4" />
            </div>
            <Skeleton className="flex-1" />
          </div>
        ) : !hasContent ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <File className="h-12 w-12" />
            <p className="text-lg font-medium">No files found</p>
            <p className="text-sm">
              Files, images, and artifacts logged during the run will appear here.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Sidebar: File Tree */}
            <div
              className="relative flex shrink-0 flex-col border-r"
              style={{ width: sidebarWidth }}
            >
              <div className="border-b p-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search files & metrics..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <FileTree
                  files={filteredFiles}
                  metrics={filteredMetrics}
                  selectedFile={currentFile}
                  selectedMetric={selectedMetric}
                  onSelectFile={handleSelectFile}
                  onMetricClick={handleMetricClick}
                />
              </div>
              <div className="border-t px-3 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {files?.length ?? 0} file{(files?.length ?? 0) !== 1 ? "s" : ""}
                  {metricValues && metricValues.length > 0 && (
                    <> &middot; {metricValues.length} metric{metricValues.length !== 1 ? "s" : ""}</>
                  )}
                </span>
              </div>
              {/* Resize handle */}
              <div
                data-resize-handle="file-sidebar"
                onMouseDown={handleResizeStart}
                className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
              />
            </div>

            {/* Main: File/Metric Preview */}
            <ChartSyncProvider syncKey={`run-files-${runId}`}>
              <div className="flex min-w-0 flex-1 flex-col">
                {selectedMetric ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex items-center justify-between border-b px-4 py-2">
                      <h2 className="text-lg font-semibold">{selectedMetric.logName}</h2>
                      <div className="flex items-center gap-3">
                        <SmoothingSlider
                          settings={settings}
                          updateSmoothingSettings={updateSmoothingSettings}
                          updateSettings={updateSettings}
                          getSmoothingConfig={getSmoothingConfig}
                        />
                        <LineSettings
                          organizationId={organizationId}
                          projectName={projectName}
                          logNames={currentRun?.logs?.filter((l: { logType: string }) => l.logType === "METRIC").map((l: { logName: string }) => l.logName) ?? []}
                          settingsKey={runId}
                        />
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 p-4">
                      <LineChartWithFetch
                        logName={selectedMetric.logName}
                        tenantId={organizationId}
                        projectName={projectName}
                        runId={runId}
                        columns={1}
                      />
                    </div>
                  </div>
                ) : currentFile ? (
                <>
                  <div className="min-h-0 flex-1">
                    <FilePreview
                      file={currentFile}
                      organizationId={organizationId}
                      projectName={projectName}
                      runId={runId}
                    />
                  </div>
                  {stepNav.hasMultipleSteps() && (
                    <div className="border-t px-4 py-2">
                      <StepNavigator
                        currentStepIndex={stepNav.currentStepIndex}
                        currentStepValue={stepNav.currentStepValue}
                        availableSteps={stepNav.availableSteps}
                        onStepChange={stepNav.goToStepIndex}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                  <File className="h-10 w-10" />
                  <p className="text-sm">Select a file or metric to preview</p>
                </div>
              )}
              </div>
            </ChartSyncProvider>
          </div>
        )}
      </div>
    </Layout>
  );
}
