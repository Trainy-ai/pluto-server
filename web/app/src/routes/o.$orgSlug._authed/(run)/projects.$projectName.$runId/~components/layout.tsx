import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import RunsLayout from "@/components/layout/run/layout";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useState, type PropsWithChildren } from "react";
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
import { AlertTriangle } from "lucide-react";

type Run = inferOutput<typeof trpc.runs.get>;

interface LayoutProps extends PropsWithChildren {
  run: Run;
  projectName: string;
  runId: string;
  title: string;
  organizationId: string;
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
}: LayoutProps) => {
  return (
    <RunsLayout>
      <PageLayout
        headerLeft={
          <div className="flex items-center gap-4">
            <OrganizationPageTitle
              breadcrumbs={[
                { title: "Home", to: "/o/$orgSlug" },
                { title: "Projects", to: "/o/$orgSlug/projects" },
                { title: projectName, to: "/o/$orgSlug/projects/$projectName" },
                {
                  title: runId,
                  to: "/o/$orgSlug/projects/$projectName/$runId",
                },
              ]}
              title={title}
            />
            <RunStatusBadge run={run} />
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
