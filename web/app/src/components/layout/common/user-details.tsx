"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon, LogOutIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarGroupProps,
} from "@/components/ui/sidebar";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/lib/auth/sign";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/client";
import { RiKeyFill, RiSettingsFill, RiUser3Fill } from "@remixicon/react";
import { cn } from "@/lib/utils";

export type UserDetailsProps = SidebarGroupProps & {};

export function UserDetails({ ...other }: UserDetailsProps): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: auth, isPending } = useAuth();

  if (!auth || isPending) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }

  const profile = auth.user;

  return (
    <SidebarGroup {...other}>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                className={cn(
                  "group/UserButton -ml-1.5 transition-none",
                  "group-data-[collapsible=icon]:ml-0",
                  "group-data-[collapsible=icon]:rounded-full",
                  "group-data-[collapsible=icon]:!p-1",
                  "data-[state=open]:bg-sidebar-accent",
                  "data-[state=open]:text-sidebar-accent-foreground",
                )}
              >
                <Avatar className="size-7 rounded-full">
                  <AvatarImage
                    src={profile.image ?? undefined}
                    alt={profile.name}
                  />
                  <AvatarFallback className="rounded-full text-xs group-hover/UserButton:bg-neutral-200 dark:group-hover/UserButton:bg-neutral-700">
                    {profile.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex w-full flex-col truncate text-left group-data-[minimized=true]:hidden">
                  <span className="truncate text-sm font-semibold">
                    {profile.name}
                  </span>
                </div>
                <MoreHorizontalIcon className="h-8 text-muted-foreground group-data-[minimized=true]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64 bg-background"
              align="start"
              forceMount
            >
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="truncate text-sm font-medium">{profile.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {profile.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() =>
                    // @ts-ignore
                    navigate({ to: "/o/$orgSlug/settings/account" })
                  }
                >
                  <RiUser3Fill className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/api-keys" })}
                >
                  <RiKeyFill className="mr-2 h-4 w-4" />
                  API Keys
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() =>
                    // @ts-ignore
                    navigate({ to: "/o/$orgSlug/settings/org" })
                  }
                >
                  <RiSettingsFill className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="flex cursor-default flex-row justify-between !bg-transparent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center">Theme</div>
                  <ThemeSwitcher />
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                onClick={async () => {
                  await signOut(() => queryClient.invalidateQueries());
                  window.location.href = "/";
                }}
              >
                <LogOutIcon className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
