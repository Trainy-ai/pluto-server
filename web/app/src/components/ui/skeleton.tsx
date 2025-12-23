import * as React from "react";

import { cn } from "@/lib/utils";

export type SkeletonElement = HTMLDivElement;
export type SkeletonProps = React.HtmlHTMLAttributes<HTMLDivElement>;
const Skeleton = React.forwardRef<SkeletonElement, SkeletonProps>(
  ({ className, ...other }, ref) => (
    <div
      ref={ref}
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...other}
    />
  ),
);
Skeleton.displayName = "SettingsSections";

export { Skeleton };
