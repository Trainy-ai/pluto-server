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
  Info,
} from "lucide-react";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";
import { formatAxisLabel } from "@/components/charts/lib/format";
import { PinButton } from "./pin-button";
import {
  pinRingClass,
  pinBadgeClass,
  pinBadgeSymbol,
  buildPinBadgeLines,
} from "./pin-styles";
import { MultiIndexNav } from "@/components/core/multi-index-nav";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PinSource } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { downloadImageWithCaption } from "@/components/charts/chart-export-utils";

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
  /** Optional user-provided caption (e.g. pluto.Image(caption=...)). When
   * present it is shown under the tile (and in the fullscreen footer) instead
   * of the raw UUID filename. Falls back to fileName when null/undefined. */
  caption?: string | null;
  /** Optional run label with color dot. Shown above the image on the
   * card and again in the fullscreen footer (where there's otherwise no
   * indication of which run a maximised image came from). The name
   * usually carries the display ID inline (e.g. "run-0246 (TES-450)"). */
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
  /**
   * For `pinSource === "best-step"` pins: provenance shown in the badge
   * tooltip. `tiedAlternativeImageStep` is non-null when the nearest-snap
   * tie-break had to choose between two image steps at the same distance.
   * `metricLogName` and `operation` recall *what* was pinned ("max train/loss").
   */
  pinBestStepMeta?: {
    metricStep: number;
    metricValue: number | null;
    metricLogName: string;
    operation: "argmin" | "argmax";
    distance: number;
    tiedAlternativeImageStep: number | null;
  } | null;
  /** Callback to pin this run at current step */
  onPin?: (scope: "local" | "all-panels") => void;
  /** Callback to unpin this run — scope controls whether to unpin this widget only or all widgets */
  onUnpin?: (scope: "this-widget" | "all-widgets") => void;
  /** Whether the sync context is available (enables "pin across all panels") */
  hasSyncContext?: boolean;
  /** The current step value for displaying in pin tooltip */
  currentStepValue?: number;
  /** How the pin was created (affects visual style) */
  pinSource?: PinSource | null;
  /** Total number of samples at this step — enables prev/next nav when > 1 */
  totalIndices?: number;
  /** Current sample index (0-based) */
  currentImageIndex?: number;
  /** Called when user clicks the prev/next arrows */
  onIndexChange?: (next: number) => void;
}

/**
 * Download an image, stamping a small caption strip beneath it with the
 * current step and the source run's color + name. Falls back to a raw URL
 * download when the canvas composition fails (e.g. CORS-tainted image).
 */
