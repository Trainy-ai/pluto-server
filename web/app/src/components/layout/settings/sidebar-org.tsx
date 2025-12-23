"use client";

import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarGroupProps,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { useAuth } from "@/lib/auth/client";
import {
  RiBankCardFill,
  RiGroupFill,
  RiSettings3Fill,
  RiTerminalBoxFill,
  RiUser3Fill,
} from "@remixicon/react";

const mainNavItems = [
  {
    title: "General",
    href: "/settings/org",
    icon: RiSettings3Fill,
  },
  {
    title: "Members",
    href: "/settings/org/members",
    icon: RiGroupFill,
  },
  {
    title: "Developers",
    href: "/settings/org/developers",
    icon: RiTerminalBoxFill,
  },
  {
    title: "Billing",
    href: "/settings/org/billing",
    icon: RiBankCardFill,
  },
];

export function SidebarOrg(props: SidebarGroupProps): React.JSX.Element {
  const router = useRouterState();
  const pathname = router.location.pathname;
  const { data: auth } = useAuth();

  const slug = auth?.activeOrganization?.slug;

  if (!slug) {
    return <div>No active organization</div>;
  }

  return (
    <SidebarGroup {...props}>
      <SidebarGroupLabel className="text-sm text-muted-foreground">
        Organization
      </SidebarGroupLabel>
      <SidebarMenu>
        {mainNavItems.map((item, index) => {
          const isActive = pathname.endsWith(item.href);
          return (
            <SidebarMenuItem key={index}>
              <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip={item.title}
              >
                <Link to={"/o/$orgSlug" + item.href} params={{ orgSlug: slug }}>
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
      </SidebarMenu>
    </SidebarGroup>
  );
}
