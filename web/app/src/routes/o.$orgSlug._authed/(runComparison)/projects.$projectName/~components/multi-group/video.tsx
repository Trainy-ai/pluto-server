import React, { useState, useMemo } from "react";
import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/video";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";

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
  const [currentStep, setCurrentStep] = useState(0);

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

  // Memoize the steps array and current step value
  const { steps, currentStepValue, totalStepValue, currentStepVideos } =
    useMemo(() => {
      const allVideos = queriesWithRuns
        .map((query) => {
          const videos = query.data || [];
          // Add runId to each video
          return videos.map((video) => ({
            ...video,
            runId: query.run.runId,
          }));
        })
        .flat()
        .filter(Boolean);

      if (allVideos.length === 0) {
        return {
          steps: [],
          currentStepValue: 0,
          totalStepValue: 0,
          currentStepVideos: [],
        };
      }

      const videosByStep = allVideos.reduce(
        (acc, video) => {
          const step = video.step || 0;
          if (!acc[step]) {
            acc[step] = [];
          }
          acc[step].push(video);
          return acc;
        },
        {} as Record<number, typeof allVideos>,
      );

      const sortedSteps = Object.keys(videosByStep)
        .map(Number)
        .sort((a, b) => a - b);

      const result = {
        steps: sortedSteps,
        currentStepValue: sortedSteps[currentStep] || 0,
        totalStepValue: sortedSteps[sortedSteps.length - 1] || 0,
        currentStepVideos: videosByStep[sortedSteps[currentStep] || 0] || [],
      };

      return result;
    }, [queriesWithRuns, currentStep]);

  // Group videos by run
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
    <div
      className={cn(
        "flex h-full w-full flex-grow flex-col space-y-4 p-4",
        className,
      )}
    >
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {logName}
      </h3>
      <div className="grid h-full flex-1 grid-cols-1 gap-4 overflow-auto sm:grid-cols-2">
        {videosByRun.map(({ run, videos }) => {
          const video = videos[0]; // Take the first video for each run
          const isRunLoading = queriesWithRuns.find(
            (q) => q.run.runId === run.runId,
          )?.isLoading;

          // If we're not loading and there's no video, don't render anything
          if (!isRunLoading && !video) {
            return null;
          }

          return (
            <div key={run.runId} className="flex h-full flex-col gap-1.5">
              <div className="flex items-center justify-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: run.color }}
                />
                <span
                  className="text-sm font-medium"
                  style={{ color: run.color }}
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
            </div>
          );
        })}
      </div>

      {steps.length > 1 && (
        <div className="border-t pt-4">
          <StepNavigator
            currentStepIndex={currentStep}
            currentStepValue={currentStepValue}
            availableSteps={steps}
            onStepChange={setCurrentStep}
          />
        </div>
      )}
    </div>
  );
};
