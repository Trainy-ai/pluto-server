import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useNormalizedHistogramData } from "./hooks/use-normalized-histogram";
import {
  useHistogramCanvas,
  type HistogramStep,
} from "./hooks/use-histogram-canvas";
import { useAnimationFrame } from "./hooks/use-animation-frame";
import { AnimationControls } from "./components/animation-controls";
import {
  HistogramAxisControls,
  type AxisBounds,
} from "./components/histogram-axis-controls";
import { StepNavigator } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/shared/step-navigator";

const ANIMATION_CONFIG = {
  MIN_SPEED: 1,
  MAX_SPEED: 1000,
  SPEED_STEP: 10,
  DEFAULT_SPEED: 100,
};

// Sub-component: renders a single run's histogram on its own canvas
function SingleRunHistogramCanvas({
  runColor,
  stepData,
  xAxisRange,
  globalMaxFreq,
  theme,
}: {
  runColor: string;
  stepData: HistogramStep | undefined;
  xAxisRange: { min: number; max: number };
  globalMaxFreq: number;
  theme: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { drawSingleHistogram } = useHistogramCanvas();

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current || !stepData) return;

    const draw = () => {
      if (!canvasRef.current || !stepData) return;
      canvasRef.current.style.width = "100%";
      canvasRef.current.style.height = "100%";
      drawSingleHistogram({
        canvas: canvasRef.current,
        data: stepData,
        xAxisRange,
        theme,
        globalMaxFreq,
        color: runColor,
        hideStepLabel: true,
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [stepData, xAxisRange, globalMaxFreq, theme, runColor, drawSingleHistogram]);

  if (!stepData) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground">
        No data for this step
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-h-[200px] w-full overflow-hidden rounded-md bg-background/50">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}

export const MultiHistogramView: React.FC<{
  logName: string;
  tenantId: string;
  projectName: string;
  runs: any[];
  className?: string;
}> = ({ logName, tenantId, projectName, runs, className }) => {
  const { data, isLoading, hasError } = useNormalizedHistogramData(runs, {
    tenantId,
    projectName,
    logName,
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState<number>(
    ANIMATION_CONFIG.DEFAULT_SPEED,
  );
  const [axisBounds, setAxisBounds] = useState<AxisBounds>({});

  // Filter out runs with no histogram data at all
  const runsWithData = useMemo(() => {
    return data.normalizedData.filter(
      (run: any) => run.data.length > 0,
    );
  }, [data.normalizedData]);

  const stepValues = useMemo(() => {
    if (!runsWithData.length) return [];
    const allSteps = new Set<number>();
    runsWithData.forEach((run: any) => {
      run.data.forEach((d: any) => allSteps.add(d.step));
    });
    return Array.from(allSteps).sort((a, b) => a - b);
  }, [runsWithData]);

  const currentStep = stepValues[stepIndex] ?? 0;
  const maxStepIndex = Math.max(0, stepValues.length - 1);

  const { resolvedTheme: theme } = useTheme();

  // Compute effective axis ranges (user overrides merged with auto values)
  const effectiveXAxisRange = useMemo(() => ({
    min: axisBounds.xMin ?? data.xAxisRange.min,
    max: axisBounds.xMax ?? data.xAxisRange.max,
  }), [axisBounds.xMin, axisBounds.xMax, data.xAxisRange]);

  const effectiveGlobalMaxFreq = useMemo(
    () => axisBounds.yMax ?? data.globalMaxFreq,
    [axisBounds.yMax, data.globalMaxFreq],
  );

  // Find step data for each run at the current step
  const runStepData = useMemo(() => {
    return runsWithData.map((run: any) => ({
      runName: run.runName as string,
      color: run.color as string,
      stepData: run.data.find(
        (d: { step: number }) => d.step === currentStep,
      ) as HistogramStep | undefined,
    }));
  }, [runsWithData, currentStep]);

  // Animation hook
  useAnimationFrame(
    () => {},
    isPlaying,
    animationSpeed,
    stepIndex,
    setStepIndex,
    maxStepIndex,
    () => setIsPlaying(false),
  );

  if (isLoading) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2">
          {runs.map((run) => (
            <div key={run.runId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-center gap-1.5">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="relative min-h-[200px] w-full overflow-hidden rounded-md">
                <Skeleton className="h-full w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (hasError || runsWithData.length === 0) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {hasError ? "Error loading data" : "No data found"}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {logName}
      </h3>
      <HistogramAxisControls
        axisBounds={axisBounds}
        onAxisBoundsChange={setAxisBounds}
      />
      <div
        className={cn(
          "grid flex-1 grid-cols-1 gap-4 overflow-auto",
          runStepData.length > 1 && "sm:grid-cols-2",
        )}
      >
        {runStepData.map((run, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: run.color }}
              />
              <span
                className="truncate text-sm font-medium"
                style={{ color: run.color }}
              >
                {run.runName}
              </span>
            </div>
            <SingleRunHistogramCanvas
              runColor={run.color}
              stepData={run.stepData}
              xAxisRange={effectiveXAxisRange}
              globalMaxFreq={effectiveGlobalMaxFreq}
              theme={theme}
            />
          </div>
        ))}
      </div>
      {maxStepIndex > 0 && (
        <div className="flex w-full flex-col space-y-2">
          <StepNavigator
            currentStepIndex={stepIndex}
            currentStepValue={currentStep}
            availableSteps={stepValues}
            onStepChange={setStepIndex}
          />
          <AnimationControls
            currentStep={stepIndex}
            maxStep={maxStepIndex}
            isPlaying={isPlaying}
            animationSpeed={animationSpeed}
            onPlayPause={() => setIsPlaying(!isPlaying)}
            onStepChange={setStepIndex}
            onSpeedChange={setAnimationSpeed}
          />
        </div>
      )}
    </div>
  );
};
