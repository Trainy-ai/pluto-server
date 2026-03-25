import { useState, type ReactNode } from "react";
import { Maximize2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaFullscreenDialog } from "@/components/charts/media-fullscreen-dialog";

interface MediaCardWrapperProps {
  title: string;
  children: ReactNode;
  /** Content to render in fullscreen. Defaults to children if not provided. */
  fullscreenContent?: ReactNode;
  /** Optional extra controls rendered in the hover toolbar (before the fullscreen button) */
  toolbarExtra?: ReactNode;
  className?: string;
}

/**
 * Wrapper that adds a fullscreen button (matching ChartCardWrapper style)
 * to any media visualization (images, video, audio, histogram).
 */
export function MediaCardWrapper({
  title,
  children,
  fullscreenContent,
  toolbarExtra,
  className,
}: MediaCardWrapperProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <>
      <div className={`group relative ${className ?? ""}`}>
        {children}
        {/* Hover toolbar — matches ChartCardWrapper style */}
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {toolbarExtra}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
            data-testid="media-fullscreen-btn"
            onClick={() => setIsFullscreen(true)}
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      {isFullscreen && (
        <MediaFullscreenDialog
          open={true}
          onOpenChange={(open) => { if (!open) setIsFullscreen(false); }}
          title={title}
        >
          {fullscreenContent ?? children}
        </MediaFullscreenDialog>
      )}
    </>
  );
}
