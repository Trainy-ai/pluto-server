import { SidebarInset } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OrgDetails } from "@/components/layout/common/org-details";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Suspense, type PropsWithChildren } from "react";
import { UserDetails } from "@/components/layout/common/user-details";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { parseCookies } from "@/utils/cookie";
import { Skeleton } from "@/components/ui/skeleton";
import { RunSidebar } from "./sidebar";

interface RunsLayoutProps extends PropsWithChildren {}

const RunsLayout = ({ children }: RunsLayoutProps) => {
  const cookies = parseCookies();
  const { data, isPending } = useQuery(trpc.auth.queryOptions());
  const activeOrganization = data?.activeOrganization;

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <SidebarProvider
        defaultOpen={false}
        open={false}
        defaultWidth={cookies["sidebar:width"] || "14rem"}
      >
        <Sidebar collapsible="icon">
          <SidebarHeader className="flex h-14 flex-row items-center py-0">
            {isPending || !activeOrganization ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <Suspense fallback={<Skeleton className="h-8 w-full" />}>
                <OrgDetails
                  organization={{
                    id: activeOrganization?.id ?? "",
                    name: activeOrganization?.name ?? "",
                    slug: activeOrganization?.slug ?? "",
                    createdAt: new Date(activeOrganization?.createdAt),
                    logo: activeOrganization?.logo ?? "",
                  }}
                />
              </Suspense>
            )}
          </SidebarHeader>
          <SidebarContent className="overflow-hidden">
            <ScrollArea
              verticalScrollBar
              className="h-full [&>[data-radix-scroll-area-viewport]>div]:!flex [&>[data-radix-scroll-area-viewport]>div]:h-full [&>[data-radix-scroll-area-viewport]>div]:flex-col"
            >
              <RunSidebar />
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
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};

export default RunsLayout;
