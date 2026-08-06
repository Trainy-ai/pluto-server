import { useState, useMemo, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { RunNotFound } from "@/components/layout/run/not-found";
import { RefreshButton } from "@/components/core/refresh-button";
import { ChevronLeft, ChevronRight, File, Search } from "lucide-react";
import { excludeMaskFiles } from "@/hooks/use-mask-url";
import { Button } from "@/components/ui/button";
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

  // Which sample within the current step. List logging puts several files at
  // one step (wandb-style), and picking the first silently hid the rest — a
  // 3-frames-per-epoch run showed 3 of its 9 images with no sign the others
  // existed.
  const [sampleIdx, setSampleIdx] = useState(0);

  // Every file at the selected step, in the order they were logged. The server
  // orders by sampleIndex, so array position is sample position.
  const filesAtStep = useMemo(
    () => selectedLogFiles.filter((f) => f.step === stepNav.currentStepValue),
    [selectedLogFiles, stepNav.currentStepValue],
  );

  // Clamp rather than reset: stepping through epochs should keep you on the
  // same sample when the next step has one, which is how you compare a frame
  // across epochs.
  const safeSampleIdx = Math.min(sampleIdx, Math.max(0, filesAtStep.length - 1));

  const currentFile = useMemo(() => {
    if (selectedLogFiles.length <= 1) return selectedFile;
    return filesAtStep[safeSampleIdx] ?? filesAtStep[0] ?? selectedFile;
  }, [selectedLogFiles, filesAtStep, safeSampleIdx, selectedFile]);

  const handleSelectFile = useCallback((file: FileEntry, allFiles?: FileEntry[]) => {
    setSelectedFile(file);
    setSelectedLogFiles(allFiles ?? [file]);
    setSelectedMetric(null);
    // New log: start at sample 0. Clamp alone keeps a high index when the next
    // log is long enough, so the preview and "n of m" count look wrong.
    setSampleIdx(0);
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
    // Masks are part of the image they annotate, not files to browse: they
    // share its logName and sort ahead of it by filename, so the tree was
    // picking a `.mask.png` as the entry for the whole log. That is not an
    // image type, so a segmentation log previewed as a binary blob while a
    // detections log — which has no masks — looked fine.
    const browsable = excludeMaskFiles(files);
    if (!searchQuery) return browsable;
    const query = searchQuery.toLowerCase();
    return browsable.filter(
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
                      run={currentRun}
                      file={currentFile}
                      organizationId={organizationId}
                      projectName={projectName}
                      runId={runId}
                    />
                  </div>
                  {filesAtStep.length > 1 && (
                    <div className="flex items-center justify-center gap-2 border-t px-4 py-1.5 text-xs">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={safeSampleIdx === 0}
                        onClick={() => setSampleIdx(safeSampleIdx - 1)}
                        data-testid="file-sample-prev"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="tabular-nums text-muted-foreground" data-testid="file-sample-label">
                        sample {safeSampleIdx + 1} / {filesAtStep.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={safeSampleIdx >= filesAtStep.length - 1}
                        onClick={() => setSampleIdx(safeSampleIdx + 1)}
                        data-testid="file-sample-next"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
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
