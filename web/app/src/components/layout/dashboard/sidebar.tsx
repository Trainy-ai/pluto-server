"use client";

import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarGroupProps,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { DocsTooltip } from "@/components/ui/tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  UnstyledTooltipContent,
} from "@/components/ui/tooltip";
import { InfoIcon } from "lucide-react";

import { useAuth } from "@/lib/auth/client";
import {
  RiDashboardFill,
  RiFolderFill,
  RiSettings3Fill,
} from "@remixicon/react";
import { useLatestRuns } from "./queries";
import { Separator } from "@/components/ui/separator";

type Run = inferOutput<typeof trpc.runs.latest>[0];
type RunStatus = Run["status"];

interface LatestRunItemProps {
  run: Run;
  orgSlug: string;
}

export function StatusIndicator({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const statusConfig = {
    COMPLETED: {
      description: "The run completed successfully.",
    },
    FAILED: {
      description: "The run failed for unknown reasons.",
    },
    TERMINATED: {
      description: "The run was terminated by the user.",
    },
    RUNNING: {
      description: "The run is currently running.",
    },
    CANCELLED: {
      description: "The run was cancelled by the user.",
    },
  } as const;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">
            <div
              className={cn(
                "relative z-30 size-2 shrink-0 rounded-full",
                {
                  "bg-green-500": status === "COMPLETED",
                  "bg-blue-500": status === "RUNNING",
                  "bg-red-500":
                    status === "FAILED" ||
                    status === "TERMINATED" ||
                    status === "CANCELLED",
                },
                "duration-100 hover:scale-130 hover:transition-transform",
                className,
              )}
            />
            {status === "RUNNING" && (
              <div className="absolute inset-0">
                <div className="size-2 animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-blue-500/50" />
              </div>
            )}
          </div>
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
            description={statusConfig[status].description}
            link={`https://docs.mlop.ai/docs/experiments/status`}
          />
        </UnstyledTooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LatestRunItemSkeleton() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <div className="flex w-full items-center gap-x-2">
          <div className="size-2 animate-pulse rounded-full bg-muted" />
          <div className="flex min-w-0 flex-1 items-baseline gap-x-1 font-mono">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <span className="shrink-0 text-xs text-muted-foreground">/</span>
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function LatestRunItem({ run, orgSlug }: LatestRunItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <div className="flex w-full items-center gap-x-2">
          <StatusIndicator status={run.status} />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="group flex min-w-0 flex-1 items-baseline gap-x-1 font-mono">
                  <Link
                    to={"/o/$orgSlug/projects/$projectName"}
                    params={{
                      orgSlug,
                      projectName: run.project.name,
                    }}
                    preload="intent"
                    className="truncate text-xs text-muted-foreground hover:underline"
                  >
                    {run.project.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    /
                  </span>
                  <Link
                    to={"/o/$orgSlug/projects/$projectName/$runId"}
                    params={{
                      orgSlug,
                      projectName: run.project.name,
                      runId: run.id,
                    }}
                    preload="intent"
                    className="truncate text-xs hover:underline"
                  >
                    {run.name}
                  </Link>
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={12}
                className="max-w-[300px] break-all"
              >
                <span className="font-mono text-xs">
                  {run.project.name}/{run.name}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const mainNavItems = [
  {
    title: "Dashboard",
    href: "/",
    description: "The home page for your organization",
    // link: "https://docs.mlop.ai",
    icon: RiDashboardFill,
  },
  {
    title: "Projects",
    href: "/projects",
    description: "Projects that are associated with your organization",
    link: "https://docs.mlop.ai/docs/experiments/projects",
    icon: RiFolderFill,
  },
  {
    title: "Settings",
    href: "/settings",
    description: "Manage your organization and account settings",
    // link: "https://docs.mlop.ai/settings",
    icon: RiSettings3Fill,
  },
];

export function DashboardSidebar(props: SidebarGroupProps): React.JSX.Element {
  const router = useRouterState();
  const pathname = router.location.pathname;
  const { data: auth } = useAuth();
  const { state } = useSidebar();

  const slug = auth?.activeOrganization?.slug;

  if (!slug || !auth?.activeOrganization?.id) {
    return <div>No active organization</div>;
  }

  const { data: latestRuns, isLoading: isLatestRunsLoading } = useLatestRuns(
    auth.activeOrganization.id,
  );

  return (
    <SidebarGroup {...props}>
      <SidebarMenu>
        {mainNavItems.map((item, index) => {
          const isActive =
            item.href === "/"
              ? pathname.split("/").length == 3
              : pathname.endsWith(item.href);

          if (item.title === "Projects") {
            return (
              <SidebarMenuItem key={index}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={
                    <DocsTooltip
                      title={item.title}
                      iconComponent={<item.icon className="size-4" />}
                      description={item.description}
                      link={item.link}
                    />
                  }
                  className="flex-1"
                >
                  <Link
                    to={"/o/$orgSlug/projects"}
                    params={{ orgSlug: slug }}
                    preload="intent"
                  >
                    <item.icon
                      className={cn(
                        "size-4 shrink-0",
                        isActive ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        isActive
                          ? "dark:text-foreground"
                          : "dark:text-muted-foreground",
                      )}
                    >
                      {item.title}
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }

          return (
            <SidebarMenuItem key={index}>
              <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip={
                  <DocsTooltip
                    title={item.title}
                    iconComponent={<item.icon className="size-4" />}
                    description={item.description}
                    link={item.link}
                  />
                }
              >
                <Link
                  to={"/o/$orgSlug" + item.href}
                  params={{ orgSlug: slug }}
                  preload="intent"
                >
                  <item.icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "font-medium",
                      isActive
                        ? "dark:text-foreground"
                        : "dark:text-muted-foreground",
                    )}
                  >
                    {item.title}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
        {state === "expanded" && (
          <>
            <Separator className="my-2 w-[90%] self-center" />
            <div className="px-3">
              <h2 className="mb-2 text-sm font-semibold tracking-tight text-muted-foreground">
                Latest Runs
              </h2>
            </div>
            {isLatestRunsLoading ? (
              <>
                {Array.from({ length: 10 }).map((_, index) => (
                  <LatestRunItemSkeleton key={index} />
                ))}
              </>
            ) : latestRuns && latestRuns.length > 0 ? (
              latestRuns.map((run) => (
                <LatestRunItem key={run.id} run={run} orgSlug={slug} />
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No recent runs
              </div>
            )}
          </>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
