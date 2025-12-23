"use client";

import * as React from "react";
// import { usePathname } from "next/navigation";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { mergeRefs } from "@/utils/merge-refs";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Separator } from "./separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";
import { Skeleton } from "./skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  UnstyledTooltipContent,
} from "./tooltip";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const MIN_SIDEBAR_WIDTH = "14rem";
const SIDEBAR_WIDTH = "15rem";
const MAX_SIDEBAR_WIDTH = "22rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "4rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
const MOBILE_BREAKPOINT = 1024;
const SIDEBAR_WIDTH_COOKIE_NAME = "sidebar_width";
const SIDEBAR_WIDTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function parseWidth(width: string): { value: number; unit: "rem" | "px" } {
  const unit = width.endsWith("rem") ? "rem" : "px";
  const value = Number.parseFloat(width);
  return { value, unit };
}

function toPx(width: string): number {
  const { value, unit } = parseWidth(width);
  return unit === "rem" ? value * 16 : value;
}

function formatWidth(value: number, unit: "rem" | "px"): string {
  return `${unit === "rem" ? value.toFixed(1) : Math.round(value)}${unit}`;
}

type UseSidebarResizeProps = {
  enableDrag?: boolean;
  onResize: (width: string) => void;
  onClick: () => void;
  currentWidth: string;
  isCollapsed: boolean;
  minResizeWidth: string;
  maxResizeWidth: string;
  setIsDraggingRail: (isDraggingRail: boolean) => void;
};

function useSidebarResize({
  enableDrag = true,
  onResize,
  onClick,
  currentWidth,
  isCollapsed,
  minResizeWidth,
  maxResizeWidth,
  setIsDraggingRail,
}: UseSidebarResizeProps) {
  const dragRef = React.useRef<HTMLButtonElement>(null);
  const isDragging = React.useRef(false);
  const startX = React.useRef(0);
  const startWidth = React.useRef(0);
  const isInteractingWithRail = React.useRef(false);
  const lastWidth = React.useRef(0);
  const lastLoggedWidth = React.useRef(0);

  const persistWidth = React.useCallback((width: string) => {
    document.cookie = `${SIDEBAR_WIDTH_COOKIE_NAME}=${width}; path=/; max-age=${SIDEBAR_WIDTH_COOKIE_MAX_AGE}`;
  }, []);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      isInteractingWithRail.current = true;

      if (!enableDrag || isCollapsed) {
        return;
      }

      startWidth.current = toPx(currentWidth);
      startX.current = e.clientX;
      lastWidth.current = startWidth.current;
      lastLoggedWidth.current = startWidth.current;
      e.preventDefault();
    },
    [enableDrag, isCollapsed, currentWidth],
  );

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isInteractingWithRail.current || isCollapsed) {
        return;
      }

      const deltaX = Math.abs(e.clientX - startX.current);
      if (!isDragging.current && deltaX > 5) {
        isDragging.current = true;
        setIsDraggingRail(true);
      }

      if (isDragging.current) {
        const { unit } = parseWidth(currentWidth);
        const minWidthPx = toPx(minResizeWidth);
        const maxWidthPx = toPx(maxResizeWidth);

        const deltaWidth = e.clientX - startX.current;
        const newWidthPx = startWidth.current + deltaWidth;
        const clampedWidthPx = Math.max(
          minWidthPx,
          Math.min(maxWidthPx, newWidthPx),
        );

        const newWidth = unit === "rem" ? clampedWidthPx / 16 : clampedWidthPx;
        const threshold = unit === "rem" ? 0.1 : 1;

        if (
          Math.abs(newWidth - lastWidth.current / (unit === "rem" ? 16 : 1)) >=
          threshold
        ) {
          const formattedWidth = formatWidth(newWidth, unit);
          onResize(formattedWidth);
          persistWidth(formattedWidth);
          lastWidth.current = clampedWidthPx;

          const logThreshold = unit === "rem" ? 1 : 16;
          if (
            Math.abs(
              newWidth - lastLoggedWidth.current / (unit === "rem" ? 16 : 1),
            ) >= logThreshold
          ) {
            lastLoggedWidth.current = clampedWidthPx;
          }
        }
      }
    };

    const handleMouseUp = (_: MouseEvent) => {
      if (!isInteractingWithRail.current) return;

      if (!isDragging.current) {
        onClick();
        persistWidth(SIDEBAR_WIDTH);
      }

      isDragging.current = false;
      isInteractingWithRail.current = false;
      lastWidth.current = 0;
      lastLoggedWidth.current = 0;
      setIsDraggingRail(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    onResize,
    onClick,
    isCollapsed,
    currentWidth,
    minResizeWidth,
    maxResizeWidth,
    persistWidth,
    setIsDraggingRail,
  ]);

  return {
    dragRef,
    isDragging,
    handleMouseDown,
  };
}

