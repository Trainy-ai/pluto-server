"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";
import { ExternalLinkIcon } from "lucide-react";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit rounded-md bg-muted px-3 py-1.5 text-xs text-balance text-muted-foreground animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-muted fill-muted" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

interface UnstyledTooltipContentProps
  extends React.ComponentProps<typeof TooltipPrimitive.Content> {
  className?: string;
  sideOffset?: number;
  children: React.ReactNode;
  showArrow?: boolean;
}

function UnstyledTooltipContent({
  className,
  sideOffset = 0,
  children,
  showArrow = true,
  ...props
}: UnstyledTooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showArrow && (
          <TooltipPrimitive.Arrow
            className={cn(
              "z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-muted fill-muted",
            )}
          />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

interface DocsTooltipProps {
  title: string;
  iconComponent?: React.ReactNode;
  description?: string;
  link?: string;
}

const DocsTooltip = ({
  title,
  iconComponent,
  description,
  link,
}: DocsTooltipProps) => {
  return (
    <div className="flex w-56 flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {iconComponent && (
          <div className="text-muted-foreground">{iconComponent}</div>
        )}
        <h3 className="text-xs leading-none font-medium">{title}</h3>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex w-fit items-center gap-0.5 rounded-md bg-muted px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent/80"
          >
            Docs
            <ExternalLinkIcon className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {description && (
        <p className="text-[10px] leading-tight text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
};

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  UnstyledTooltipContent,
  DocsTooltip,
};
