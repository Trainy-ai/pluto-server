import {
  Page,
  PageActions,
  PageHeader,
  PageSecondaryBar,
  PagePrimaryBar,
  PageBody,
} from "@/components/ui/page";
import React, { useState } from "react";
import { InviteUser } from "@/components/layout/common/invite-user-button";
import { NotificationsDropdown } from "@/components/layout/common/notifications-list";
import { Feedback } from "@/components/layout/common/feedback";
import { useAuth } from "@/lib/auth/client";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

interface PageLayoutProps {
  children: React.ReactNode;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  secondaryBar?: React.ReactNode;
  showSidebarTrigger?: boolean;
  disableScroll?: boolean;
}

const WarningBar = () => {
  return (
    <div className="flex h-8 w-full items-center justify-center gap-2 bg-amber-500 font-mono text-sm text-gray-50 dark:bg-amber-900">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      Warning: You are approaching your organization's usage limit
    </div>
  );
};

const AtLimitBar = () => {
  return (
    <div className="flex h-8 w-full items-center justify-center gap-2 bg-red-400 font-mono text-sm text-gray-50 dark:bg-red-900">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      Warning: You have reached your organization's usage limit
    </div>
  );
};

const MAINTENANCE_DISMISS_KEY = "maintenance-banner-dismissed-2026-04-08";

const MaintenanceBanner = () => {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(MAINTENANCE_DISMISS_KEY) === "1"; } catch { return false; }
  });
  const maintenanceEnd = new Date("2026-04-08T23:00:00Z"); // Apr 8 3PM PST = 11PM UTC
  if (dismissed || Date.now() > maintenanceEnd.getTime()) {
    return null;
  }

  return (
    <div data-testid="maintenance-banner" className="relative flex w-full flex-col items-center gap-0.5 bg-blue-600 px-8 py-1.5 font-mono text-[11px] text-white dark:bg-blue-900">
      <button
        onClick={() => { setDismissed(true); try { localStorage.setItem(MAINTENANCE_DISMISS_KEY, "1"); } catch {} }}
        data-testid="maintenance-banner-dismiss"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-blue-500"
        aria-label="Dismiss banner"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="flex items-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-semibold">Scheduled Maintenance: Wednesday April 8th, 2:00–3:00 PM PST</span>
      </div>
      <p className="text-center text-blue-100">
        Postgres migrations — write operations (new runs, tags) may be disrupted. Reads and metric ingestion unaffected.{" "}
        <a href="https://status.trainy.ai/status/trainy" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-2 hover:text-blue-200">Track status →</a>
      </p>
    </div>
  );
};

const AlertBar = () => {
  const { data: auth } = useAuth();
  const activeOrg = auth?.activeOrganization;
  const { data: usage } = useQuery({
    ...trpc.organization.usage.dataUsage.queryOptions({
      organizationId: activeOrg?.id || "",
    }),
  });

  const percentUsage = usage?.percentUsage;

  if (percentUsage && percentUsage >= 100) {
    return <AtLimitBar />;
  }

  if (percentUsage && percentUsage >= 80) {
    return <WarningBar />;
  }

  return null;
};

const PageLayout = ({
  children,
  headerLeft,
  headerRight,
  secondaryBar,
  showSidebarTrigger = true,
  disableScroll = false,
}: PageLayoutProps) => {
  return (
    <Page>
      <PageHeader>
        <MaintenanceBanner />
        <AlertBar />
        <PagePrimaryBar showSidebarTrigger={showSidebarTrigger}>
          <div className="flex items-center gap-4">{headerLeft}</div>
          <PageActions className="flex items-center gap-2">
            {headerRight}
            <div className="hidden sm:block">
              <InviteUser variant="outline" />
            </div>
            <div className="sm:hidden">
              <InviteUser size="icon" variant="outline" />
            </div>
            <Feedback showText={false} className="size-9" />
            <NotificationsDropdown />
          </PageActions>
        </PagePrimaryBar>
        {secondaryBar && <PageSecondaryBar>{secondaryBar}</PageSecondaryBar>}
      </PageHeader>
      <PageBody disableScroll={disableScroll}>{children}</PageBody>
    </Page>
  );
};

export default PageLayout;
