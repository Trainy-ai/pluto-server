import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export default function StepIndicator({
  currentStep,
  totalSteps,
}: StepIndicatorProps) {
  return (
    <div className="flex items-center space-x-1">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            currentStep > index + 1
              ? "bg-primary"
              : currentStep === index + 1
                ? "bg-primary/50"
                : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
