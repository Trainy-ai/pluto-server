"use client";

import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MediaFullscreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}

export function MediaFullscreenDialog({
  open,
  onOpenChange,
  title,
  children,
}: MediaFullscreenDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-focus the slider thumb so arrow keys work immediately
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const slider = contentRef.current?.querySelector<HTMLElement>(
        '[role="slider"]'
      );
      if (slider) {
        slider.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-[95vw] h-[90vh] flex-col p-6 data-[state=open]:!animate-none">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8 min-w-0">
            <DialogTitle className="truncate" title={title}>
              {title}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div ref={contentRef} className="flex-1 min-h-0 overflow-auto">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
