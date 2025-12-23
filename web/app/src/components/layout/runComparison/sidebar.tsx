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
  RiBubbleChartFill,
  RiCpuLine,
  RiInformationFill,
  RiLineChartFill,
  RiNodeTree,
  RiTableFill,
  RiTerminalFill,
} from "@remixicon/react";
import { DocsTooltip } from "@/components/ui/tooltip";

const mainNavItems = [
  {
    title: "Compare",
    href: "/projects/$projectName",
    matchPattern: /^projects\/[^/]+$/,
    icon: RiBubbleChartFill,
    // TODO: Add link
    link: "https://docs.mlop.ai/docs/experiments/visualizations",
    description:
      "Overview of the run, you can view the configs and metadata and also shut down the run remotely",
  },
  {
    title: "Table",
    href: "/projects/$projectName/table",
    matchPattern: /^projects\/[^/]+\/table$/,
    icon: RiTableFill,
    // TODO: Add link
    link: "https://docs.mlop.ai/docs/experiments/visualizations",
    description: "Data logged during the training",
  },
];

export function RunComparisonSidebar(
  props: SidebarGroupProps,
): React.JSX.Element {
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