type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
  width: string;
  setWidth: (width: string) => void;
  isDraggingRail: boolean;
  setIsDraggingRail: (isDraggingRail: boolean) => void;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

function useSidebar(): SidebarContext {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

export type SidebarProviderElement = HTMLDivElement;
export type SidebarProviderProps = React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultWidth?: string;
};
const SidebarProvider = React.forwardRef<
  SidebarProviderElement,
  SidebarProviderProps
>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
      className,
      style,
      children,
      defaultWidth = SIDEBAR_WIDTH,
      ...props
    },
    ref,
  ) => {
    const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`, {
      ssr: true,
      fallback: false,
    });
    const [width, setWidth] = React.useState(defaultWidth);
    const [openMobile, setOpenMobile] = React.useState(false);
    const [isDraggingRail, setIsDraggingRail] = React.useState(false);
    // This is the internal state of the sidebar.
    // We use openProp and setOpenProp for control from outside the component.
    const [_open, _setOpen] = React.useState(defaultOpen);
    const open = openProp ?? _open;
    const setOpen = React.useCallback(
      (value: boolean | ((value: boolean) => boolean)) => {
        const openState = typeof value === "function" ? value(open) : value;
        if (setOpenProp) {
          setOpenProp(openState);
        } else {
          _setOpen(openState);
        }

        // This sets the cookie to keep the sidebar state.
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      },
      [setOpenProp, open],
    );

    const toggleSidebar = React.useCallback(() => {
      return isMobile
        ? setOpenMobile((open) => !open)
        : setOpen((open) => !open);
    }, [isMobile, setOpen]);

    // Adds a keyboard shortcut to toggle the sidebar.
    React.useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          toggleSidebar();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [toggleSidebar]);

    // We add a state so that we can do data-state="expanded" or "collapsed".
    // This makes it easier to style the sidebar with Tailwind classes.
    const state = open ? "expanded" : "collapsed";

    const contextValue = React.useMemo<SidebarContext>(
      () => ({
        state,
        open,
        setOpen,
        isMobile,
        openMobile,
        setOpenMobile,
        toggleSidebar,
        width,
        setWidth,
        isDraggingRail,
        setIsDraggingRail,
      }),
      [
        state,
        open,
        setOpen,
        isMobile,
        openMobile,
        toggleSidebar,
        width,
        isDraggingRail,
      ],
    );

    return (
      <SidebarContext.Provider value={contextValue}>
        <TooltipProvider delayDuration={0}>
          <div
            style={
              {
                "--sidebar-width": width,
                "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                ...style,
              } as React.CSSProperties
            }
            className={cn(
              "group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar",
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = "SidebarProvider";

export type SidebarElement = HTMLDivElement;
export type SidebarProps = React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
};
const Sidebar = React.forwardRef<SidebarElement, SidebarProps>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    // const pathname = usePathname();
    const { isMobile, state, openMobile, setOpenMobile, isDraggingRail } =
      useSidebar();

    React.useEffect(() => {
      setOpenMobile(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (collapsible === "none") {
      return (
        <div
          className={cn(
            "flex h-full w-[var(--sidebar-width)] flex-col bg-sidebar text-sidebar-foreground",
            className,
          )}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      );
    }

    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
          <SheetContent
            data-sidebar="sidebar"
            data-mobile="true"
            className="w-[var(--sidebar-width)] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
            style={
              {
                "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
            side={side}
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Mobile menu</SheetDescription>
            <div className="flex size-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <div
        ref={ref}
        className="group peer hidden text-sidebar-foreground md:block"
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
        data-dragging={isDraggingRail}
      >
        <div
          className={cn(
            "relative h-svh w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear",
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            variant === "floating" || variant === "inset"
              ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
              : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]",
            "group-data-[dragging=true]_*:!duration-0 group-data-[dragging=true]:!duration-0",
          )}
        />
        <div
          className={cn(
            "fixed inset-y-0 z-40 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
            side === "left"
              ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
              : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
            variant === "floating" || variant === "inset"
              ? "p-3 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
              : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l",
            "group-data-[dragging=true]_*:!duration-0 group-data-[dragging=true]:!duration-0",
            className,
          )}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Sidebar.displayName = "Sidebar";

export type SidebarTriggerElement = React.ElementRef<typeof Button>;
export type SidebarTriggerProps = React.ComponentProps<typeof Button>;
const SidebarTrigger = React.forwardRef<
  SidebarTriggerElement,
  SidebarTriggerProps
>(({ className, onClick, ...props }, ref) => {
  const { isMobile, open, toggleSidebar } = useSidebar();
  return (
    <Button
      type="button"
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn("group/sidebar-trigger size-8 px-1.5 sm:-ml-2", className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="cursor-pointer text-muted-foreground transition-transform duration-300 ease-in-out"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M5.57527 0.78924L10.4219 0.78924C11.1489 0.78924 11.7271 0.78923 12.1935 0.82734C12.6712 0.86637 13.0785 0.94801 13.4514 1.13802C14.0535 1.44481 14.5431 1.93435 14.8499 2.53646C15.0399 2.90935 15.1215 3.31669 15.1606 3.79435C15.1986 4.26079 15.1986 4.83895 15.1986 5.56591V10.4341C15.1986 11.1611 15.1986 11.7392 15.1606 12.2057C15.1215 12.6833 15.0399 13.0907 14.8499 13.4635C14.5431 14.0657 14.0535 14.5552 13.4514 14.862C13.0785 15.052 12.6712 15.1336 12.1935 15.1727C11.7271 15.2108 11.1489 15.2108 10.4219 15.2108H5.57529C4.84833 15.2108 4.27017 15.2108 3.80373 15.1727C3.32607 15.1336 2.91873 15.052 2.54584 14.862C1.94373 14.5552 1.45419 14.0657 1.1474 13.4635C0.957392 13.0907 0.875752 12.6833 0.836725 12.2057C0.798715 11.7392 0.798718 11.1611 0.798723 10.4341L0.798723 5.5659C0.798718 4.83894 0.798715 4.26079 0.836725 3.79435C0.875752 3.31669 0.957392 2.90935 1.1474 2.53646C1.45419 1.93435 1.94373 1.44481 2.54584 1.13802C2.91873 0.94801 3.32607 0.86637 3.80373 0.82734C4.27017 0.78923 4.84833 0.78924 5.57527 0.78924ZM3.89058 2.19046C3.47889 2.22409 3.22759 2.28778 3.03009 2.38842C2.62868 2.59295 2.30233 2.91931 2.0978 3.32072C1.99716 3.51822 1.93347 3.76951 1.89984 4.18121C1.86569 4.59912 1.86528 5.13369 1.86528 5.88924L1.86528 10.1104C1.86528 10.8659 1.86569 11.4005 1.89984 11.8184C1.93347 12.2301 1.99716 12.4814 2.0978 12.6789C2.30233 13.0803 2.62868 13.4067 3.03009 13.6112C3.22759 13.7118 3.47889 13.7755 3.89058 13.8092C4.3085 13.8433 4.84307 13.8437 5.59862 13.8437L10.3986 13.8437C11.1542 13.8437 11.6887 13.8433 12.1066 13.8092C12.5183 13.7755 12.7696 13.7118 12.9671 13.6112C13.3685 13.4067 13.6949 13.0803 13.8994 12.6789C14.0001 12.4814 14.0638 12.2301 14.0974 11.8184C14.1316 11.4005 14.132 10.8659 14.132 10.1104L14.132 5.88924C14.132 5.13369 14.1316 4.59912 14.0974 4.18121C14.0638 3.76951 14.0001 3.51822 13.8994 3.32072C13.6949 2.91931 13.3685 2.59295 12.9671 2.38842C12.7696 2.28778 12.5183 2.22409 12.1066 2.19046C11.6887 2.15632 11.1542 2.15591 10.3986 2.15591L5.59862 2.15591C4.84307 2.15591 4.3085 2.15632 3.89058 2.19046Z"
          fill="currentColor"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.29583 14.7329L6.29583 1.21743H7.56139L7.56139 14.7329H6.29583Z"
          fill="currentColor"
          className={cn(
            !isMobile &&
              "opacity-100 transition-opacity duration-200 ease-in-out group-hover/sidebar-trigger:opacity-0",
            open ? "translate-x-[-5%]" : "translate-x-[20%]",
          )}
        />
        {!isMobile && (
          <g style={{ transform: open ? "" : "scaleX(-1)" }}>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M5.47991 10.27751C4.97163 10.4858 4.33394 10.4858 4.12566 10.27751L2.52566 8.67751C2.31738 8.46923 2.31738 8.13154 2.52566 7.92326L4.12566 6.32326C4.33394 6.11498 4.97163 6.11498 5.47991 6.32326C5.68819 6.53154 5.68819 6.86923 5.47991 7.07751L4.79036 7.76706H7.50277C7.79413 7.76706 8.02944 8.00237 8.02944 8.29373C8.02944 8.58509 7.79413 8.82039 7.50277 8.82039H4.79036L5.47991 9.50994C5.68819 9.71822 5.68819 10.0559 5.47991 10.27751Z"
              fill="currentColor"
              className={cn(
                "origin-center opacity-0 transition-all duration-200 ease-in-out group-hover/sidebar-trigger:opacity-100",
                open
                  ? "translate-x-2 group-hover/sidebar-trigger:translate-x-0"
                  : "-translate-x-2 group-hover/sidebar-trigger:-translate-x-4",
              )}
            />
          </g>
        )}
      </svg>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

export type SidebarRailElement = React.ElementRef<typeof Button>;
export type SidebarRailProps = React.ComponentProps<"button"> & {
  enableDrag?: boolean;
};
const SidebarRail = React.forwardRef<SidebarRailElement, SidebarRailProps>(
  ({ className, enableDrag = true, ...props }, ref) => {
    const { open, toggleSidebar, setWidth, state, width, setIsDraggingRail } =
      useSidebar();

    const { dragRef, handleMouseDown } = useSidebarResize({
      enableDrag,
      onResize: setWidth,
      onClick: () => {
        if (open) {
          setWidth(SIDEBAR_WIDTH);
        } else {
          toggleSidebar();
        }
      },
      currentWidth: width,
      isCollapsed: state === "collapsed",
      minResizeWidth: MIN_SIDEBAR_WIDTH,
      maxResizeWidth: MAX_SIDEBAR_WIDTH,
      setIsDraggingRail,
    });

    const combinedRef = React.useMemo(
      () => mergeRefs(ref, dragRef),
      [ref, dragRef],
    );

    return (
      <button
        ref={combinedRef}
        data-sidebar="rail"
        aria-label="Click to restore sidebar"
        tabIndex={-1}
        onMouseDown={handleMouseDown}
        title="Click to restore sidebar"
        className={cn(
          "absolute inset-y-0 z-50 hidden w-4 -translate-x-1/2 cursor-col-resize transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex",
          "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
          "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar",
          "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
          "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarRail.displayName = "SidebarRail";

export type SidebarInsetElement = HTMLDivElement;
export type SidebarInsetProps = React.ComponentProps<"main">;
const SidebarInset = React.forwardRef<SidebarInsetElement, SidebarInsetProps>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      className={cn(
        "relative flex min-h-svh flex-1 flex-col bg-background",
        "peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2",
        className,
      )}
      {...props}
    />
  ),
);
SidebarInset.displayName = "SidebarInset";

export type SidebarInputElement = React.ElementRef<typeof Input>;
export type SidebarInputProps = React.ComponentProps<typeof Input>;
const SidebarInput = React.forwardRef<SidebarInputElement, SidebarInputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      data-sidebar="input"
      className={cn(
        "h-9 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        className,
      )}
      {...props}
    />
  ),
);
SidebarInput.displayName = "SidebarInput";

export type SidebarHeaderElement = HTMLDivElement;
export type SidebarHeaderProps = React.ComponentProps<"div">;
const SidebarHeader = React.forwardRef<
  SidebarHeaderElement,
  SidebarHeaderProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="header"
    className={cn("flex flex-col gap-2 p-3", className)}
    {...props}
  />
));
SidebarHeader.displayName = "SidebarHeader";

export type SidebarFooterElement = HTMLDivElement;
export type SidebarFooterProps = React.ComponentProps<"div">;
const SidebarFooter = React.forwardRef<
  SidebarFooterElement,
  SidebarFooterProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="footer"
    className={cn("flex flex-col gap-2 p-3", className)}
    {...props}
  />
));
SidebarFooter.displayName = "SidebarFooter";

export type SidebarSeparatorElement = React.ElementRef<typeof Separator>;
export type SidebarSeparatorProps = React.ComponentProps<typeof Separator>;
const SidebarSeparator = React.forwardRef<
  SidebarSeparatorElement,
  SidebarSeparatorProps
>(({ className, ...props }, ref) => (
  <Separator
    ref={ref}
    data-sidebar="separator"
    className={cn("mx-2 w-auto bg-sidebar-border", className)}
    {...props}
  />
));
SidebarSeparator.displayName = "SidebarSeparator";

export type SidebarContentElement = HTMLDivElement;
export type SidebarContentProps = React.ComponentProps<"div">;
const SidebarContent = React.forwardRef<
  SidebarContentElement,
  SidebarContentProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="content"
    className={cn(
      "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
      className,
    )}
    {...props}
  />
));
SidebarContent.displayName = "SidebarContent";

export type SidebarGroupElement = HTMLDivElement;
export type SidebarGroupProps = React.ComponentProps<"div">;
const SidebarGroup = React.forwardRef<SidebarGroupElement, SidebarGroupProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-3", className)}
      {...props}
    />
  ),
);
SidebarGroup.displayName = "SidebarGroup";

export type SidebarGroupLabelElement = HTMLDivElement;
export type SidebarGroupLabelProps = React.ComponentProps<"div"> & {
  asChild?: boolean;
};
const SidebarGroupLabel = React.forwardRef<
  SidebarGroupLabelElement,
  SidebarGroupLabelProps
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-sidebar="group-label"
      className={cn(
        "flex h-9 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear outline-none focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className,
      )}
      {...props}
    />
  );
});
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export type SidebarGroupActionElement = HTMLButtonElement;
export type SidebarGroupActionProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
};
const SidebarGroupAction = React.forwardRef<
  SidebarGroupActionElement,
  SidebarGroupActionProps
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-sidebar="group-action"
      className={cn(
        "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring transition-transform outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarGroupAction.displayName = "SidebarGroupAction";

export type SidebarGroupContentElement = HTMLDivElement;
export type SidebarGroupContentProps = React.ComponentProps<"div">;
const SidebarGroupContent = React.forwardRef<
  SidebarGroupContentElement,
  SidebarGroupContentProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="group-content"
    className={cn("w-full text-sm", className)}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

export type SidebarMenuElement = HTMLUListElement;
export type SidebarMenuProps = React.ComponentProps<"ul">;
const SidebarMenu = React.forwardRef<SidebarMenuElement, SidebarMenuProps>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  ),
);
SidebarMenu.displayName = "SidebarMenu";

export type SidebarMenuItemElement = HTMLLIElement;
export type SidebarMenuItemProps = React.ComponentProps<"li">;
const SidebarMenuItem = React.forwardRef<
  SidebarMenuItemElement,
  SidebarMenuItemProps
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    data-sidebar="menu-item"
    className={cn("group/menu-item relative", className)}
    {...props}
  />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

export const sidebarMenuButtonVariants = cva(
  [
    "peer/menu-button",
    "flex w-full items-center gap-2",
    "overflow-hidden rounded-md p-2.5",
    "text-left text-sm",
    "outline-none ring-sidebar-ring",
    "transition-[width,height,padding]",

    // Hover states
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",

    // Focus/Active states
    "focus-visible:ring-2",
    "active:bg-sidebar-accent active:text-sidebar-accent-foreground",

    // Disabled states
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-disabled:pointer-events-none aria-disabled:opacity-50",

    // Menu action spacing
    "group-has-[[data-sidebar=menu-action]]/menu-item:pr-8",

    // Active state styling
    "data-[active=true]:bg-sidebar-accent",
    "data-[active=true]:font-medium",
    "data-[active=true]:text-sidebar-accent-foreground",

    // Open state hover
    "data-[state=open]:hover:bg-sidebar-accent",
    "data-[state=open]:hover:text-sidebar-accent-foreground",
    "border-2",
    "border-sidebar",

    // Icon collapsible mode
    "group-data-[collapsible=icon]:!size-9",
    "group-data-[collapsible=icon]:!p-2.5",

    // Child element styling
    "[&>span:last-child]:truncate",
    "[&>svg]:size-4",
    "[&>svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-9 text-sm",
        sm: "h-8 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type SidebarMenuButtonElement = HTMLButtonElement;
export type SidebarMenuButtonProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?:
    | string
    | React.ComponentProps<typeof TooltipContent>
    | React.ReactNode;
} & VariantProps<typeof sidebarMenuButtonVariants>;
const SidebarMenuButton = React.forwardRef<
  SidebarMenuButtonElement,
  SidebarMenuButtonProps
>(
  (
    {
      asChild = false,
      isActive = false,
      variant = "default",
      size = "default",
      tooltip,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const { isMobile, state } = useSidebar();

    const button = (
      <Comp
        ref={ref}
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    );

    if (!tooltip) {
      return button;
    }

    if (typeof tooltip === "string") {
      tooltip = {
        children: tooltip,
      };
    }

    if (React.isValidElement(tooltip)) {
      return (
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <UnstyledTooltipContent
            showArrow={false}
            side="right"
            sideOffset={10}
            align="center"
            hidden={isMobile}
          >
            {tooltip}
          </UnstyledTooltipContent>
        </Tooltip>
      );
    }

    if (typeof tooltip === "object") {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            hidden={isMobile}
            {...tooltip}
          />
        </Tooltip>
      );
    }
  },
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export type SidebarMenuActionElement = HTMLButtonElement;
export type SidebarMenuActionProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
  showOnHover?: boolean;
};
const SidebarMenuAction = React.forwardRef<
  SidebarMenuActionElement,
  SidebarMenuActionProps
>(({ className, asChild = false, showOnHover = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-sidebar="menu-action"
      className={cn(
        "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring transition-transform outline-none peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground data-[state=open]:opacity-100 md:opacity-0",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuAction.displayName = "SidebarMenuAction";

export type SidebarMenuBadgeElement = HTMLDivElement;
export type SidebarMenuBadgeProps = React.ComponentProps<"div">;
const SidebarMenuBadge = React.forwardRef<
  SidebarMenuBadgeElement,
  SidebarMenuBadgeProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="menu-badge"
    className={cn(
      "pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none",
      "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
      "peer-data-[size=sm]/menu-button:top-1",
      "peer-data-[size=default]/menu-button:top-1.5",
      "peer-data-[size=lg]/menu-button:top-2.5",
      "group-data-[collapsible=icon]:hidden",
      className,
    )}
    {...props}
  />
));
SidebarMenuBadge.displayName = "SidebarMenuBadge";

export type SidebarMenuSkeletonElement = HTMLDivElement;
export type SidebarMenuSkeletonProps = React.ComponentProps<"div"> & {
  showIcon?: boolean;
};
const SidebarMenuSkeleton = React.forwardRef<
  SidebarMenuSkeletonElement,
  SidebarMenuSkeletonProps
>(({ className, showIcon = false, ...props }, ref) => {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`;
  }, []);
  return (
    <div
      ref={ref}
      data-sidebar="menu-skeleton"
      className={cn("flex h-9 items-center gap-2 rounded-md px-2.5", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-[var(--skeleton-width)] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

export type SidebarMenuSubElement = HTMLUListElement;
export type SidebarMenuSubProps = React.ComponentProps<"ul">;
const SidebarMenuSub = React.forwardRef<
  SidebarMenuSubElement,
  SidebarMenuSubProps
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu-sub"
    className={cn(
      "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
      "group-data-[collapsible=icon]:hidden",
      className,
    )}
    {...props}
  />
));
SidebarMenuSub.displayName = "SidebarMenuSub";

export type SidebarMenuSubItemElement = HTMLLIElement;
export type SidebarMenuSubItemProps = React.ComponentProps<"li">;
const SidebarMenuSubItem = React.forwardRef<
  SidebarMenuSubItemElement,
  SidebarMenuSubItemProps
>(({ ...props }, ref) => <li ref={ref} {...props} />);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

export type SidebarMenuSubButtonElement = HTMLAnchorElement;
export type SidebarMenuSubButtonProps = React.ComponentProps<"a"> & {
  asChild?: boolean;
  size?: "sm" | "md";
  isActive?: boolean;
};
const SidebarMenuSubButton = React.forwardRef<
  SidebarMenuSubButtonElement,
  SidebarMenuSubButtonProps
>(({ asChild = false, size = "md", isActive, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      ref={ref}
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2.5 text-sidebar-foreground ring-sidebar-ring outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
