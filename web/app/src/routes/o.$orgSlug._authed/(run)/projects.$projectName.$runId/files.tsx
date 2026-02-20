import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { RunNotFound } from "@/components/layout/run/not-found";
import { RefreshButton } from "@/components/core/refresh-button";
import { File, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { queryClient, trpc } from "@/utils/trpc";

import { useRefreshTime } from "./~hooks/use-refresh-time";
import { prefetchGetRun, useGetRun } from "./~queries/get-run";
import { prefetchGetFileTree, useGetFileTree } from "./~queries/get-file-tree";
import { Layout } from "./~components/layout";
import { FileTree, type FileEntry } from "./~components/files/file-tree";
import { FilePreview } from "./~components/files/file-preview";

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
  const [searchQuery, setSearchQuery] = useState("");

  const { data: currentRun } = useGetRun(organizationId, projectName, runId);

  const refreshAllData = async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.runs.data.fileTree.queryKey({
        organizationId,
        projectName,
        runId,
      }),
      refetchType: "all",
    });
  };

  const { lastRefreshTime, handleRefresh } = useRefreshTime({
    runId,
    onRefresh: refreshAllData,
    defaultAutoRefresh: currentRun?.status === "RUNNING",
    refreshInterval: 10000,
  });

  const { data: files, isLoading } = useGetFileTree(
    organizationId,
    projectName,
    runId,
  );

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
        ) : !files || files.length === 0 ? (
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
            <div className="flex w-72 shrink-0 flex-col border-r">
              <div className="border-b p-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <FileTree
                  files={filteredFiles}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                />
              </div>
              <div className="border-t px-3 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {files.length} file{files.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Main: File Preview */}
            <div className="min-w-0 flex-1">
              {selectedFile ? (
                <FilePreview
                  file={selectedFile}
                  organizationId={organizationId}
                  projectName={projectName}
                  runId={runId}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                  <File className="h-10 w-10" />
                  <p className="text-sm">Select a file to preview</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
