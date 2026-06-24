import React, { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Link, Unlink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Inline step-row stepper shared across every media widget
// (image/audio/video/text, both Charts tab and Dashboard tab,
// per-run pages and multi-run comparison view). Visually identical
// to HistogramFooterSliders' StepSliderRow so the steppers in the
// histogram widgets and the other media widgets read as one design.
//
// Fixed-width labels keep the slider track length stable while
// scrubbing — without this the thumb visually jumps as the step
// number / total step count gain digits.

interface StepNavigatorProps {
  currentStepIndex: number;
  currentStepValue: number;
  availableSteps: number[];
  onStepChange: (index: number) => void;
  onStepValueChange?: (value: number) => void;
  className?: string;
  isLocked?: boolean;
  onLockChange?: (locked: boolean) => void;
  showLock?: boolean;
}

// Reserved width for the current step number. 6ch comfortably covers
// 999,999 steps; anything beyond truncates with an ellipsis + tooltip
// showing the full value. Trailing "/ N" suffix has been dropped
// since the slider thumb's position already visualizes progress.
const STEP_NUMBER_MAX_DIGITS = 6;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export const StepNavigator: React.FC<StepNavigatorProps> = ({
  currentStepIndex,
  currentStepValue,
  availableSteps,
  onStepChange,
  onStepValueChange,
  className = "",
  isLocked,
  onLockChange,
  showLock = false,
}) => {
  const totalSteps = availableSteps.length;

  const handleRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const index = Number(e.target.value);
      onStepChange(index);
      if (onStepValueChange) {
        onStepValueChange(availableSteps[index] ?? 0);
      }
    },
    [onStepChange, onStepValueChange, availableSteps],
  );

  if (totalSteps <= 1) {
    return null;
  }

  const maxIndex = totalSteps - 1;

  return (
    <div
      data-testid="step-navigator"
      className={cn("flex items-center gap-3", className)}
    >
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
        step{" "}
        <span
          className="inline-block text-right text-foreground"
          style={{ width: `${STEP_NUMBER_MAX_DIGITS}ch` }}
          title={`${currentStepValue} / ${availableSteps[maxIndex] ?? 0}`}
        >
          {truncate(String(currentStepValue), STEP_NUMBER_MAX_DIGITS)}
        </span>
      </span>
      <input
        type="range"
        role="slider"
        min={0}
        max={maxIndex}
        value={Math.min(currentStepIndex, maxIndex)}
        onChange={handleRangeChange}
        className="h-1 min-w-[40px] flex-1 cursor-pointer accent-primary focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        aria-label="step"
        aria-valuemin={0}
        aria-valuemax={maxIndex}
        aria-valuenow={Math.min(currentStepIndex, maxIndex)}
      />
      {showLock && onLockChange && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onLockChange(!isLocked)}
              className="h-6 w-6 shrink-0"
            >
              {isLocked ? (
                <Link className="h-3 w-3 text-muted-foreground" />
              ) : (
                <Unlink className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isLocked
              ? "Steps synced with other panels. Click to unlink."
              : "Steps independent. Click to sync with other panels."}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
