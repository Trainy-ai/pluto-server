import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { AudioPlayer } from "@/components/core/audio-player";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";

interface MultiGroupAudioProps {
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

export const MultiGroupAudio = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupAudioProps) => {
  // Use useQueries for multiple runs
  const audioQueries = useQueries({
    queries: runs.map((run) => ({
      ...trpc.runs.data.files.queryOptions({
        organizationId,
        runId: run.runId,
        projectName,
        logName,
      }),
    })),
  });

  // Combine queries with run data
  const queriesWithRuns = useMemo(
    () =>
      audioQueries.map((query, index) => ({
        ...query,
        run: runs[index],
      })),
    [audioQueries, runs],
  );

  const isLoading = useMemo(
    () => queriesWithRuns.some((query) => query.isLoading),
    [queriesWithRuns],
  );

  // Flatten all audio with runId for step navigation
  const allAudio = useMemo(
    () =>
      queriesWithRuns
        .map((query) => {
          const audio = query.data || [];
          return audio.map((file) => ({
            ...file,
            runId: query.run.runId,
          }));
        })
        .flat()
        .filter(Boolean),
    [queriesWithRuns],
  );

  // Use synced step navigation hook
  const {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    goToStepIndex,
    hasMultipleSteps,
    isLocked,
    setIsLocked,
    hasSyncContext,
  } = useSyncedStepNavigation(allAudio);

  // Filter audio for current step and group by run
  const audioByRun = useMemo(() => {
    const currentStepAudio = allAudio.filter(
      (file) => file.step === currentStepValue,
    );

    return runs.map((run) => {
      const runAudio = currentStepAudio.filter(
        (file: any) => file.runId === run.runId,
      );
      return {
        run,
        audio: runAudio,
      };
    });
  }, [allAudio, currentStepValue, runs]);

  if (isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="grid grid-cols-1 gap-4">
          {runs.slice(0, 2).map((run) => (
            <div key={run.runId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-center gap-1.5">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="rounded-lg bg-muted/15 p-4">
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (allAudio.length === 0 && !isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          No audio files found
        </div>
      </div>
    );
  }

  return (
    <MediaCardWrapper title={logName} className="h-full w-full">
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto">
          {audioByRun.map(({ run, audio }) => {
            const audioFile = audio[0];
            if (!audioFile) return null;

            return (
              <AudioPlayer
                key={run.runId}
                url={audioFile.url}
                fileName={audioFile.fileName}
                runLabel={{ name: run.runName, color: run.color }}
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
