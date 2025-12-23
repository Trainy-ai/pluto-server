"use client";

import * as React from "react";
import { Link, useLocation, useRouterState } from "@tanstack/react-router";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarGroupProps,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { useAuth } from "@/lib/auth/client";
import {
  RiCpuLine,
  RiInformationFill,
  RiLineChartFill,
  RiNodeTree,
  RiTerminalFill,
} from "@remixicon/react";
import { DocsTooltip } from "@/components/ui/tooltip";

const mainNavItems = [
  {
    title: "Summary",
    href: "/projects/$projectName/$runId/summary",
    matchPattern: /^projects\/[^/]+\/[^/]+\/summary$/,
    icon: RiInformationFill,
    link: "https://docs.mlop.ai/docs/experiments/summary",
    description:
      "Overview of the run, you can view the configs and metadata and also shut down the run remotely",
  },
  {
    title: "Data",
    href: "/projects/$projectName/$runId",
    matchPattern: /^projects\/[^/]+\/[^/]+$/,
    icon: RiLineChartFill,
    link: "https://docs.mlop.ai/docs/experiments/visualizations",
    description: "Data logged during the training",
  },
  {
    title: "Logs",
    href: "/projects/$projectName/$runId/logs",
    matchPattern: /^projects\/[^/]+\/[^/]+\/logs$/,
    icon: RiTerminalFill,
    link: "https://docs.mlop.ai/docs/experiments/logs",
    description: "Terminal logs from the training",
  },
  {
    title: "System Metrics",
    href: "/projects/$projectName/$runId/system",
    matchPattern: /^projects\/[^/]+\/[^/]+\/system$/,
    icon: RiCpuLine,
    link: "https://docs.mlop.ai/docs/experiments/system",
    description: "System metrics from the training",
  },
  {
    title: "Model Graph",
    href: "/projects/$projectName/$runId/graph",
    matchPattern: /^projects\/[^/]+\/[^/]+\/graph$/,
    icon: RiNodeTree,
    link: "https://docs.mlop.ai/docs/experiments/visualizations/model-graph",
    description: "Visual graph of the model architecture",
  },
];

export function RunSidebar(props: SidebarGroupProps): React.JSX.Element {
  const location = useLocation();
  const pathname = location.pathname;

  const { data: auth } = useAuth();

  const slug = auth?.activeOrganization?.slug;

  if (!slug) {
    return <div>No active organization</div>;
  }

  // Extract the relevant part of the path after /o/{slug}/
  const relativePath = pathname.split(`/o/${slug}/`)[1] || "";

  return (
    <SidebarGroup {...props}>
      <SidebarMenu>
        {mainNavItems.map((item, index) => {
          const isActive = item.matchPattern.test(relativePath);

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
                    className={
                      isActive
                        ? "dark:text-foreground"
                        : "dark:text-muted-foreground"
                    }
                  >
                    {item.title}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
