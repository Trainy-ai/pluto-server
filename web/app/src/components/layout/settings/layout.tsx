import {
  SidebarFooter,
  SidebarInset,
  SidebarRail,
} from "@/components/ui/sidebar";

import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarContent } from "@/components/ui/sidebar";

import { Sidebar, SidebarHeader } from "@/components/ui/sidebar";

import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarProfile } from "./sidebar-profile";
import { SidebarOrg } from "./sidebar-org";
import { UserDetails } from "@/components/layout/common/user-details";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import {
  PageActions,
  PageBody,
  PageHeader,
  PagePrimaryBar,
} from "@/components/ui/page";
import { Page } from "@/components/ui/page";

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  const router = useRouterState();
  const isOrgSubRoute = router.location.pathname.includes("/o/");
  // if org sub route, get the org slug
  const orgSlug = isOrgSubRoute
    ? router.location.pathname.split("/o/")[1].split("/")[0]
    : null;

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <SidebarProvider defaultOpen={true} defaultWidth={"14rem"}>
        <Sidebar collapsible="icon">
          <SidebarHeader className="flex h-14 flex-row items-center py-0">
            <Link
              to={isOrgSubRoute ? "/o/$orgSlug" : "/"}
              params={{ orgSlug: orgSlug ?? "" }}
              className="flex h-10 w-fit flex-row items-center gap-2 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center"
            >
              <ChevronLeftIcon className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:ml-0" />
              <span className="text-sm font-semibold group-data-[collapsible=icon]:hidden">
                Settings
              </span>
            </Link>
          </SidebarHeader>
          <SidebarContent className="overflow-hidden">
            <ScrollArea
              verticalScrollBar
              className="h-full [&>[data-radix-scroll-area-viewport]>div]:!flex [&>[data-radix-scroll-area-viewport]>div]:h-full [&>[data-radix-scroll-area-viewport]>div]:flex-col"
            >
              <SidebarProfile isOrgSubRoute={isOrgSubRoute} />
              {isOrgSubRoute && <SidebarOrg />}
            </ScrollArea>
          </SidebarContent>
          <SidebarFooter className="h-14">
            <UserDetails className="p-0" />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset
          id="skip"
          className="size-full lg:peer-data-[state=collapsed]:max-w-[calc(100svw-var(--sidebar-width-icon))] lg:peer-data-[state=expanded]:max-w-[calc(100svw-var(--sidebar-width))]"
        >
          <Page>
            <PageHeader>
              <PagePrimaryBar>
                <PageActions></PageActions>
              </PagePrimaryBar>
            </PageHeader>
            <PageBody>{children}</PageBody>
          </Page>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
