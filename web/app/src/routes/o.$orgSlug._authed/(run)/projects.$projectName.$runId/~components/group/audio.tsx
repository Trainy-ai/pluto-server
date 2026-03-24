import type { LogGroup } from "@/lib/grouping/types";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useStepNavigation } from "../../~hooks/use-step-navigation";
import { StepNavigator } from "../shared/step-navigator";
import { AudioPlayer } from "@/components/core/audio-player";

interface AudioViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

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
      <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
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

export const AudioView = ({
  log,
  tenantId,
  projectName,
  runId,
}: AudioViewProps) => {
  const { data, isLoading } = useQuery(
    trpc.runs.data.files.queryOptions({
      organizationId: tenantId,
      runId,
      projectName,
      logName: log.logName,
    }),
  );

  const [currentPage, setCurrentPage] = useState(0);
  const audiosPerPage = 4;

  // Use step navigation hook
  const {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    goToStepIndex,
  } = useStepNavigation(data || []);

  const currentStepAudios = useMemo(() => {
    if (!data) return [];
    return data.filter((audio) => audio.step === currentStepValue);
  }, [data, currentStepValue]);

  const totalPages = Math.max(
    1,
    Math.ceil(currentStepAudios.length / audiosPerPage),
  );

  const safeCurrentPage = Math.min(Math.max(0, currentPage), totalPages - 1);

  const paginatedAudios = useMemo(() => {
    return currentStepAudios.slice(
      safeCurrentPage * audiosPerPage,
      (safeCurrentPage + 1) * audiosPerPage,
    );
  }, [currentStepAudios, safeCurrentPage, audiosPerPage]);

  const handleStepChange = (index: number) => {
    goToStepIndex(index);
    setCurrentPage(0);
  };

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="grid grid-cols-1 gap-4">
          <div className="rounded-lg bg-muted/15 p-4">
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          No audio files found
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col space-y-4 p-4">
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {log.logName}
      </h3>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto">
        {paginatedAudios.map((audio) => (
          <AudioPlayer
            key={audio.fileName}
            url={audio.url}
            fileName={audio.fileName}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <PaginationControls
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      {availableSteps.length > 1 && (
        <div className="sticky bottom-0 z-10 border-t bg-background pt-3 pb-1">
          <StepNavigator
            currentStepIndex={currentStepIndex}
            currentStepValue={currentStepValue}
            availableSteps={availableSteps}
            onStepChange={handleStepChange}
          />
        </div>
      )}
    </div>
  );
};