async function handleDownload(
  url: string,
  fileName: string,
  runLabel?: { name: string; color: string },
  currentStepValue?: number,
  // Container element used to resolve the page theme so the caption
  // strip's background matches what the user saw on screen (dark band
  // on dark theme, light band on light theme). Mirrors the chart-PNG
  // export's behavior in `captureChartAsBlob`.
  container?: HTMLElement | null,
): Promise<void> {
  const caption = (() => {
    const step =
      typeof currentStepValue === "number"
        ? `step ${currentStepValue}`
        : undefined;
    const runs = runLabel ? [runLabel] : undefined;
    if (!step && !runs) return undefined;
    return { step, runs };
  })();

  try {
    await downloadImageWithCaption(url, fileName, caption, container);
    return;
  } catch (error) {
    console.error("Caption-stamped image download failed, falling back to raw:", error);
  }

  // Fallback: original behavior — raw image bytes, no caption.
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
  caption,
  runLabel,
  stepNavigation,
  sharedScale,
  onScaleChange,
  isPinned,
  pinnedStep,
  pinBestStepMeta,
  onPin,
  onUnpin,
  hasSyncContext,
  currentStepValue,
  pinSource,
  totalIndices,
  currentImageIndex,
  onIndexChange,
}: ImageCardProps) {
  // Prefer the user-supplied caption over the raw (usually UUID) filename
  // for the label shown under the tile and in the fullscreen footer.
  // Use `||` (not `??`) so an empty-string caption still falls back to the
  // filename instead of rendering a blank label / hiding the footer entirely.
  const displayLabel = caption || fileName;
  // Build provenance lines for the pin badge tooltip. Only populated when
  // the pin came from "find best step" — other pin sources get no extra
  // tooltip and fall back to the raw "Step N ★" visual.
  const pinBadgeLines = buildPinBadgeLines(pinSource, pinBestStepMeta, pinnedStep);
  const pinRingClassName = isPinned ? pinRingClass(pinSource) : "";
  const pinBadgeClassName = isPinned ? pinBadgeClass(pinSource) : "";

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
      setScale((s) => Math.min(Math.max(0.1, s + delta * 0.01), 8));
    }
  };

  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="image-card"
      data-run-name={runLabel?.name}
      data-pin-source={pinSource ?? ""}
    >
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
            <span
              data-testid="pin-step-badge"
              className={cn(
                "shrink-0 whitespace-nowrap rounded px-1 py-0.5 font-mono text-[10px]",
                pinBadgeClassName || "bg-muted text-muted-foreground",
              )}
            >
              Step {pinnedStep} {pinBadgeSymbol(pinSource)}
            </span>
          )}
          {isPinned && pinnedStep != null && pinBadgeLines && (
            // Separate icon so the hover target (and tooltip) is scoped to
            // the provenance hint instead of the step badge itself.
            // Uses Radix Tooltip with delayDuration=0 (the project default)
            // for instant hover feedback — the native title= attribute has
            // a 1–2s OS-driven delay that feels broken.
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-testid="pin-info-icon"
                  className="shrink-0 text-muted-foreground/70 hover:text-muted-foreground"
                  aria-label="Pin provenance"
                >
                  <Info className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <div className="space-y-0.5 text-xs">
                  {pinBadgeLines.map((line, i) => (
                    // whitespace-nowrap on each line lets the tooltip's
                    // w-fit container size exactly to the longest line
                    // instead of wrapping mid-line at an awkward width.
                    <div key={i} className="whitespace-nowrap">
                      {line}
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {onPin && onUnpin && currentStepValue != null && (
            <PinButton
              isPinned={!!isPinned}
              currentStepValue={currentStepValue}
              onPin={onPin}
              onUnpin={onUnpin}
              hasSyncContext={!!hasSyncContext}
              pinSource={pinSource}
            />
          )}
        </div>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <div className={cn(
              "group relative flex aspect-[16/9] cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-background/50",
              pinRingClassName,
              !url && "border border-dashed cursor-default",
            )}>
            {url ? (
              <>
                <img
                  src={url}
                  alt={fileName}
                  loading="lazy"
                  decoding="async"
                  width={256}
                  height={256}
                  className="h-full w-full object-contain"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute top-1.5 right-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(url, fileName ?? "image.png", runLabel, currentStepValue, containerRef.current);
                  }}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <span className="px-2 text-center text-sm text-muted-foreground">
                No image at step {currentStepValue}
              </span>
            )}
          </div>
        </DialogTrigger>
        <DialogContent className="h-[95vh] w-[95vw] overflow-hidden">
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div
              ref={containerRef}
              className="relative flex flex-1 min-h-0 overflow-auto bg-background/95 p-4"
              onWheel={handleWheel}
            >
              {url ? (
                <img
                  src={url}
                  alt={fileName}
                  className="m-auto max-w-none shrink-0 select-none"
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                  style={
                    naturalSize
                      ? {
                          width: Math.round(naturalSize.w * scale),
                          height: Math.round(naturalSize.h * scale),
                        }
                      : undefined
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="px-4 text-center text-lg text-muted-foreground">
                    No image at step {currentStepValue}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t bg-background px-6 py-3">
              {runLabel && (
                <div className="flex min-w-0 items-center gap-2 pb-1">
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: runLabel.color }}
                  />
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: runLabel.color }}
                    title={runLabel.name}
                  >
                    {runLabel.name}
                  </span>
                </div>
              )}
              {isPinned && pinnedStep != null ? (
                <div className="flex flex-col gap-0.5 pb-1">
                  <div className="flex items-center gap-2">
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
                  {pinSource === "best-step" && pinBestStepMeta && (
                    <div className="ml-[1.375rem] text-xs text-muted-foreground">
                      {(() => {
                        const {
                          metricStep,
                          metricValue,
                          metricLogName,
                          operation,
                          distance,
                          tiedAlternativeImageStep,
                        } = pinBestStepMeta;
                        const opLabel = operation === "argmin" ? "min" : "max";
                        const valueStr =
                          metricValue != null ? formatAxisLabel(metricValue) : null;
                        const headline = metricLogName
                          ? valueStr != null
                            ? `${opLabel} ${metricLogName} = `
                            : `${opLabel} ${metricLogName}`
                          : `${opLabel} value`;
                        const distSuffix =
                          distance === 0
                            ? "exact match"
                            : `${distance} step${distance === 1 ? "" : "s"} away`;
                        return (
                          <>
                            <div>
                              {headline}
                              {valueStr != null && (
                                <span className="font-mono font-medium text-foreground">
                                  {valueStr}
                                </span>
                              )}{" "}
                              <span className="text-muted-foreground/80">
                                (metric step{" "}
                                <span className="font-mono">{metricStep}</span>,{" "}
                                {distSuffix})
                              </span>
                            </div>
                            {tiedAlternativeImageStep != null && (
                              <div className="text-muted-foreground/80">
                                Tied with step{" "}
                                <span className="font-mono">
                                  {tiedAlternativeImageStep}
                                </span>{" "}
                                — later step preferred
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
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
              <div className="relative flex items-center gap-3">
                <p
                  className="font-mono text-sm text-muted-foreground"
                  title={caption ? `${caption} (${fileName})` : fileName}
                >
                  {displayLabel ?? "No image"}
                </p>
                {totalIndices != null && totalIndices > 1 && onIndexChange && (
                  <MultiIndexNav
                    currentIndex={currentImageIndex ?? 0}
                    totalCount={totalIndices}
                    onIndexChange={onIndexChange}
                  />
                )}
                <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => setScale(Math.max(0.1, scale - 0.2))}
                    disabled={scale <= 0.1}
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
                    onClick={() => setScale(Math.min(8, scale + 0.2))}
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
                  onClick={() => url && handleDownload(url, fileName ?? "image.png", runLabel, currentStepValue, containerRef.current)}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {totalIndices != null && totalIndices > 1 && onIndexChange && (
        <MultiIndexNav
          currentIndex={currentImageIndex ?? 0}
          totalCount={totalIndices}
          onIndexChange={onIndexChange}
        />
      )}
      {displayLabel && (
        <div className="flex justify-center">
          <p
            className="truncate text-center text-xs text-muted-foreground"
            title={caption ? `${caption} (${fileName})` : fileName}
          >
            {displayLabel}
          </p>
        </div>
      )}
    </div>
  );
}
