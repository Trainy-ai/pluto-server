import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

const spinnerVariants = cva("flex-col items-center justify-center", {
  variants: {
    show: {
      true: "flex",
      false: "hidden",
    },
  },
  defaultVariants: {
    show: true,
  },
});

const loaderVariants = cva("animate-spin text-primary", {
  variants: {
    size: {
      small: "size-6 shrink-0",
      medium: "size-8 shrink-0",
      large: "size-12 shrink-0",
    },
  },
  defaultVariants: {
    size: "medium",
  },
});

export type SpinnerProps = VariantProps<typeof spinnerVariants> &
  VariantProps<typeof loaderVariants> & {
    className?: string;
    children?: React.ReactNode;
  };
function Spinner({
  size,
  show,
  children,
  className,
}: SpinnerProps): React.JSX.Element {
  return (
    <span className={spinnerVariants({ show })}>
      <Loader2Icon className={cn(loaderVariants({ size }), className)} />
      {children}
    </span>
  );
}

export type CenteredSpinnerProps = SpinnerProps & {
  containerClassName?: React.HTMLAttributes<HTMLDivElement>["className"];
};
function CenteredSpinner({
  containerClassName,
  ...props
}: CenteredSpinnerProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center opacity-65 select-none",
        containerClassName,
      )}
    >
      <Spinner {...props} />
    </div>
  );
}
CenteredSpinner.displayName = "CenteredSpinner";

export { CenteredSpinner, Spinner };
