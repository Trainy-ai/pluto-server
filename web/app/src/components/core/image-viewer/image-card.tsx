import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Pin,
} from "lucide-react";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { PinButton } from "./pin-button";
import type { PinSource } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";

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
  url?: string;
  fileName?: string;
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
  /** Whether this run is pinned at a specific step */
  isPinned?: boolean;
  /** The step this run is pinned at */
  pinnedStep?: number | null;
  /** Callback to pin this run at current step */
  onPin?: (scope: "local" | "all-panels") => void;
  /** Callback to unpin this run */
  onUnpin?: () => void;
  /** Whether the sync context is available (enables "pin across all panels") */
  hasSyncContext?: boolean;
  /** The current step value for displaying in pin tooltip */
  currentStepValue?: number;
  /** How the pin was created (affects visual style) */
  pinSource?: PinSource | null;
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

export function ImageCard({
  url,
  fileName,
  runLabel,
  stepNavigation,
  sharedScale,
  onScaleChange,
  isPinned,
  pinnedStep,
  onPin,
  onUnpin,
  hasSyncContext,
  currentStepValue,
  pinSource,
}: ImageCardProps) {
  const pinRingClass = isPinned
    ? pinSource === "best-step"
      ? "ring-2 ring-amber-500/40"
      : pinSource === "cross-panel"
        ? "ring-2 ring-violet-500/40"
        : "ring-2 ring-primary/30"
    : "";

  const pinBadgeClass = isPinned
    ? pinSource === "best-step"
      ? "bg-amber-500/15 text-amber-400"
      : pinSource === "cross-panel"
        ? "bg-violet-500/15 text-violet-400"
        : "bg-muted text-muted-foreground"
    : "";

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
        <div className="flex items-center justify-center gap-1 overflow-hidden">
          <div
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: runLabel.color }}
          />
          <span className="truncate text-xs font-medium" style={{ color: runLabel.color }} title={runLabel.name}>
            {runLabel.name}
          </span>
          {isPinned && pinnedStep != null && (
            <span className={cn("shrink-0 whitespace-nowrap rounded px-1 py-0.5 font-mono text-[10px]", pinBadgeClass || "bg-muted text-muted-foreground")}>
              Step {pinnedStep} {pinSource === "local" ? "◇" : pinSource === "cross-panel" ? "◈" : pinSource === "best-step" ? "★" : ""}
            </span>
          )}
          {onPin && onUnpin && currentStepValue != null && (
            <PinButton
              isPinned={!!isPinned}
              currentStepValue={currentStepValue}
              onPin={onPin}
              onUnpin={onUnpin}
              hasSyncContext={!!hasSyncContext}
            />
          )}
        </div>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <div className={cn(
              "group relative flex aspect-[16/9] cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-background/50",
              pinRingClass,
              !url && "border border-dashed cursor-default",
            )}>
            {url ? (
              <>
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
                    handleDownload(url, fileName ?? "image.png");
                  }}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                No image at step {currentStepValue}
              </span>
            )}
          </div>
        </DialogTrigger>
        <DialogContent className="h-[95vh] w-[95vw] overflow-hidden">
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div
              ref={containerRef}
              className="relative flex-1 min-h-0 overflow-auto bg-background/95 p-4"
              onWheel={handleWheel}
            >
              {url ? (
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
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-lg text-muted-foreground">
                    No image at step {currentStepValue}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t bg-background px-6 py-3">
              {isPinned && pinnedStep != null ? (
                <div className="flex items-center gap-2 pb-1">
                  <Pin className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm text-muted-foreground">
                    Pinned at step{" "}
                    <span className="font-mono font-medium text-foreground">
                      {pinnedStep}
                    </span>
                  </span>
                  {stepNavigation && (
                    <span className="text-sm text-muted-foreground">
                      (widget at step{" "}
                      <span className="font-mono">{stepNavigation.currentStepValue}</span>)
                    </span>
                  )}
                </div>
              ) : (
                stepNavigation && stepNavigation.availableSteps.length > 1 && (
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
                )
              )}
              <div className="relative flex items-center">
                <p className="font-mono text-sm text-muted-foreground">
                  {fileName ?? "No image"}
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
                  disabled={!url}
                  onClick={() => url && handleDownload(url, fileName ?? "image.png")}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {fileName && (
        <div className="flex justify-center">
          <p className="truncate text-center text-xs text-muted-foreground">
            {fileName}
          </p>
        </div>
      )}
    </div>
  );
}
