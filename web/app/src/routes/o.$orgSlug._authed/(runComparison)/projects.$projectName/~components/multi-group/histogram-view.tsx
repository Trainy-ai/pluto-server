import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Settings,
  Camera,
  Film,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNormalizedHistogramData } from "./hooks/use-normalized-histogram";
import { useHistogramCanvas } from "./hooks/use-histogram-canvas";
import { useAnimationFrame } from "./hooks/use-animation-frame";
import { AnimationControls } from "./components/animation-controls"; // retain or further break down as needed

// Configuration for animation speed etc.
const ANIMATION_CONFIG = {
  MIN_SPEED: 1,
  MAX_SPEED: 1000,
  SPEED_STEP: 10,
  DEFAULT_SPEED: 100,
};

export const MultiHistogramView: React.FC<{
  logName: string;
  tenantId: string;
  projectName: string;
  runs: any[]; // adjust type as necessary (MetricData[])
}> = ({ logName, tenantId, projectName, runs }) => {
  // Get all unique step values and sort them
  const { data, isLoading, hasError } = useNormalizedHistogramData(runs, {
    tenantId,
    projectName,
    logName,
  });

  // Track step index and actual step value separately
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState<number>(
    ANIMATION_CONFIG.DEFAULT_SPEED,
  );

  // Calculate unique sorted step values
  const stepValues = useMemo(() => {
    if (!data.normalizedData.length) return [];
    const allSteps = new Set<number>();
    data.normalizedData.forEach((run) => {
      run.data.forEach((d: any) => allSteps.add(d.step));
    });
    return Array.from(allSteps).sort((a, b) => a - b);
  }, [data.normalizedData]);

  const currentStep = stepValues[stepIndex] ?? 0;
  const maxStepIndex = Math.max(0, stepValues.length - 1);

  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { drawHistogram } = useHistogramCanvas();

  // Animation hook - fixed to update canvas on each frame
  useAnimationFrame(
    (deltaTime) => {
      // This callback is now executed on each animation frame
      if (canvasRef.current) {
        drawHistogram({
          canvas: canvasRef.current,
          normalizedData: data.normalizedData,
          currentStep,
          xAxisRange: data.xAxisRange,
          theme,
          globalMaxFreq: data.globalMaxFreq,
        });
      }
    },
    isPlaying,
    animationSpeed,
    stepIndex,
    setStepIndex,
    maxStepIndex,
    () => setIsPlaying(false),
  );

  // Responsive canvas update
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const updateCanvas = () => {
      if (canvasRef.current) {
        canvasRef.current.style.width = "100%";
        canvasRef.current.style.height = "100%";
        if (data.normalizedData.length && canvasRef.current) {
          drawHistogram({
            canvas: canvasRef.current,
            normalizedData: data.normalizedData,
            currentStep,
            xAxisRange: data.xAxisRange,
            theme,
            globalMaxFreq: data.globalMaxFreq,
          });
        }
      }
    };

    updateCanvas();
    const resizeObserver = new ResizeObserver(updateCanvas);
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [data, currentStep, drawHistogram, theme]);

  const handleExport = useCallback((type: "snapshot" | "gif") => {
    setIsExporting(true);
    toast("Export functionality coming soon", {
      description:
        "This feature is not yet implemented for multi-run histograms",
    });
    setIsExporting(false);
  }, []);

  if (isLoading) {
    return (
      <div className="p-4">
        <h3 className="text-center font-mono text-sm font-medium">{logName}</h3>
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (hasError || data.normalizedData.length === 0) {
    return (
      <div className="p-4">
        <h3 className="text-center font-mono text-sm font-medium">{logName}</h3>
        <div className="flex items-center justify-center">
          {hasError ? "Error loading data" : "No data found"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-grow flex-col space-y-4 p-4">
      <h3 className="text-center font-mono text-sm font-medium">{logName}</h3>
      <div className="flex flex-1 flex-col space-y-4">
        <div ref={containerRef} className="relative flex-1">
          <canvas ref={canvasRef} className="absolute inset-0 rounded-lg" />
          {isExporting && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <div className="text-center">
                <div className="mb-2 text-sm">Exporting GIF...</div>
                <div className="text-xs">
                  Export progress: {Math.round(exportProgress * 100)}%
                </div>
              </div>
            </div>
          )}
        </div>
        {maxStepIndex > 0 && (
          <div className="flex w-full flex-col space-y-2">
            <AnimationControls
              currentStep={stepIndex}
              maxStep={maxStepIndex}
              isPlaying={isPlaying}
              animationSpeed={animationSpeed}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              onStepChange={setStepIndex}
              onSpeedChange={setAnimationSpeed}
              onExport={handleExport}
              isExporting={isExporting}
            />
            <div className="text-xs text-muted-foreground">
              Step: {currentStep} ({stepIndex + 1}/{maxStepIndex + 1})
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
