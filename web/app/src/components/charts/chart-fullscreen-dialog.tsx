"use client";

import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartBoundsPopover } from "./chart-bounds-popover";
import { ChartExportMenu } from "./chart-export-menu";

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
  const chartContentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-[95vw] h-[90vh] flex-col p-6">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>{title}</DialogTitle>
            <div className="flex items-center gap-2">
              <ChartExportMenu
                getContainer={() => chartContentRef.current}
                fileName={title}
                variant="header"
              />
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
          </div>
        </DialogHeader>
        <div ref={chartContentRef} className="flex-1 min-h-0">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
