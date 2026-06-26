import { useEffect, useState, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SlidersHorizontalIcon, PinOff } from "lucide-react";

/** Mutually-exclusive sync modes for the per-sample < N/M > stepper. Mirrors
 * useSampleIndexSync's SampleIndexSyncMode (kept as a plain union to avoid a
 * component → route-module import). */
type SampleIndexSyncMode = "off" | "runs" | "widgets";

const SYNC_MODE_LABEL: Record<SampleIndexSyncMode, string> = {
  off: "Off",
  runs: "Runs",
  widgets: "Widgets",
};

const SYNC_MODES: readonly SampleIndexSyncMode[] = ["off", "runs", "widgets"];

// Mirror the on-screen MultiIndexNav label's styling (font-mono + tabular-nums,
// inheriting the same muted color and text-xs size) so this reads like the real
// < N/# > stepper while the monospace font sets it apart from the sans blurb.
const indexChip = (
  <span className="font-mono tabular-nums">&lt; #/# &gt;</span>
);

const SYNC_MODE_DESCRIPTION: Record<SampleIndexSyncMode, ReactNode> = {
  off: "Each run steps on its own.",
  runs: (
    <>
      Keep every run in this widget on the same sample index ( {indexChip} ).
      Navigating the arrows on one run moves the others to match.
    </>
  ),
  widgets: (
    <>
      Keep every run on every widget (image, video, audio) on the same sample
      index ( {indexChip} ). Navigating the arrows on one widget moves the others
      to match.
    </>
  ),
};

interface MediaSettingsPopoverProps {
  /** Sync Zoom (images only). Section renders when onSyncZoomChange is given. */
  syncZoom?: boolean;
  onSyncZoomChange?: (value: boolean) => void;
  /**
   * "Sync Sample Indices" mode for the per-sample < N/M > stepper in comparison
   * widgets. Section renders when onSyncModeChange is given (comparison view
   * with >1 multi-sample run). Does not affect the step navigator.
   */
  syncMode?: SampleIndexSyncMode;
  onSyncModeChange?: (mode: SampleIndexSyncMode) => void;
  /** Clear-all-pins (images only). Section renders when pins exist. */
  pinnedRunCount?: number;
  onClearAllPins?: () => void;
}

/**
 * Hover-toolbar settings popover (sliders icon) shared by the comparison and
 * single-run media widgets (image / video / audio). Each section renders only
 * when its props are provided, so video/audio can show just "Sync indices"
 * while images also get Sync Zoom + Clear pins.
 */
export function MediaSettingsPopover({
  syncZoom,
  onSyncZoomChange,
  syncMode = "widgets",
  onSyncModeChange,
  pinnedRunCount = 0,
  onClearAllPins,
}: MediaSettingsPopoverProps) {
  const [open, setOpen] = useState(false);

  // Close the popover on any scroll so it doesn't drift away from its anchor.
  // Ignore scrolls in the first 250ms after opening: Radix's FocusScope moves
  // focus into the popover on mount, which can trigger a scrollIntoView that
  // would immediately close the popover (a "flicker" in tests). The grace
  // window lets Radix finish its focus handling first.
  useEffect(() => {
    if (!open) return;
    const openedAt = Date.now();
    const handler = () => {
      if (Date.now() - openedAt < 250) return;
      setOpen(false);
    };
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  const showSyncZoom = !!onSyncZoomChange;
  const showSyncIndices = !!onSyncModeChange;
  const showClearPins = pinnedRunCount > 0 && !!onClearAllPins;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
          data-testid="image-settings-btn"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64" sideOffset={8}>
        <div className="space-y-3">
          {showSyncZoom && (
            <>
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="sync-zoom"
                  className="text-sm font-medium cursor-pointer"
                >
                  Sync Zoom
                </Label>
                <Switch
                  id="sync-zoom"
                  checked={syncZoom}
                  onCheckedChange={onSyncZoomChange}
                  className="scale-90"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Zoom level persists across image fullscreen views within this
                group.
              </p>
            </>
          )}
          {showSyncIndices && (
            <div className={cn(showSyncZoom && "border-t pt-3")}>
              <Label className="text-sm font-medium">Sync Sample Indices</Label>
              {/* Segmented control — the three modes are mutually exclusive.
                  Radiogroup keyboard pattern: a single tab stop (roving
                  tabindex on the active option) + arrow keys to move/select. */}
              <div
                role="radiogroup"
                aria-label="Sync sample indices"
                className="mt-2 flex rounded-md bg-muted p-0.5"
                data-testid="sync-indices-segmented"
                onKeyDown={(e) => {
                  const idx = SYNC_MODES.indexOf(syncMode);
                  let nextIdx = idx;
                  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    nextIdx = (idx + 1) % SYNC_MODES.length;
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    nextIdx = (idx - 1 + SYNC_MODES.length) % SYNC_MODES.length;
                  } else if (e.key === "Home") {
                    nextIdx = 0;
                  } else if (e.key === "End") {
                    nextIdx = SYNC_MODES.length - 1;
                  } else {
                    return;
                  }
                  e.preventDefault();
                  const nextMode = SYNC_MODES[nextIdx];
                  onSyncModeChange?.(nextMode);
                  e.currentTarget
                    .querySelector<HTMLElement>(
                      `[data-testid="sync-indices-${nextMode}"]`,
                    )
                    ?.focus();
                }}
              >
                {SYNC_MODES.map((m) => {
                  const active = syncMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      // Roving tabindex: only the selected option is tabbable.
                      tabIndex={active ? 0 : -1}
                      data-testid={`sync-indices-${m}`}
                      onClick={() => onSyncModeChange?.(m)}
                      className={cn(
                        "flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {SYNC_MODE_LABEL[m]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {SYNC_MODE_DESCRIPTION[syncMode]}
              </p>
            </div>
          )}
          {showClearPins && (
            <div className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs"
                onClick={onClearAllPins}
              >
                <PinOff className="h-3.5 w-3.5" />
                Clear all pins ({pinnedRunCount})
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
