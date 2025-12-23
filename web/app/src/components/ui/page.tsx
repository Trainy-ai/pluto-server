import * as React from "react";

import { cn } from "@/lib/utils";
import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";
import { SidebarTrigger } from "./sidebar";

export type PageElement = HTMLDivElement;
export type PageProps = React.HTMLAttributes<HTMLDivElement>;
const Page = React.forwardRef<PageElement, PageProps>(
  ({ children, className, ...other }, ref) => (
    <div ref={ref} className={cn("flex h-full flex-col", className)} {...other}>
      {children}
    </div>
  ),
);
Page.displayName = "Page";

export type PageHeaderElement = HTMLDivElement;
export type PageHeaderProps = React.HTMLAttributes<HTMLDivElement>;
const PageHeader = React.forwardRef<PageHeaderElement, PageHeaderProps>(
  ({ className, children, ...other }, ref) => (
    <div
      ref={ref}
      className={cn("sticky top-0 z-20 bg-background", className)}
      {...other}
    >
      {children}
    </div>
  ),
);
PageHeader.displayName = "PageHeader";

export type PagePrimaryBarElement = HTMLDivElement;
export type PagePrimaryBarProps = React.HTMLAttributes<HTMLDivElement>;

const PagePrimaryBar = React.forwardRef<
  PagePrimaryBarElement,
  PagePrimaryBarProps & { showSidebarTrigger?: boolean }
>(({ className, children, showSidebarTrigger = true, ...other }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex h-14 flex-row items-center gap-1 border-b px-4 sm:px-6",
      className,
    )}
    {...other}
  >
    {showSidebarTrigger && (
      <>
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-2 h-4" />
      </>
    )}
    <div className="flex w-full flex-row items-center justify-between">
      {children}
    </div>
  </div>
));
PagePrimaryBar.displayName = "PagePrimaryBar";

export type PageTitleElement = HTMLHeadingElement;
export type PageTitleProps = React.HTMLAttributes<HTMLHeadingElement>;
const PageTitle = React.forwardRef<PageTitleElement, PageTitleProps>(
  ({ className, children, ...other }, ref) => (
    <h1 ref={ref} className={cn("text-sm font-semibold", className)} {...other}>
      {children}
    </h1>
  ),
);
PageTitle.displayName = "PageTitle";

export type PageActionsElement = HTMLDivElement;
export type PageActionsProps = React.HTMLAttributes<HTMLDivElement>;
const PageActions = React.forwardRef<PageActionsElement, PageActionsProps>(
  ({ className, children, ...other }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2", className)}
      {...other}
    >
      {children}
    </div>
  ),
);
PageActions.displayName = "PageActions";

export type PageSecondaryBarElement = HTMLDivElement;
export type PageSecondaryBarProps = React.HTMLAttributes<HTMLDivElement>;
const PageSecondaryBar = React.forwardRef<
  PageSecondaryBarElement,
  PageSecondaryBarProps
>(({ className, children, ...other }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex h-12 items-center justify-between gap-2 border-b px-4 sm:px-6",
      className,
    )}
    {...other}
  >
    {children}
  </div>
));
PageSecondaryBar.displayName = "PageSecondaryBar";

export type PageBodyElement = HTMLDivElement;
export type PageBodyProps = React.HTMLAttributes<HTMLDivElement> & {
  disableScroll?: boolean;
};
const PageBody = React.forwardRef<PageBodyElement, PageBodyProps>(
  ({ children, className, disableScroll = false, ...other }, ref) => {
    if (disableScroll) {
      return (
        <div
          className={cn("flex h-full flex-col", className)}
          ref={ref}
          {...other}
        >
          {children}
        </div>
      );
    }

    return (
      <div
        className={cn("grow overflow-hidden", className)}
        ref={ref}
        {...other}
      >
        <ScrollArea className="h-full">{children}</ScrollArea>
      </div>
    );
  },
);
PageBody.displayName = "PageBody";

export {
  Page,
  PageActions,
  PageBody,
  PageHeader,
  PagePrimaryBar,
  PageSecondaryBar,
  PageTitle,
};
