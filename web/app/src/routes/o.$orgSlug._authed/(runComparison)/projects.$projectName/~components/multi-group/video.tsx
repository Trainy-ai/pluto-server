import React, { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/video";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { MultiIndexNav } from "@/components/core/multi-index-nav";
import { MediaPinLabel } from "@/components/core/media-pin-label";
import { ClearAllPinsButton } from "@/components/core/clear-all-pins-button";
import { pinRingClass } from "@/components/core/image-viewer/pin-styles";
import { useMediaPins } from "./use-media-pins";

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
  const selectedRunIds = useMemo(() => runs.map((run) => run.runId), [runs]);

  // One batched request for all runs (replaces the per-run runs.data.files
  // fan-out → no more 414s). NOT accumulated: presigned URLs expire (~15min),
  // so normal staleTime + refetch on selection change keeps URLs fresh.
  const { data: byRun, isLoading } = useQuery(
    trpc.runs.data.filesBatch.queryOptions(
      { organizationId, projectName, logName, runIds: selectedRunIds },
      { enabled: selectedRunIds.length > 0 && (logName?.length ?? 0) > 0 },
    ),
  );

  // Flatten all videos with runId
  const allVideos = useMemo(
    () =>
      runs.flatMap((run) =>
        (byRun?.[run.runId] ?? []).map((video) => ({
          ...video,
          runId: run.runId,
        })),
      ),
    [runs, byRun],
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

  const { getPinInfo, handlePin, handleUnpin, pinnedRunCount, clearAllPins } =
    useMediaPins({ logName, runs });

  // Group videos by run, honoring per-run pins. Each run resolves its own
  // effective step (pinned step when pinned, else the widget's current step)
  // so a pinned run stays frozen while the rest follow the stepper. A run can
  // log multiple video samples at the same step (wandb list-of-video) so we
  // keep the full array and expose an index selector below the player.
  const videosByRun = useMemo(() => {
    const lookup = new Map<string, typeof allVideos>();
    for (const video of allVideos) {
      const key = `${video.runId}-${video.step}`;
      const existing = lookup.get(key);
      if (existing) {
        existing.push(video);
      } else {
        lookup.set(key, [video]);
      }
    }

    // Only include runs that have at least one video for this logName across
    // all steps — a run with data at some other step still gets a cell (it
    // shows a "No video at step N" placeholder); a run with zero files is
    // excluded entirely.
    const runIdsWithAnyData = new Set(allVideos.map((video) => video.runId));

    return runs
      .filter((run) => runIdsWithAnyData.has(run.runId))
      .map((run) => {
        const pinInfo = getPinInfo(run.runId);
        const effectiveStep = pinInfo?.step ?? currentStepValue;
        const runVideos = lookup.get(`${run.runId}-${effectiveStep}`) ?? [];
        // The pin's remembered sample index only applies when this widget is
        // the pin's origin (cross-panel pins from other widgets fall back to
        // local index state).
        const pinnedIndexForThisWidget =
          pinInfo?.index != null &&
          (pinInfo.originLogName == null || pinInfo.originLogName === logName)
            ? pinInfo.index
            : null;
        return {
          run,
          videos: runVideos,
          isPinned: pinInfo !== null,
          pinnedStep: pinInfo?.step ?? null,
          pinSource: pinInfo?.source ?? null,
          pinBestStepMeta: pinInfo?.bestStepMeta ?? null,
          pinnedIndexForThisWidget,
          effectiveStep,
        };
      });
  }, [allVideos, currentStepValue, runs, getPinInfo, logName]);

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

  if (isLoading) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2">
          {runs.map((run) => (
            <div key={run.runId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-center gap-1.5">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className={cn("w-full rounded-md", containerHeight)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (allVideos.length === 0 && !isLoading) {
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
    <MediaCardWrapper
      title={logName}
      className="h-full w-full"
      toolbarExtra={
        <ClearAllPinsButton
          pinnedRunCount={pinnedRunCount}
          onClearAllPins={clearAllPins}
        />
      }
    >
    <div
      data-testid="video-widget"
      className={cn(
        "flex h-full w-full flex-col space-y-4 p-4",
        className,
      )}
    >
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {logName}
      </h3>
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto sm:grid-cols-2">
        {videosByRun.map((entry) => {
          const {
            run,
            videos,
            isPinned,
            pinnedStep,
            pinSource,
            pinBestStepMeta,
            pinnedIndexForThisWidget,
            effectiveStep,
          } = entry;
          // User's local arrow navigation wins; otherwise fall back to the
          // pinned sample index for this widget, then 0.
          const rawIndex =
            indexByRun.get(run.runId) ?? pinnedIndexForThisWidget ?? 0;
          const safeIndex =
            videos.length > 0 ? Math.min(rawIndex, videos.length - 1) : 0;
          const video = videos[safeIndex];

          return (
            <div
              key={run.runId}
              className="flex h-full flex-col gap-1.5"
              data-testid="video-card"
              data-run-name={run.runName}
              data-pin-source={pinSource ?? ""}
            >
              <MediaPinLabel
                runLabel={{ name: run.runName, color: run.color }}
                isPinned={isPinned}
                pinnedStep={pinnedStep}
                pinSource={pinSource}
                pinBestStepMeta={pinBestStepMeta}
                currentStepValue={effectiveStep}
                onPin={(scope) =>
                  handlePin(run.runId, effectiveStep, safeIndex, scope)
                }
                onUnpin={(scope) => handleUnpin(run.runId, scope)}
                hasSyncContext={hasSyncContext}
                noun="Video"
              />
              <div
                className={cn(
                  "flex-1 overflow-hidden rounded-md shadow-lg",
                  containerHeight,
                  isPinned && pinRingClass(pinSource),
                )}
              >
                {video ? (
                  <div className="flex h-full flex-col">
                    <VideoPlayer url={video.url} fileName={video.fileName} />
                    <p
                      className="truncate border-t p-2 font-mono text-xs"
                      title={
                        video.caption
                          ? `${video.caption} (${video.fileName})`
                          : video.fileName
                      }
                    >
                      {video.caption || video.fileName}
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center border border-dashed bg-background/50 px-2 text-center text-sm text-muted-foreground">
                    No video at step {effectiveStep}
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
        <div className="sticky bottom-0 border-t border-border bg-background pt-1.5 pb-0.5">
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
