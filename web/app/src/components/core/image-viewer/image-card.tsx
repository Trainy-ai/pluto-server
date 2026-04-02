import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";

interface ImageCardStepNavigation {
  currentStepIndex: number;
  currentStepValue: number;
  availableSteps: number[];
  onStepChange: (index: number) => void;
  isLocked?: boolean;
  onLockChange?: (locked: boolean) => void;
  showLock?: boolean;
}

interface ImageCardProps {
  url: string;
  fileName: string;
  /** Optional run label with color dot shown above the image */
  runLabel?: {
    name: string;
    color: string;
  };
  /** Optional step navigation to show in fullscreen mode */
  stepNavigation?: ImageCardStepNavigation;
  /** When provided, uses this as the zoom scale (controlled mode) */
  sharedScale?: number;
  /** Called when zoom changes in controlled mode */
  onScaleChange?: (scale: number) => void;
}

async function handleDownload(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch image");
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Failed to download file:", error);
    window.open(url, "_blank");
  }
}

export function ImageCard({ url, fileName, runLabel, stepNavigation, sharedScale, onScaleChange }: ImageCardProps) {
  const [localScale, setLocalScale] = useState(1);
  const scale = sharedScale ?? localScale;
  const setScale = (v: number | ((prev: number) => number)) => {
    const next = typeof v === "function" ? v(scale) : v;
    setLocalScale(next);
    onScaleChange?.(next);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Reset scroll position when the image changes (e.g. step change)
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [url]);

  const resetView = () => {
    setScale(1);
    containerRef.current?.scrollTo(0, 0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY || e.deltaX;
      setScale((s) => Math.min(Math.max(1, s + delta * 0.01), 8));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {runLabel && (
        <div className="flex items-center justify-center gap-1.5">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: runLabel.color }}
          />
          <span className="text-sm font-medium" style={{ color: runLabel.color }}>
            {runLabel.name}
          </span>
        </div>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <div className="group relative flex aspect-[16/9] cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-background/50">
            <img
              src={url}
              alt={fileName}
              className="h-full w-full object-contain"
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-1.5 right-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(url, fileName);
              }}
            >
              <Download className="h-3 w-3" />
            </Button>
          </div>
        </DialogTrigger>
        <DialogContent className="h-[95vh] w-[95vw] overflow-hidden">
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div
              ref={containerRef}
              className="relative flex-1 min-h-0 overflow-auto bg-background/95 p-4"
              onWheel={handleWheel}
            >
              <div
                style={naturalSize ? {
                  width: Math.round(naturalSize.w * scale),
                  height: Math.round(naturalSize.h * scale),
                  position: "relative",
                  margin: "auto",
                } : undefined}
              >
                <img
                  src={url}
                  alt={fileName}
                  className="absolute top-0 left-0 select-none origin-top-left"
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                  style={{
                    transform: `scale(${scale})`,
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t bg-background px-6 py-3">
              {stepNavigation && stepNavigation.availableSteps.length > 1 && (
                <div className="pb-1">
                  <StepNavigator
                    currentStepIndex={stepNavigation.currentStepIndex}
                    currentStepValue={stepNavigation.currentStepValue}
                    availableSteps={stepNavigation.availableSteps}
                    onStepChange={stepNavigation.onStepChange}
                    isLocked={stepNavigation.isLocked}
                    onLockChange={stepNavigation.onLockChange}
                    showLock={stepNavigation.showLock}
                  />
                </div>
              )}
              <div className="relative flex items-center">
                <p className="font-mono text-sm text-muted-foreground">
                  {fileName}
                </p>
                <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => setScale(Math.max(1, scale - 0.5))}
                    disabled={scale <= 1}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <div className="flex min-w-[100px] items-center justify-center">
                    <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
                      <span className="text-sm font-medium">
                        {Math.round(scale * 100)}%
                      </span>
                      <div className="h-3 w-px bg-border" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={resetView}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => setScale(Math.min(8, scale + 0.5))}
                    disabled={scale >= 8}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto gap-2"
                  onClick={() => handleDownload(url, fileName)}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="flex justify-center">
        <p className="truncate text-center text-xs text-muted-foreground">
          {fileName}
        </p>
      </div>
    </div>
  );
}
