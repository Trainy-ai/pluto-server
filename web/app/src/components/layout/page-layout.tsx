import {
  Page,
  PageActions,
  PageHeader,
  PageSecondaryBar,
  PagePrimaryBar,
  PageBody,
} from "@/components/ui/page";
import React from "react";
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
}: PageLayoutProps) => {
  return (
    <Page>
      <PageHeader>
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
      <PageBody>{children}</PageBody>
    </Page>
  );
};

export default PageLayout;
