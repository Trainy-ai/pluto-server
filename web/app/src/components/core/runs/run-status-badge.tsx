import { Badge } from "@/components/ui/badge";
import { DocsTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  UnstyledTooltipContent,
} from "@/components/ui/tooltip";

type BaseRun = {
  status: "COMPLETED" | "FAILED" | "TERMINATED" | "RUNNING" | "CANCELLED";
  updatedAt: Date;
};

export function RunStatusBadge({ run }: { run: BaseRun }) {
  const RUN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  const lastUpdated = run.updatedAt;
  const isMoreThan5minAgo =
    lastUpdated &&
    new Date().getTime() - lastUpdated.getTime() > RUN_TIMEOUT_MS;

  const status =
    run.status === "RUNNING" && isMoreThan5minAgo ? "RUNNING" : run.status; // TODO sort out the statuses

  const statusConfig = {
    COMPLETED: {
      variant: "success",
      className:
        "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-500/30 dark:text-emerald-300",
      label: "Completed",
      description: "The run completed successfully.",
    },
    FAILED: {
      variant: "error",
      className:
        "bg-red-500/20 text-red-800 dark:bg-red-500/30 dark:text-red-300",
      label: "Failed",
      description: "The run failed for unknown reasons.",
    },
    TERMINATED: {
      variant: "error",
      className:
        "bg-red-500/20 text-red-800 dark:bg-red-500/30 dark:text-red-300",
      label: "Terminated",
      description: "The run was terminated by the user.",
    },
    RUNNING: {
      variant: "loading",
      className:
        "bg-blue-500/20 text-blue-800 dark:bg-blue-500/30 dark:text-blue-300",
      label: "Running",
      description: "The run is currently running.",
    },
    CANCELLED: {
      variant: "error",
      className:
        "bg-red-500/20 text-red-800 dark:bg-red-500/30 dark:text-red-300",
      label: "Cancelled",
      description: "The run was cancelled by the user.",
    },
  } as const;

  const config = statusConfig[status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={config.variant}
            className={cn("font-medium", config.className)}
          >
            {config.label}
          </Badge>
        </TooltipTrigger>
        <UnstyledTooltipContent
          sideOffset={8}
          side="right"
          align="center"
          showArrow={false}
        >
          <DocsTooltip
            title={
              status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
            }
            iconComponent={<InfoIcon className="size-4" />}
            description={config.description}
            link={`https://docs.mlop.ai/docs/experiments/status`}
          />
        </UnstyledTooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
