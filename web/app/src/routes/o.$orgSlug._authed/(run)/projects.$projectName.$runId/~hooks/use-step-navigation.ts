import { useState, useMemo, useCallback } from "react";
import { findNearestStep as findNearestStepUtil } from "../~lib/step-utils";

interface StepData {
  step: number;
}

interface UseStepNavigationReturn {
  currentStepIndex: number;
  currentStepValue: number;
  availableSteps: number[];
  totalSteps: number;
  goToStepIndex: (index: number) => void;
  goToStepValue: (value: number) => number; // Returns the actual step navigated to
  nextStep: () => void;
  prevStep: () => void;
  findNearestStep: (targetStep: number) => number;
  isValidStep: (step: number) => boolean;
  hasMultipleSteps: () => boolean;
  isFirstStep: () => boolean;
  isLastStep: () => boolean;
}

export function useStepNavigation<T extends StepData>(
  data: T[]
): UseStepNavigationReturn {
  // Extract unique step values and sort them
  const availableSteps = useMemo(() => {
    if (!data || data.length === 0) return [];
    const steps = Array.from(new Set(data.map((item) => item.step)));
    return steps.sort((a, b) => a - b);
  }, [data]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Get current step value from index
  const currentStepValue = availableSteps[currentStepIndex] ?? 0;

  // Total number of unique steps
  const totalSteps = availableSteps.length;

  // Find nearest step value using shared utility
  const findNearestStep = useCallback(
    (targetStep: number): number => {
      return findNearestStepUtil(targetStep, availableSteps);
    },
    [availableSteps]
  );

  // Check if a step value exists
  const isValidStep = useCallback(
    (step: number): boolean => {
      return availableSteps.includes(step);
    },
    [availableSteps]
  );

  // Navigate to a specific step index
  const goToStepIndex = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(totalSteps - 1, index));
      setCurrentStepIndex(clampedIndex);
    },
    [totalSteps]
  );

  // Navigate to a specific step value (returns actual step navigated to)
  const goToStepValue = useCallback(
    (value: number): number => {
      const nearestStep = findNearestStep(value);
      const index = availableSteps.indexOf(nearestStep);
      if (index !== -1) {
        setCurrentStepIndex(index);
      }
      return nearestStep;
    },
    [availableSteps, findNearestStep]
  );

  // Navigate to next step
  const nextStep = useCallback(() => {
    setCurrentStepIndex((prev) => Math.min(totalSteps - 1, prev + 1));
  }, [totalSteps]);

  // Navigate to previous step
  const prevStep = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  // Check if there are multiple steps
  const hasMultipleSteps = useCallback(() => {
    return totalSteps > 1;
  }, [totalSteps]);

  // Check if at first step
  const isFirstStep = useCallback(() => {
    return currentStepIndex === 0;
  }, [currentStepIndex]);

  // Check if at last step
  const isLastStep = useCallback(() => {
    return currentStepIndex === totalSteps - 1;
  }, [currentStepIndex, totalSteps]);

  return {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    totalSteps,
    goToStepIndex,
    goToStepValue,
    nextStep,
    prevStep,
    findNearestStep,
    isValidStep,
    hasMultipleSteps,
    isFirstStep,
    isLastStep,
  };
}
