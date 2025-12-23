"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type SheetProps = React.ComponentProps<typeof SheetPrimitive.Root>;
const Sheet = SheetPrimitive.Root;

export type SheetTriggerElement = React.ElementRef<
  typeof SheetPrimitive.Trigger
>;
export type SheetTriggerProps = React.ComponentProps<
  typeof SheetPrimitive.Trigger
>;
const SheetTrigger = SheetPrimitive.Trigger;

export type SheetCloseElement = React.ElementRef<typeof SheetPrimitive.Close>;
export type SheetCloseProps = React.ComponentProps<typeof SheetPrimitive.Close>;
const SheetClose = SheetPrimitive.Close;

export type SheetPortalProps = React.ComponentProps<
  typeof SheetPrimitive.Portal
>;
const SheetPortal = SheetPrimitive.Portal;

export type SheetOverlayElement = React.ElementRef<
  typeof SheetPrimitive.Overlay
>;
export type SheetOverlayProps = React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Overlay
>;
const SheetOverlay = React.forwardRef<SheetOverlayElement, SheetOverlayProps>(
  ({ className, ...props }, ref) => (
    <SheetPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
      ref={ref}
    />
  ),
);
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

export type SheetContentElement = React.ElementRef<
  typeof SheetPrimitive.Content
>;
export type SheetContentProps = React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Content
> &
  VariantProps<typeof sheetVariants> & {
    hideClose?: boolean;
  };
const SheetContent = React.forwardRef<SheetContentElement, SheetContentProps>(
  ({ side = "right", hideClose, className, children, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {!hideClose && (
          <SheetPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-secondary">
            <XIcon className="size-4 shrink-0" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

export type SheetHeaderElement = HTMLDivElement;
export type SheetHeaderProps = React.HTMLAttributes<HTMLDivElement>;
const SheetHeader = ({ className, ...props }: SheetHeaderProps) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

export type SheetFooterElement = HTMLDivElement;
export type SheetFooterProps = React.HTMLAttributes<HTMLDivElement>;
const SheetFooter = ({ className, ...props }: SheetFooterProps) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

export type SheetTitleElement = React.ElementRef<typeof SheetPrimitive.Title>;
export type SheetTitleProps = React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Title
>;
const SheetTitle = React.forwardRef<SheetTitleElement, SheetTitleProps>(
  ({ className, ...props }, ref) => (
    <SheetPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    />
  ),
);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

export type SheetDescriptionElement = React.ElementRef<
  typeof SheetPrimitive.Description
>;
export type SheetDescriptionProps = React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Description
>;
const SheetDescription = React.forwardRef<
  SheetDescriptionElement,
  SheetDescriptionProps
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
