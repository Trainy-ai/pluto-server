import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { findNearestStep, findNearestStepIndex } from "../../~lib/step-utils";

interface StepNavigatorProps {
  currentStepIndex: number;
  currentStepValue: number;
  availableSteps: number[];
  onStepChange: (index: number) => void;
  onStepValueChange?: (value: number) => void; // Optional: handles finding nearest
  className?: string;
}

export const StepNavigator: React.FC<StepNavigatorProps> = ({
  currentStepIndex,
  currentStepValue,
  availableSteps,
  onStepChange,
  onStepValueChange,
  className = "",
}) => {
  const [inputValue, setInputValue] = useState(currentStepValue.toString());

  const totalSteps = availableSteps.length;
  const maxStepValue = availableSteps[totalSteps - 1] ?? 0;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === totalSteps - 1;

  // Sync input value when currentStepValue changes
  React.useEffect(() => {
    setInputValue(currentStepValue.toString());
  }, [currentStepValue]);

  // Handle text input submission
  const handleInputSubmit = useCallback(() => {
    const value = Number.parseInt(inputValue, 10);

    // Check if input is valid number
    if (Number.isNaN(value)) {
      toast.error("Please enter a valid number");
      setInputValue(currentStepValue.toString());
      return;
    }

    // Check if step exists
    const stepIndex = availableSteps.indexOf(value);
    if (stepIndex !== -1) {
      // Exact match found
      onStepChange(stepIndex);
      if (onStepValueChange) {
        onStepValueChange(value);
      }
    } else {
      // Find nearest step using shared utility
      const nearestStep = findNearestStep(value, availableSteps);
      const nearestIndex = findNearestStepIndex(value, availableSteps);

      toast.info(
        `Step ${value} not available. Navigating to nearest step: ${nearestStep}`
      );

      onStepChange(nearestIndex);
      if (onStepValueChange) {
        onStepValueChange(nearestStep);
      }
      setInputValue(nearestStep.toString());
    }
  }, [
    inputValue,
    currentStepValue,
    availableSteps,
    onStepChange,
    onStepValueChange,
  ]);

  // Handle input key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleInputSubmit();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setInputValue(currentStepValue.toString());
        e.currentTarget.blur();
      }
    },
    [handleInputSubmit, currentStepValue]
  );

  // Handle prev button
  const handlePrev = useCallback(() => {
    if (!isFirstStep) {
      onStepChange(currentStepIndex - 1);
    }
  }, [isFirstStep, currentStepIndex, onStepChange]);

  // Handle next button
  const handleNext = useCallback(() => {
    if (!isLastStep) {
      onStepChange(currentStepIndex + 1);
    }
  }, [isLastStep, currentStepIndex, onStepChange]);

  // Don't render if only one step or no steps
  if (totalSteps <= 1) {
    return null;
  }

  return (
    <div className={`mx-auto max-w-2xl px-4 ${className}`}>
      <div className="flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={handlePrev}
          disabled={isFirstStep}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Input
          type="number"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputSubmit}
          onKeyDown={handleKeyDown}
          className="h-8 w-20 text-center font-mono text-sm"
          min={0}
          max={maxStepValue}
        />

        <Button
          variant="outline"
          size="icon"
          onClick={handleNext}
          disabled={isLastStep}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="flex min-w-[100px] items-center justify-center">
          <span className="font-mono text-sm font-medium">
            Step {currentStepValue}/{maxStepValue}
          </span>
        </div>
      </div>
    </div>
  );
};
