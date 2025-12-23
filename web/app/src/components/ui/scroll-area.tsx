"use client";

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import {
  useMediaQuery,
  type UseMediaQueryOptions,
} from "@/lib/hooks/use-media-query";

import { cn } from "@/lib/utils";

export type ScrollAreaElement = React.ElementRef<
  typeof ScrollAreaPrimitive.Root
>;
export type ScrollAreaProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> & {
  verticalScrollBar?: boolean;
  horizontalScrollBar?: boolean;
};
const ScrollArea = React.forwardRef<ScrollAreaElement, ScrollAreaProps>(
  (
    {
      verticalScrollBar = true,
      horizontalScrollBar = false,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      {verticalScrollBar && <ScrollBar forceMount orientation="vertical" />}
      {horizontalScrollBar && <ScrollBar forceMount orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
);

ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

export type ScrollBarElement = React.ElementRef<
  typeof ScrollAreaPrimitive.ScrollAreaScrollbar
>;
export type ScrollBarProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.ScrollAreaScrollbar
>;
const ScrollBar = React.forwardRef<ScrollBarElement, ScrollBarProps>(
  ({ className, orientation = "vertical", ...props }, ref) => (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        "relative z-20 flex touch-none transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent p-px",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-px",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  ),
);
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export type ResponsiveScrollAreaElement = HTMLDivElement;
export type ResponsiveScrollAreaProps = ScrollAreaProps & {
  breakpoint: string;
  mediaQueryOptions?: UseMediaQueryOptions;
  fallbackProps?: React.HTMLAttributes<HTMLDivElement>;
};
const ResponsiveScrollArea = React.forwardRef<
  ResponsiveScrollAreaElement,
  ResponsiveScrollAreaProps
>(
  (
    {
      breakpoint,
      mediaQueryOptions,
      children,
      fallbackProps,
      ...scrollAreaProps
    },
    ref,
  ) => {
    const isBreakpointMatched = useMediaQuery(breakpoint, mediaQueryOptions);

    if (isBreakpointMatched) {
      return (
        <ScrollArea ref={ref} {...scrollAreaProps}>
          {children}
        </ScrollArea>
      );
    }

    return (
      <div ref={ref} {...fallbackProps}>
        {children}
      </div>
    );
  },
);
ResponsiveScrollArea.displayName = "ResponsiveScrollArea";

export { ResponsiveScrollArea, ScrollArea, ScrollBar };
