import { useMemo, useState, useCallback, useEffect } from "react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { ImageCard } from "@/components/core/image-viewer";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { MediaSettingsPopover } from "@/components/core/media-settings-popover";
import { useSampleIndexSync } from "./use-sample-index-sync";
import { useMediaPins } from "./use-media-pins";

interface MultiGroupImageProps {
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

export const MultiGroupImage = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupImageProps) => {
  const selectedRunIds = useMemo(() => runs.map((run) => run.runId), [runs]);

  // One batched request for all runs (replaces the per-run runs.data.files
  // fan-out → no more 414s on media dashboards). NOT accumulated: presigned
  // URLs expire (~15min), so we keep a normal staleTime and refetch on
  // selection change to keep URLs fresh.
  const { data: byRun, isLoading } = useQuery(
    trpc.runs.data.filesBatch.queryOptions(
      { organizationId, projectName, logName, runIds: selectedRunIds },
      { enabled: selectedRunIds.length > 0 && (logName?.length ?? 0) > 0 },
    ),
  );

  const allImages = useMemo(
    () =>
      runs.flatMap((run) =>
        (byRun?.[run.runId] ?? []).map((image) => ({
          ...image,
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
  } = useSyncedStepNavigation(allImages);

  const { getPinInfo, handlePin, handleUnpin, pinnedRunCount, clearAllPins } =
    useMediaPins({ logName, runs });

  const imagesByRun = useMemo(() => {
    // Group all images into a (runId, step) → file[] lookup so a run can
    // expose multiple samples logged at the same step (wandb-style list logging).
    const imageLookup = new Map<string, typeof allImages>();
    for (const img of allImages) {
      const key = `${img.runId}-${img.step}`;
      const existing = imageLookup.get(key);
      if (existing) {
        existing.push(img);
      } else {
        imageLookup.set(key, [img]);
      }
    }

    // Only include runs that have AT LEAST ONE image for this logName across
    // all steps. A run that has data at step 5 but not the current step 3
    // still gets a cell — it just shows the "No image at step 3" placeholder.
    // A run with zero files for this logName is excluded entirely.
    const runIdsWithAnyData = new Set(allImages.map((img) => img.runId));

    return runs
      .filter((run) => runIdsWithAnyData.has(run.runId))
      .map((run) => {
        const pinInfo = getPinInfo(run.runId);
        const effectiveStep = pinInfo?.step ?? currentStepValue;
        const runImages = imageLookup.get(`${run.runId}-${effectiveStep}`) ?? [];

        // If this widget is the origin of the pin, the pin's remembered
        // sample index becomes the default for this cell. Cross-panel pins
        // that originated elsewhere (or have no originLogName) don't apply.
        const pinnedIndexForThisWidget =
          pinInfo?.index != null &&
          (pinInfo.originLogName == null ||
            pinInfo.originLogName === logName)
            ? pinInfo.index
            : null;

        return {
          run,
          images: runImages,
          isPinned: pinInfo !== null,
          pinnedStep: pinInfo?.step ?? null,
          pinSource: pinInfo?.source ?? null,
          pinBestStepMeta: pinInfo?.bestStepMeta ?? null,
          pinnedIndexForThisWidget,
          effectiveStep,
        };
      });
  }, [allImages, currentStepValue, runs, getPinInfo, logName]);

  // Per-sample < N/M > stepper sync (across runs + optionally across widgets).
  // See useSampleIndexSync for the two toggles and precedence.
  const { mode, setMode, handleIndexChange, resolveIndex } =
    useSampleIndexSync();

  const runsWithImages = imagesByRun.length;

  const [syncZoom, setSyncZoom] = useState(false);
  const [sharedScale, setSharedScale] = useState(1);

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
              <Skeleton className="aspect-[16/9] w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (allImages.length === 0 && !isLoading) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          No images found
        </div>
      </div>
    );
  }

  return (
    <MediaCardWrapper
      title={logName}
      className="h-full w-full"
      toolbarExtra={
        <MediaSettingsPopover
          syncZoom={syncZoom}
          onSyncZoomChange={setSyncZoom}
          pinnedRunCount={pinnedRunCount}
          onClearAllPins={clearAllPins}
          syncMode={mode}
          onSyncModeChange={setMode}
        />
      }
    >
      <div data-testid="image-widget" className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div
          className={cn(
            "grid flex-1 grid-cols-1 gap-4 overflow-auto px-1",
            runsWithImages > 1 && "sm:grid-cols-2",
          )}
        >
          {imagesByRun.map((entry) => {
            const {
              run,
              images,
              isPinned,
              pinnedStep,
              pinSource,
              pinBestStepMeta,
              pinnedIndexForThisWidget,
              effectiveStep,
            } = entry;
            // Resolve which sample this cell shows (linked/unlinked across runs
            // and widgets, sticky across steps, pinned-index fallback, clamped).
            const safeIndex = resolveIndex(
              run.runId,
              pinnedIndexForThisWidget,
              images.length,
            );
            const image = images[safeIndex];

            return (
              <ImageCard
                key={run.runId}
                url={image?.url}
                fileName={image?.fileName}
                caption={image?.caption}
                runLabel={{ name: run.runName, color: run.color }}
                isPinned={isPinned}
                pinnedStep={pinnedStep}
                pinSource={pinSource}
                pinBestStepMeta={pinBestStepMeta}
                currentStepValue={effectiveStep}
                totalIndices={images.length}
                currentImageIndex={safeIndex}
                onIndexChange={(next) => handleIndexChange(run.runId, next)}
                onPin={(scope) =>
                  handlePin(run.runId, effectiveStep, safeIndex, scope)
                }
                onUnpin={(scope) => handleUnpin(run.runId, scope)}
                hasSyncContext={hasSyncContext}
                stepNavigation={
                  hasMultipleSteps()
                    ? {
                        currentStepIndex,
                        currentStepValue,
                        availableSteps,
                        onStepChange: goToStepIndex,
                        isLocked,
                        onLockChange: setIsLocked,
                        showLock: hasSyncContext,
                      }
                    : undefined
                }
                sharedScale={syncZoom ? sharedScale : undefined}
                onScaleChange={syncZoom ? setSharedScale : undefined}
              />
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
