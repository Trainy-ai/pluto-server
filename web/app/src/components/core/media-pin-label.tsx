import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PinButton } from "@/components/core/image-viewer/pin-button";
import { TruncatedLabel } from "@/components/shared/truncated-label";
import {
  pinBadgeClass,
  pinBadgeSymbol,
  buildPinBadgeLines,
  type PinBestStepMeta,
} from "@/components/core/image-viewer/pin-styles";
import type { PinSource } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";

interface MediaPinLabelProps {
  /** Run label (color dot + name) shown above the media tile. */
  runLabel: { name: string; color: string };
  /** Whether this run is pinned at a specific step. */
  isPinned: boolean;
  /** The step this run is pinned at (null when not pinned). */
  pinnedStep: number | null;
  /** How the pin was created (affects badge color + glyph). */
  pinSource: PinSource | null;
  /** Provenance for `best-step` pins — surfaced in the info tooltip. */
  pinBestStepMeta?: PinBestStepMeta | null;
  /** Current effective step value for this cell (used in pin tooltip copy). */
  currentStepValue: number;
  /** Pin this run at the current step (local = this widget, all-panels = everywhere). */
  onPin: (scope: "local" | "all-panels") => void;
  /** Unpin this run (this-widget only, or across all widgets). */
  onUnpin: (scope: "this-widget" | "all-widgets") => void;
  /** Whether the step-sync context is available (enables cross-panel pinning). */
  hasSyncContext: boolean;
  /** Media noun for tooltip wording ("Video" / "Audio"). */
  noun?: string;
}

/**
 * Run label header with pinning controls for video / audio comparison widgets.
 *
 * Mirrors the run-label block inside `ImageCard` (color dot + name + pin step
 * badge + provenance tooltip + pin button) so pinning looks and behaves the
 * same across all media types. Reuses the shared `PinButton` and pin-style
 * helpers to stay in lockstep with the image widget.
 */
export function MediaPinLabel({
  runLabel,
  isPinned,
  pinnedStep,
  pinSource,
  pinBestStepMeta,
  currentStepValue,
  onPin,
  onUnpin,
  hasSyncContext,
  noun = "Media",
}: MediaPinLabelProps) {
  const pinBadgeLines = buildPinBadgeLines(
    pinSource,
    pinBestStepMeta,
    pinnedStep,
    noun,
  );

  return (
    <div className="flex items-center justify-center gap-1 overflow-hidden">
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: runLabel.color }}
      />
      <TruncatedLabel
        text={runLabel.name}
        className="text-xs font-medium"
        style={{ color: runLabel.color }}
      />
      {isPinned && pinnedStep != null && (
        <span
          data-testid="pin-step-badge"
          className={cn(
            "shrink-0 whitespace-nowrap rounded px-1 py-0.5 font-mono text-[10px]",
            pinBadgeClass(pinSource) || "bg-muted text-muted-foreground",
          )}
        >
          Step {pinnedStep} {pinBadgeSymbol(pinSource)}
        </span>
      )}
      {isPinned && pinnedStep != null && pinBadgeLines && (
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
                <div key={i} className="whitespace-nowrap">
                  {line}
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      <PinButton
        isPinned={isPinned}
        currentStepValue={currentStepValue}
        onPin={onPin}
        onUnpin={onUnpin}
        hasSyncContext={hasSyncContext}
        pinSource={pinSource}
        noun={noun.toLowerCase()}
      />
    </div>
  );
}
