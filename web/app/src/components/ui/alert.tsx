import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-foreground [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&svg~*]:pl-7 shadow-sm transition-colors",
  {
    variants: {
      variant: {
        default: "bg-background border-border/50 dark:border-border/20",
        info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-200",
        warning:
          "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-200",
        destructive:
          "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-destructive/10 dark:text-red-200 [&>svg]:text-red-600 dark:[&>svg]:text-red-200",
        success:
          "border-green-200 bg-green-50 text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200 [&>svg]:text-green-600 dark:[&>svg]:text-green-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertElement = HTMLDivElement;
export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants>;
const Alert = React.forwardRef<AlertElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  ),
);
Alert.displayName = "Alert";

export type AlertTitleElement = HTMLHeadingElement;
export type AlertTitleProps = React.HTMLAttributes<HTMLHeadingElement>;
const AlertTitle = React.forwardRef<AlertTitleElement, AlertTitleProps>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn(
        "mb-1 text-base leading-none font-medium tracking-tight",
        className,
      )}
      {...props}
    />
  ),
);
AlertTitle.displayName = "AlertTitle";

export type AlertDescriptionElement = HTMLDivElement;
export type AlertDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;
const AlertDescription = React.forwardRef<
  AlertDescriptionElement,
  AlertDescriptionProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm opacity-90 [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
