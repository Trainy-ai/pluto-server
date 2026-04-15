import React, { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/video";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { MultiIndexNav } from "@/components/core/multi-index-nav";

interface Video {
  url: string;
  time: string;
  step: number;
  fileName: string;
  fileType: string;
  runId?: string;
}

interface MultiGroupVideoProps {
  logName: string;
  organizationId: string;
  projectName: string;
  runs: {
    runId: string;
    runName: string;
    color: string;
  }[];
  className?: string;
}

export const MultiGroupVideo = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupVideoProps) => {
  // Use useQueries at the top level to fetch videos for each run
  const videoQueries = useQueries({
    queries: runs.map((run) => ({
      ...trpc.runs.data.files.queryOptions({
        organizationId,
        runId: run.runId,
        projectName,
        logName,
      }),
    })),
  });

  // Combine the query results with run data
  const queriesWithRuns = useMemo(
    () =>
      videoQueries.map((query, index) => ({
        ...query,
        run: runs[index],
      })),
    [videoQueries, runs],
  );

  const isLoading = useMemo(
    () => queriesWithRuns.some((query) => query.isLoading),
    [queriesWithRuns],
  );

  // Flatten all videos with runId
  const allVideos = useMemo(
    () =>
      queriesWithRuns
        .map((query) => {
          const videos = query.data || [];
          return videos.map((video) => ({
            ...video,
            runId: query.run.runId,
          }));
        })
        .flat()
        .filter(Boolean),
    [queriesWithRuns],
  );

  const {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    goToStepIndex,
    hasMultipleSteps,
    isLocked,
    setIsLocked,
    hasSyncContext,
  } = useSyncedStepNavigation(allVideos);

  // Filter videos for current step
  const currentStepVideos = useMemo(
    () => allVideos.filter((video) => video.step === currentStepValue),
    [allVideos, currentStepValue],
  );

  // Group videos by run. A run can log multiple video samples at the same
  // step (e.g. wandb list-of-video) so we keep the full array and expose an
  // index selector below the player.
  const videosByRun = useMemo(() => {
    const result = runs.map((run) => {
      const runVideos = currentStepVideos.filter(
        (video) => video.runId === run.runId,
      );
      return {
        run,
        videos: runVideos,
      };
    });

    return result;
  }, [runs, currentStepVideos]);

  // Per-run sample index for multi-sample-per-step. Resets on step change.
  const [indexByRun, setIndexByRun] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    setIndexByRun(new Map());
  }, [currentStepValue]);
  const handleIndexChange = useCallback((runId: string, next: number) => {
    setIndexByRun((prev) => new Map(prev).set(runId, next));
  }, []);

  // Calculate a consistent aspect ratio container height
  const containerHeight = "aspect-video";

  if (currentStepVideos.length === 0 && !isLoading) {
    return (
      <div
        className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}
      >
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          No videos found
        </div>
      </div>
    );
  }

  return (
    <MediaCardWrapper title={logName} className="h-full w-full">
    <div
      className={cn(
        "flex h-full w-full flex-col space-y-4 p-4",
        className,
      )}
    >
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {logName}
      </h3>
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto sm:grid-cols-2">
        {videosByRun.map(({ run, videos }) => {
          const rawIndex = indexByRun.get(run.runId) ?? 0;
          const safeIndex =
            videos.length > 0 ? Math.min(rawIndex, videos.length - 1) : 0;
          const video = videos[safeIndex];
          const isRunLoading = queriesWithRuns.find(
            (q) => q.run.runId === run.runId,
          )?.isLoading;

          // If we're not loading and there's no video, don't render anything
          if (!isRunLoading && !video) {
            return null;
          }

          return (
            <div
              key={run.runId}
              className="flex h-full flex-col gap-1.5"
              data-testid="video-card"
              data-run-name={run.runName}
            >
              <div className="flex items-center justify-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: run.color }}
                />
                <span
                  className="truncate text-xs font-medium"
                  style={{ color: run.color }}
                  title={run.runName}
                >
                  {run.runName}
                </span>
              </div>
              <div
                className={cn(
                  "flex-1 overflow-hidden rounded-md shadow-lg",
                  containerHeight,
                )}
              >
                {isRunLoading ? (
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : (
                  <div className="flex h-full flex-col">
                    <VideoPlayer url={video.url} fileName={video.fileName} />
                    <p className="truncate border-t p-2 font-mono text-xs">
                      {video.fileName}
                    </p>
                  </div>
                )}
              </div>
              <MultiIndexNav
                currentIndex={safeIndex}
                totalCount={videos.length}
                onIndexChange={(next) => handleIndexChange(run.runId, next)}
              />
            </div>
          );
        })}
      </div>

      {hasMultipleSteps() && (
        <div className="sticky bottom-0 z-10 border-t bg-background pt-3 pb-1">
          <StepNavigator
            currentStepIndex={currentStepIndex}
            currentStepValue={currentStepValue}
            availableSteps={availableSteps}
            onStepChange={goToStepIndex}
            isLocked={isLocked}
            onLockChange={setIsLocked}
            showLock={hasSyncContext}
          />
        </div>
      )}
    </div>
    </MediaCardWrapper>
  );
};
