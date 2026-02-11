import React, { useState, useRef, useMemo, useCallback } from "react";
import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { useStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-step-navigation";

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

// Define the component logic
const MultiGroupImageComponent = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupImageProps) => {
  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    fileName: string;
    runName: string;
  } | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Use useQueries at the top level
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

  // Combine the query results with run data
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

  // Flatten all images with runId for step navigation
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

  // Use step navigation hook
  const {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    goToStepIndex,
    hasMultipleSteps,
  } = useStepNavigation(allImages);

  // Filter images for current step and group by run
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

  // ---- START: Helper Function Callbacks ----
  // Define helper functions callbacks *before* JSX callbacks that use them.
  const resetView = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [setScale, setPosition]); // Added deps

  const handleDownload = useCallback(async (url: string, fileName: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch image");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Failed to download file:", error);
      window.open(url, "_blank");
    }
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale > 1) {
        setIsDragging(true);
        setDragStart({
          x: e.clientX - position.x,
          y: e.clientY - position.y,
        });
      }
    },
    [scale, position.x, position.y, setIsDragging, setDragStart],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging && scale > 1) {
        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;
        setPosition({ x: newX, y: newY });
      }
    },
    [isDragging, scale, dragStart.x, dragStart.y, setPosition],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, [setIsDragging]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY || e.deltaX;
        const newScale = Math.min(Math.max(1, scale + delta * 0.01), 8);
        setScale(newScale);
      }
    },
    [scale, setScale],
  );
  // ---- END: Helper Function Callbacks ----

  // ---- START: JSX Event Handler Callbacks ----
  // These depend on helper callbacks defined above.
  const handleSelectImage = useCallback(
    (image: { url: string; fileName: string }, runName: string) => {
      setSelectedImage({ ...image, runName });
    },
    [setSelectedImage],
  );

  const handleGridDownloadClick = useCallback(
    (e: React.MouseEvent, url: string, fileName: string) => {
      e.stopPropagation();
      handleDownload(url, fileName); // Dependency handleDownload is defined above
    },
    [handleDownload],
  );
  // ---- END: JSX Event Handler Callbacks ----

  // Early return for loading state
  if (isLoading) {
    return (
      <div
        className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}
      >
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
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-md">
                <Skeleton className="h-full w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Check if there are any images
  if (allImages.length === 0 && !isLoading) {
    return (
      <div
        className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}
      >
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
    <Dialog>
      <div
        className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}
      >
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div
          className={cn(
            "grid flex-1 grid-cols-1 gap-4 overflow-auto",
            imagesByRun.length > 1 && "sm:grid-cols-2",
            imagesByRun.length === 2 && "lg:grid-cols-2",
            imagesByRun.length >= 3 && "lg:grid-cols-3",
          )}
        >
          {imagesByRun.map(({ run, images }) => {
            const image = images[0]; // Take the first image for each run at current step
            if (!image) return null;

            return (
              <div key={run.runId} className="flex flex-col gap-1.5">
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
                <DialogTrigger asChild>
                  <div
                    className="group relative flex aspect-[16/9] cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-background/50"
                    onClick={() => handleSelectImage(image, run.runName)}
                  >
                    <img
                      src={image.url}
                      alt={image.fileName}
                      className="h-full w-full object-contain"
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute top-1.5 right-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) =>
                        handleGridDownloadClick(e, image.url, image.fileName)
                      }
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                </DialogTrigger>
                <div className="flex justify-center">
                  <p className="truncate text-center text-xs text-muted-foreground">
                    {image.fileName}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {hasMultipleSteps() && (
          <div className="border-t pt-4">
            <StepNavigator
              currentStepIndex={currentStepIndex}
              currentStepValue={currentStepValue}
              availableSteps={availableSteps}
              onStepChange={goToStepIndex}
            />
          </div>
        )}
      </div>
      <DialogContent
        className="h-[95vh] w-[95vw]"
        aria-describedby="dialog-description"
      >
        <DialogTitle className="sr-only">
          {selectedImage
            ? `${selectedImage.runName} - ${selectedImage.fileName}`
            : "Image Preview"}
        </DialogTitle>
        <DialogDescription id="dialog-description" className="sr-only">
          Image viewer with zoom and download capabilities
        </DialogDescription>
        <div className="flex h-full w-full flex-col">
          {selectedImage && (
            <>
              <div
                ref={containerRef}
                className="relative flex flex-1 items-center justify-center bg-background/95 p-4"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                style={{
                  cursor:
                    scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                }}
              >
                <div
                  className="relative transition-transform duration-75 ease-out"
                  style={{
                    transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
                    transformOrigin: "center",
                  }}
                >
                  <img
                    src={selectedImage.url}
                    alt={selectedImage.fileName}
                    className="max-h-[88vh] max-w-[95vw] object-contain select-none"
                    draggable={false}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t bg-background px-6 py-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm text-muted-foreground">
                    {selectedImage.fileName}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 transition-colors hover:bg-muted"
                      onClick={() => setScale(Math.max(1, scale - 0.5))}
                      disabled={scale <= 1}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <div className="flex min-w-[100px] items-center justify-center">
                      <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
                        <span className="text-sm font-medium">
                          {Math.round(scale * 100)}%
                        </span>
                        <div className="h-3 w-px bg-border" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={resetView}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 transition-colors hover:bg-muted"
                      onClick={() => setScale(Math.min(8, scale + 0.5))}
                      disabled={scale >= 8}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() =>
                      handleDownload(selectedImage.url, selectedImage.fileName)
                    }
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Export the memoized component
export const MultiGroupImage = React.memo(MultiGroupImageComponent);

// Add display name for better debugging
MultiGroupImage.displayName = "MultiGroupImage";
