import React, { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Link, Unlink } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StepNavigatorProps {
  currentStepIndex: number;
  currentStepValue: number;
  availableSteps: number[];
  onStepChange: (index: number) => void;
  onStepValueChange?: (value: number) => void;
  className?: string;
  /** Whether this panel's step is synced with other panels */
  isLocked?: boolean;
  /** Callback to toggle sync lock for this panel */
  onLockChange?: (locked: boolean) => void;
  /** Whether the sync system is available (provider exists) */
  showLock?: boolean;
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

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const index = values[0] ?? 0;
      onStepChange(index);
      if (onStepValueChange) {
        onStepValueChange(availableSteps[index] ?? 0);
      }
    },
    [onStepChange, onStepValueChange, availableSteps]
  );

  if (totalSteps <= 1) {
    return null;
  }

  const maxIndex = totalSteps - 1;
  const percentage = maxIndex > 0 ? (currentStepIndex / maxIndex) * 100 : 0;

  return (
    <div data-testid="step-navigator" className={`flex items-center gap-3 ${className}`}>
      <div className="relative flex w-full min-w-[120px] flex-col">
        {/* Value label positioned above thumb */}
        <div
          className="pointer-events-none absolute -top-5 font-mono text-xs tabular-nums text-foreground"
          style={{
            left: `${percentage}%`,
            transform: "translateX(-50%)",
          }}
        >
          {currentStepValue}
        </div>

        {/* Index-based slider */}
        <Slider
          min={0}
          max={maxIndex}
          step={1}
          value={[currentStepIndex]}
          onValueChange={handleSliderChange}
        />

        {/* Min/Max step value labels */}
        <div className="mt-1 flex justify-between">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {availableSteps[0]}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {availableSteps[maxIndex]}
          </span>
        </div>
      </div>

      {/* Sync link/unlink toggle */}
      {showLock && onLockChange && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onLockChange(!isLocked)}
              className="h-6 w-6"
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
