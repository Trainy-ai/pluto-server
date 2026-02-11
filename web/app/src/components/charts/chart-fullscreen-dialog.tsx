"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartBoundsPopover } from "./chart-bounds-popover";

interface ChartFullscreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  /** When provided, renders a bounds popover in the header */
  yMin?: number;
  yMax?: number;
  onBoundsChange?: (yMin?: number, yMax?: number) => void;
}

export function ChartFullscreenDialog({
  open,
  onOpenChange,
  title,
  children,
  yMin,
  yMax,
  onBoundsChange,
}: ChartFullscreenDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-[95vw] h-[90vh] flex-col p-6">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>{title}</DialogTitle>
            {onBoundsChange && (
              <ChartBoundsPopover
                yMin={yMin}
                yMax={yMax}
                onBoundsChange={onBoundsChange}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  data-testid="chart-fullscreen-bounds-btn"
                >
                  <SlidersHorizontalIcon className="size-3.5" />
                  Y-Axis Bounds
                </Button>
              </ChartBoundsPopover>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
