import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RiShieldUserFill } from "@remixicon/react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

interface SidebarAdminProps {
  orgSlug: string;
}

/** Shown only to platform admins (PLATFORM_ADMIN_EMAILS on the server). */
export function SidebarAdmin({ orgSlug }: SidebarAdminProps): React.JSX.Element | null {
  const pathname = useRouterState().location.pathname;
  const { data } = useQuery({
    ...trpc.admin.status.queryOptions(),
    staleTime: Infinity,
  });

  if (!data?.isPlatformAdmin) {
    return null;
  }

  const isActive = pathname.endsWith("/settings/admin");

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-sm text-muted-foreground">
        Platform admin
      </SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={isActive} tooltip="Pro upgrades">
            <Link to="/o/$orgSlug/settings/admin" params={{ orgSlug }}>
              <RiShieldUserFill
                className={cn(
                  "size-4 shrink-0",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isActive ? "dark:text-foreground" : "dark:text-muted-foreground",
                )}
              >
                Pro upgrades
              </span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
