import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { ImageCard } from "@/components/core/image-viewer";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { ImageSettingsPopover } from "@/components/core/image-viewer/image-settings-popover";

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

  const imagesByRun = useMemo(() => {
    const currentStepImages = allImages.filter(
      (image) => image.step === currentStepValue,
    );

    return runs.map((run) => {
      const runImages = currentStepImages.filter(
        (image: any) => image.runId === run.runId,
      );
      return {
        run,
        images: runImages,
      };
    });
  }, [allImages, currentStepValue, runs]);

  const runsWithImages = useMemo(
    () => imagesByRun.filter(({ images }) => images.length > 0).length,
    [imagesByRun],
  );

  const [syncZoom, setSyncZoom] = useState(false);
  const [sharedScale, setSharedScale] = useState(1);

  if (isLoading) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2 lg:grid-cols-3">
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
        />
      }
    >
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div
          className={cn(
            "grid flex-1 grid-cols-1 gap-4 overflow-auto",
            runsWithImages > 1 && "sm:grid-cols-2",
            runsWithImages === 2 && "lg:grid-cols-2",
            runsWithImages >= 3 && "lg:grid-cols-3",
          )}
        >
          {imagesByRun.map(({ run, images }) => {
            const image = images[0];
            if (!image) return null;

            return (
              <ImageCard
                key={run.runId}
                url={image.url}
                fileName={image.fileName}
                runLabel={{ name: run.runName, color: run.color }}
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
