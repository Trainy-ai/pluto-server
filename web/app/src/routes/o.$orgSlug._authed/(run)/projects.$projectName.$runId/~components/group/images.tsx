import React, { useMemo } from "react";
import type { LogGroup } from "../../~hooks/use-filtered-logs";
import { useGetImages } from "../../~queries/get-images";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Download,
  Minus,
  Plus,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Slider } from "@/components/ui/slider";

interface ImagesViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

interface StepSliderProps {
  currentStep: number;
  totalSteps: number;
  onStepChange: (value: number[]) => void;
  currentStepValue: number;
  totalStepValue: number;
}

const StepSlider = ({
  currentStep,
  totalSteps,
  onStepChange,
  currentStepValue,
  totalStepValue,
}: StepSliderProps) => {
  return (
    <div className="mx-auto max-w-2xl px-4">
      <div className="flex items-center gap-4">
        <span className="font-mono text-sm font-medium">Step:</span>
        <Slider
          value={[currentStep]}
          onValueChange={onStepChange}
          max={totalSteps - 1}
          step={1}
          className="flex-1"
        />
        <div className="flex min-w-[100px] items-center justify-center">
          <div className="rounded-mdpx-2 flex items-center gap-1.5 py-1">
            <span className="font-mono text-sm font-medium">
              {currentStepValue}/{totalStepValue}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const PaginationControls = ({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationControlsProps) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-4 py-4">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage === 0}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1">
        <span className="font-mono text-sm font-medium">
          Page {currentPage + 1}/{totalPages}
        </span>
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={currentPage === totalPages - 1}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

const ImageWithZoom = ({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const resetView = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
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
      // Fallback to direct download if blob approach fails
      window.open(url, "_blank");
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      setPosition({ x: newX, y: newY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY || e.deltaX;
      const newScale = Math.min(Math.max(1, scale + delta * 0.01), 8);
      setScale(newScale);
    }
  };

  useEffect(() => {
    if (scale === 1) {
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  return (
    <Dialog>
      <div className="group relative flex h-full w-full items-center justify-center">
        <DialogTrigger asChild>
          <div className="relative h-full w-full cursor-zoom-in overflow-hidden">
            <img
              src={url}
              alt={fileName}
              className="h-full w-full object-contain"
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
            >
              <Download className="h-3 w-3" />
            </Button>
          </div>
        </DialogTrigger>
      </div>
      <DialogContent className="h-[95vh] w-[95vw]">
        <div className="flex h-full w-full flex-col">
          {/* Image viewer */}
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
                src={url}
                alt={fileName}
                className="h-full w-full object-contain select-none"
                draggable={false}
              />
            </div>
          </div>
          {/* Controls and metadata */}
          <div className="flex flex-col gap-2 border-t bg-background px-6 py-3">
            <div className="flex items-center justify-between">
              {/* File info */}
              <p className="font-mono text-sm text-muted-foreground">
                {fileName}
              </p>
              {/* Zoom controls */}
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
              {/* Download button */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const ImagesView = ({
  log,
  tenantId,
  projectName,
  runId,
}: ImagesViewProps) => {
  const { data, isLoading } = useGetImages(
    tenantId,
    projectName,
    runId,
    log.logName,
  );

  const [currentStep, setCurrentStep] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const imagesPerPage = 4;

  // Memoize the steps array and current step value
  const { steps, currentStepValue, totalStepValue } = useMemo(() => {
    if (!data) return { steps: [], currentStepValue: 0, totalStepValue: 0 };

    const imagesByStep = data.reduce(
      (acc: Record<number, typeof data>, image: any) => {
        const step = image.step || 0;
        if (!acc[step]) {
          acc[step] = [];
        }
        acc[step].push(image);
        return acc;
      },
      {} as Record<number, typeof data>,
    );

    const sortedSteps = Object.keys(imagesByStep)
      .map(Number)
      .sort((a, b) => a - b);

    return {
      steps: sortedSteps,
      currentStepValue: sortedSteps[currentStep] || 0,
      totalStepValue: sortedSteps[sortedSteps.length - 1] || 0,
    };
  }, [data, currentStep]);

  const currentStepImages = useMemo(() => {
    if (!data) return [];
    const imagesByStep = data.reduce(
      (acc: Record<number, typeof data>, image: any) => {
        const step = image.step || 0;
        if (!acc[step]) {
          acc[step] = [];
        }
        acc[step].push(image);
        return acc;
      },
      {} as Record<number, typeof data>,
    );
    return imagesByStep[currentStepValue] || [];
  }, [data, currentStepValue]);

  const totalPages = Math.ceil(currentStepImages.length / imagesPerPage);

  const paginatedImages = useMemo(() => {
    return currentStepImages.slice(
      currentPage * imagesPerPage,
      (currentPage + 1) * imagesPerPage,
    );
  }, [currentStepImages, currentPage, imagesPerPage]);

  const handleStepChange = (value: number[]) => {
    setCurrentStep(value[0]);
    setCurrentPage(0);
  };

  if (isLoading || !data) {
    return (
      <div className="h-full space-y-6 p-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex h-[calc(100%-60px)] flex-col items-center justify-center">
          <div className="h-full w-full max-w-4xl">
            <div className="group relative flex h-full items-center justify-center">
              <div className="relative aspect-[16/9] h-full w-full overflow-hidden rounded-md">
                <Skeleton className="h-full w-full" />
              </div>
            </div>
            <Skeleton className="mx-auto mt-3 h-4 w-48" />
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          No images found
        </div>
      </div>
    );
  }

  if (data.length === 1) {
    const image = data[0];
    return (
      <div className="h-full space-y-6 p-4">
        <h3 className="text-center font-mono text-lg font-medium">
          {log.logName}
        </h3>
        <div className="flex h-[calc(100%-60px)] flex-col items-center justify-center">
          <div className="flex h-full w-full max-w-4xl items-center justify-center">
            <ImageWithZoom url={image.url} fileName={image.fileName} />
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {image.fileName}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-6 p-4">
      <h3 className="text-center font-mono text-lg font-medium">
        {log.logName}
      </h3>

      <StepSlider
        currentStep={currentStep}
        totalSteps={steps.length}
        onStepChange={handleStepChange}
        currentStepValue={currentStepValue}
        totalStepValue={totalStepValue}
      />

      {/* Images Grid */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background">
        <div className="flex-1 overflow-y-auto p-2">
          <div className="grid h-full grid-cols-2 gap-6 p-4">
            {paginatedImages.map((image: any) => (
              <div
                key={image.fileName}
                className="flex h-full flex-col items-center gap-2 rounded-xl bg-muted/15 p-4 shadow-sm"
              >
                <div className="flex h-full w-full items-center justify-center rounded-lg bg-background p-2">
                  <ImageWithZoom url={image.url} fileName={image.fileName} />
                </div>
                <p className="px-2 text-center font-mono text-xs break-all text-muted-foreground">
                  {image.fileName}
                </p>
              </div>
            ))}
          </div>
        </div>
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
};
