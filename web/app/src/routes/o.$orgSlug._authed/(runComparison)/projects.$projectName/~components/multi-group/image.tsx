import { useMemo, useState, useCallback, useEffect } from "react";
import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { ImageCard } from "@/components/core/image-viewer";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { ImageSettingsPopover } from "@/components/core/image-viewer/image-settings-popover";
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
  const imageQueries = useQueries({
    queries: runs.map((run) => ({
      ...trpc.runs.data.files.queryOptions({
        organizationId,
        runId: run.runId,
        projectName,
        logName,
      }),
    })),
  });

  const queriesWithRuns = useMemo(
    () =>
      imageQueries.map((query, index) => ({
        ...query,
        run: runs[index],
      })),
    [imageQueries, runs],
  );

  const isLoading = useMemo(
    () => queriesWithRuns.some((query) => query.isLoading),
    [queriesWithRuns],
  );

  const allImages = useMemo(
    () =>
      queriesWithRuns
        .map((query) => {
          const images = query.data || [];
          return images.map((image) => ({
            ...image,
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

  // Per-run sample index for multi-sample-per-step logging. Resets to 0 when
  // the step changes — we don't try to persist across step navigation.
  const [indexByRun, setIndexByRun] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    setIndexByRun(new Map());
  }, [currentStepValue]);
  const handleIndexChange = useCallback((runId: string, next: number) => {
    setIndexByRun((prev) => new Map(prev).set(runId, next));
  }, []);

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
        <ImageSettingsPopover
          syncZoom={syncZoom}
          onSyncZoomChange={setSyncZoom}
          pinnedRunCount={pinnedRunCount}
          onClearAllPins={clearAllPins}
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
            // User's local arrow navigation wins. When there's no local
            // override (initial render or post-step-change reset), fall back
            // to the pinned index for this widget, then 0.
            const rawIndex =
              indexByRun.get(run.runId) ?? pinnedIndexForThisWidget ?? 0;
            const safeIndex =
              images.length > 0 ? Math.min(rawIndex, images.length - 1) : 0;
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
