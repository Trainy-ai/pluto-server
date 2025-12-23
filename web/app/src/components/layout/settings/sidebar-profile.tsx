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
import { RiSettingsFill, RiUser3Fill } from "@remixicon/react";
const mainNavItems = [
  {
    title: "Profile",
    href: "/settings/account",
    icon: RiUser3Fill,
  },
  // {
  //   title: "Preferences",
  //   href: "/settings/account/preferences",
  //   icon: RiSettingsFill,
  // },
];

interface SidebarProfileProps extends SidebarGroupProps {
  isOrgSubRoute: boolean;
}

export function SidebarProfile({
  isOrgSubRoute,
  ...props
}: SidebarProfileProps): React.JSX.Element {
  const router = useRouterState();
  const pathname = router.location.pathname;
  const { data: auth } = useAuth();

  const slug = auth?.activeOrganization?.slug;

  if (!slug && !isOrgSubRoute) {
    return <div>No active organization</div>;
  }

  return (
    <SidebarGroup {...props}>
      <SidebarGroupLabel className="text-sm text-muted-foreground">
        Account
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
                <Link
                  to={isOrgSubRoute ? "/o/$orgSlug" + item.href : item.href}
                  preload="intent"
                  params={{ orgSlug: slug ?? undefined }}
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
      </SidebarMenu>
    </SidebarGroup>
  );
}
