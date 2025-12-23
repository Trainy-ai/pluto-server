"use client";

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, InfoIcon } from "lucide-react";

import { PageTitle } from "@/components/ui/page";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import React from "react";

export type BreadcrumbLink = {
  title: string;
  to: string;
};

export type OrganizationPageTitleProps = {
  breadcrumbs?: BreadcrumbLink[];
  title: string;
  info?: string;
};

export function OrganizationPageTitle({
  breadcrumbs,
  title,
  info,
}: OrganizationPageTitleProps): React.JSX.Element {
  return (
    <div className="flex flex-row items-center gap-2">
      {breadcrumbs?.map((crumb, index) => (
        <React.Fragment key={index}>
          <Link
            className="text-sm font-semibold hover:underline"
            to={crumb.to}
            preload="intent"
          >
            {crumb.title}
          </Link>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </React.Fragment>
      ))}
      <PageTitle>{title}</PageTitle>
      {info && (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <InfoIcon className="hidden size-3.5 shrink-0 text-muted-foreground sm:inline" />
          </TooltipTrigger>
          <TooltipContent>{info}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
