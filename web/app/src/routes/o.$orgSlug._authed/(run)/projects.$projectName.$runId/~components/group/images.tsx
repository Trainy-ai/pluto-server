import { useMemo, useState } from "react";
import type { LogGroup } from "../../~hooks/use-filtered-logs";
import { useGetImages } from "../../~queries/get-images";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSyncedStepNavigation } from "../../~hooks/use-synced-step-navigation";
import { StepNavigator } from "../shared/step-navigator";
import { ImageCard } from "@/components/core/image-viewer";
import { cn } from "@/lib/utils";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { ImageSettingsPopover } from "@/components/core/image-viewer/image-settings-popover";

interface ImagesViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

const PaginationControls = ({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) => {
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

  const [currentPage, setCurrentPage] = useState(0);
  const imagesPerPage = 4;
  const [syncZoom, setSyncZoom] = useState(false);
  const [sharedScale, setSharedScale] = useState(1);

  const {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    goToStepIndex,
    isLocked,
    setIsLocked,
    hasSyncContext,
  } = useSyncedStepNavigation(data || []);

  const currentStepImages = useMemo(() => {
    if (!data) return [];
    return data.filter((image) => image.step === currentStepValue);
  }, [data, currentStepValue]);

  const totalPages = Math.ceil(currentStepImages.length / imagesPerPage);

  const paginatedImages = useMemo(() => {
    return currentStepImages.slice(
      currentPage * imagesPerPage,
      (currentPage + 1) * imagesPerPage,
    );
  }, [currentStepImages, currentPage, imagesPerPage]);

  const handleStepChange = (index: number) => {
    goToStepIndex(index);
    setCurrentPage(0);
  };

  if (isLoading || !data) {
    return (
      <div className="flex h-full w-full flex-col space-y-4 p-4">
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto">
          <Skeleton className="aspect-[16/9] w-full rounded-md" />
          <Skeleton className="aspect-[16/9] w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full w-full flex-col space-y-4 p-4">
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          No images found
        </div>
      </div>
    );
  }

  return (
    <MediaCardWrapper
      title={log.logName}
      className="h-full w-full"
      toolbarExtra={
        <ImageSettingsPopover
          syncZoom={syncZoom}
          onSyncZoomChange={setSyncZoom}
        />
      }
    >
    <div className="flex h-full w-full flex-col space-y-4 p-4">
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {log.logName}
      </h3>

      <div
        className={cn(
          "grid flex-1 gap-4 overflow-auto",
          paginatedImages.length === 1 ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {paginatedImages.map((image: any, index: number) => (
          <ImageCard
            key={index}
            url={image.url}
            fileName={image.fileName}
            stepNavigation={
              availableSteps.length > 1
                ? {
                    currentStepIndex,
                    currentStepValue,
                    availableSteps,
                    onStepChange: handleStepChange,
                    isLocked,
                    onLockChange: setIsLocked,
                    showLock: hasSyncContext,
                  }
                : undefined
            }
            sharedScale={syncZoom ? sharedScale : undefined}
            onScaleChange={syncZoom ? setSharedScale : undefined}
          />
        ))}
      </div>

      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      {availableSteps.length > 1 && (
        <div className="sticky bottom-0 z-10 border-t bg-background pt-3 pb-1">
          <StepNavigator
            currentStepIndex={currentStepIndex}
            currentStepValue={currentStepValue}
            availableSteps={availableSteps}
            onStepChange={handleStepChange}
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
