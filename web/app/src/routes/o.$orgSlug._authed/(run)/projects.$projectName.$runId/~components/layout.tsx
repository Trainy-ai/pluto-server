import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import RunsLayout from "@/components/layout/run/layout";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useState, useCallback, type PropsWithChildren } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DocsTooltip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  UnstyledTooltipContent,
} from "@/components/ui/tooltip";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { RunTags } from "./run-tags";
import { useUpdateTags } from "../~queries/update-tags";

type Run = inferOutput<typeof trpc.runs.get>;

interface LayoutProps extends PropsWithChildren {
  run: Run;
  projectName: string;
  runId: string;
  title: string;
  organizationId: string;
  disableScroll?: boolean;
}

const CancelRunButton = ({
  organizationId,
  projectName,
  runId,
}: {
  organizationId: string;
  projectName: string;
  runId: string;
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const cancelRunMutation = useMutation(
    trpc.runs.trigger.createTrigger.mutationOptions({
      onSuccess: () => {
        toast.success("Run cancelled");
        queryClient.invalidateQueries({
          queryKey: [["runs", "get"]],
        });
        queryClient.invalidateQueries({
          queryKey: [["runs", "trigger", "get"]],
        });
      },
      onError: () => {
        toast.error("Failed to cancel run");
      },
    }),
  );

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setIsDialogOpen(true)}
          >
            Cancel Run
          </Button>
        </TooltipTrigger>
        <UnstyledTooltipContent showArrow={false}>
          <DocsTooltip
            title="Cancel Run"
            iconComponent={<AlertTriangle className="h-4 w-4" />}
            description="Cancels the currently running process by trigger an expection in the running process"
          />
        </UnstyledTooltipContent>
      </Tooltip>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel Run</DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel this run? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              cancelRunMutation.mutate({
                organizationId,
                projectName,
                runId,
                triggerType: "CANCEL",
              });
              setIsDialogOpen(false);
            }}
          >
            Yes, Cancel Run
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const Layout = ({
  children,
  run,
  projectName,
  runId,
  title,
  organizationId,
  disableScroll = false,
}: LayoutProps) => {
  const updateTagsMutation = useUpdateTags(organizationId, projectName, runId);

  const handleTagsUpdate = useCallback(
    (tags: string[]) => {
      updateTagsMutation.mutate({
        organizationId,
        runId,
        projectName,
        tags,
      });
    },
    [organizationId, projectName, runId, updateTagsMutation]
  );

  const [copied, setCopied] = useState(false);

  const displayId = run.number != null && run.project?.runPrefix
    ? `${run.project.runPrefix}-${run.number}`
    : null;
  // Always surface a copyable identifier: prefer the human displayId
  // (e.g. "MMP-1"), fall back to the route id so runs without a number /
  // project runPrefix still show and copy something in the header.
  const headerId = displayId ?? runId;

  return (
    <RunsLayout>
      <PageLayout
        disableScroll={disableScroll}
        headerLeft={
          <div className="flex items-center gap-4">
            <OrganizationPageTitle
              breadcrumbs={[
                { title: "Home", to: "/o/$orgSlug" },
                { title: "Projects", to: "/o/$orgSlug/projects" },
                { title: projectName, to: "/o/$orgSlug/projects/$projectName" },
              ]}
              title={title}
            />
            {headerId && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Copy run ID"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(headerId);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                        toast(`Copied run ID ${headerId}`);
                      } catch (err) {
                        console.error("Failed to copy run ID to clipboard", err);
                        toast.error("Failed to copy run ID to clipboard.");
                      }
                    }}
                    className="flex cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  >
                    {headerId}
                    {copied ? (
                      <Check className="size-3 shrink-0" />
                    ) : (
                      <Copy className="size-3 shrink-0" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {copied ? "Copied!" : "Copy run ID"}
                </TooltipContent>
              </Tooltip>
            )}
            <RunStatusBadge run={run} />
            <RunTags
              tags={run.tags || []}
              onTagsUpdate={handleTagsUpdate}
              organizationId={organizationId}
              projectName={projectName}
            />
          </div>
        }
        headerRight={
          <div>
            {run?.status === "RUNNING" && (
              <CancelRunButton
                organizationId={organizationId}
                projectName={projectName}
                runId={runId}
              />
            )}
          </div>
        }
      >
        {children}
      </PageLayout>
    </RunsLayout>
  );
};

interface SkeletonLayoutProps extends PropsWithChildren {
  title: string;
  projectName: string;
}

export const SkeletonLayout = ({ title, projectName }: SkeletonLayoutProps) => {
  return (
    <RunsLayout>
      <PageLayout
        showSidebarTrigger={false}
        headerLeft={
          <div className="flex items-center gap-4">
            <OrganizationPageTitle
              breadcrumbs={[
                { title: "Home", to: "/o/$orgSlug" },
                { title: "Projects", to: "/o/$orgSlug/projects" },
                {
                  title: projectName,
                  to: "/o/$orgSlug/projects/$projectName",
                },
              ]}
              title={title}
            />
            <Skeleton className="h-6 w-20" />
          </div>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-[calc(100vh-5rem)] w-full" />
        </div>
      </PageLayout>
    </RunsLayout>
  );
};
