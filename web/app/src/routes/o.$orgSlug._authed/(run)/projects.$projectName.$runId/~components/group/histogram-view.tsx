import React, { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Camera,
  Film,
  Settings,
} from "lucide-react";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GIF from "gif.js";
import { toast } from "@/components/ui/sonner";
import { useGetHistogram } from "../../~queries/get-histogram";

// ---------------------- Constants ----------------------
const ANIMATION_CONFIG = {
  MIN_SPEED: 1,
  MAX_SPEED: 1000,
  SPEED_STEP: 10,
  DEFAULT_SPEED: 10,
  GIF_FRAME_DELAY: 100, // in ms
} as const;

const TICK_CONFIG = {
  X_AXIS_TICKS: 10,
  Y_AXIS_TICKS: 5,
  TICK_LENGTH: 5,
} as const;

// ---------------------- Utility Functions ----------------------
function generateNiceNumbers(
  min: number,
  max: number,
  numberOfTicks: number,
): number[] {
  const range = max - min;
  const unroundedTickSize = range / (numberOfTicks - 1);
  const exponent = Math.ceil(Math.log10(unroundedTickSize) - 1);
  const pow10 = Math.pow(10, exponent);
  const roundedTickSize = Math.ceil(unroundedTickSize / pow10) * pow10;
  const niceMin = Math.floor(min / roundedTickSize) * roundedTickSize;
  const niceMax = Math.ceil(max / roundedTickSize) * roundedTickSize;

  const ticks: number[] = [];
  for (let tick = niceMin; tick <= niceMax; tick += roundedTickSize) {
    ticks.push(Number(tick.toFixed(10)));
  }
  return ticks;
}

function formatNumber(value: number, isInteger = false): string {
  if (value === 0) return "0";
  if (isInteger) return value.toFixed(0);
  const absValue = Math.abs(value);
  if (absValue < 0.0001 || absValue >= 1000000) return value.toExponential(2);
  if (absValue < 0.1) return value.toFixed(4);
  if (absValue < 1000) return value.toFixed(2);
  return value.toFixed(1);
}

// ---------------------- Type Definitions ----------------------
interface HistogramData {
  freq: number[];
  bins: {
    min: number;
    max: number;
    num: number;
  };
  maxFreq: number;
}

interface HistogramStep {
  step: number;
  histogramData: HistogramData;
}

interface AnimationControlsProps {
  currentStep: number;
  maxStep: number;
  isPlaying: boolean;
  animationSpeed: number;
  onPlayPause: () => void;
  onStepChange: (step: number) => void;
  onSpeedChange: (speed: number) => void;
  onExport: (type: "snapshot" | "gif") => void;
  isExporting: boolean;
  currentStepValue: number;
  maxStepValue: number;
}

// ---------------------- Components ----------------------

// Animation control buttons and sliders
const AnimationControls: React.FC<AnimationControlsProps> = ({
  currentStep,
  maxStep,
  isPlaying,
  animationSpeed,
  onPlayPause,
  onStepChange,
  onSpeedChange,
  onExport,
  isExporting,
  currentStepValue,
  maxStepValue,
}) => {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onStepChange(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onPlayPause}>
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onStepChange(Math.min(maxStep, currentStep + 1))}
          disabled={currentStep === maxStep}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
      <Slider
        className="w-32 flex-1"
        value={[currentStep]}
        min={0}
        max={maxStep}
        step={1}
        onValueChange={(value) => onStepChange(value[0])}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="p-2">
            <div className="mb-2 text-sm font-medium">Animation Speed</div>
            <Slider
              className="my-4"
              value={[
                ANIMATION_CONFIG.MAX_SPEED -
                  animationSpeed +
                  ANIMATION_CONFIG.MIN_SPEED,
              ]}
              min={ANIMATION_CONFIG.MIN_SPEED}
              max={ANIMATION_CONFIG.MAX_SPEED}
              step={ANIMATION_CONFIG.SPEED_STEP}
              onValueChange={(value) =>
                onSpeedChange(
                  ANIMATION_CONFIG.MAX_SPEED -
                    value[0] +
                    ANIMATION_CONFIG.MIN_SPEED,
                )
              }
            />
          </div>
          <DropdownMenuItem onClick={() => onExport("snapshot")}>
            <Camera className="mr-2 h-4 w-4" />
            Export Snapshot
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport("gif")}>
            <Film className="mr-2 h-4 w-4" />
            Export Animation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

interface HistogramCanvasProps {
  data: HistogramStep;
  theme: string;
  globalMaxFreq: number;
  xAxisRange: {
    min: number;
    max: number;
    globalMin: number;
    globalMax: number;
  };
}

// Common drawing routines for axes and ticks
function drawAxes(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  xAxisRange: HistogramCanvasProps["xAxisRange"],
  globalMaxFreq: number,
  padding: number,
) {
  ctx.beginPath();
  ctx.strokeStyle = theme === "dark" ? "#94a3b8" : "#666";
  ctx.lineWidth = 1.5;

  // Y-axis
  ctx.moveTo(padding, 0);
  ctx.lineTo(padding, canvas.height - padding);
  // X-axis
  ctx.moveTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();
}

function drawXTicks(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  xAxisRange: HistogramCanvasProps["xAxisRange"],
  width: number,
  padding: number,
) {
  const xTicks = generateNiceNumbers(
    xAxisRange.min,
    xAxisRange.max,
    TICK_CONFIG.X_AXIS_TICKS,
  );
  xTicks.forEach((tickValue) => {
    const normalizedX =
      (tickValue - xAxisRange.min) / (xAxisRange.max - xAxisRange.min);
    const x = padding + normalizedX * width;

    // Only draw ticks if they are within the plot area (after y-axis)
    if (x >= padding && x <= canvas.width - padding) {
      ctx.beginPath();
      ctx.moveTo(x, canvas.height - padding);
      ctx.lineTo(x, canvas.height - padding + TICK_CONFIG.TICK_LENGTH);
      ctx.stroke();
      ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        formatNumber(tickValue),
        x,
        canvas.height - padding + TICK_CONFIG.TICK_LENGTH + 2,
      );
    }
  });
}

function drawYTicks(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  globalMaxFreq: number,
  height: number,
  padding: number,
) {
  const yTicks = generateNiceNumbers(
    0,
    globalMaxFreq,
    TICK_CONFIG.Y_AXIS_TICKS,
  );
  yTicks.forEach((tickValue) => {
    const normalizedY = tickValue / globalMaxFreq;
    const y = canvas.height - padding - normalizedY * height;
    ctx.beginPath();
    ctx.moveTo(padding - TICK_CONFIG.TICK_LENGTH, y);
    ctx.lineTo(padding, y);
    ctx.stroke();
    ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(
      formatNumber(tickValue, true),
      padding - TICK_CONFIG.TICK_LENGTH - 4,
      y,
    );
  });
}

// Canvas for rendering histogram for a given step
const HistogramCanvas = React.forwardRef<
  HTMLCanvasElement,
  HistogramCanvasProps
>(({ data, theme, globalMaxFreq, xAxisRange }, forwardedRef) => {
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef =
    (forwardedRef as React.RefObject<HTMLCanvasElement>) || internalCanvasRef;

  const drawHistogram = useCallback(() => {
    if (!canvasRef.current || !data) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const padding = 60;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAxes(ctx, canvas, theme, xAxisRange, globalMaxFreq, padding);
    drawXTicks(ctx, canvas, theme, xAxisRange, width, padding);
    drawYTicks(ctx, canvas, theme, globalMaxFreq, height, padding);

    // Draw histogram bars
    const { freq, bins } = data.histogramData;
    const dataBinWidth = (bins.max - bins.min) / bins.num;
    const visibleStartBin = Math.max(
      0,
      Math.floor((xAxisRange.min - bins.min) / dataBinWidth),
    );
    const visibleEndBin = Math.min(
      bins.num - 1,
      Math.ceil((xAxisRange.max - bins.min) / dataBinWidth),
    );

    for (let i = visibleStartBin; i <= visibleEndBin; i++) {
      const frequency = freq[i];
      if (frequency === undefined) continue;

      const binStart = bins.min + i * dataBinWidth;
      const binEnd = binStart + dataBinWidth;
      const xStart =
        padding +
        ((binStart - xAxisRange.min) / (xAxisRange.max - xAxisRange.min)) *
          width;
      const xEnd =
        padding +
        ((binEnd - xAxisRange.min) / (xAxisRange.max - xAxisRange.min)) * width;
      const barWidth = xEnd - xStart;
      const barHeight = (frequency / globalMaxFreq) * height;
      const y = canvas.height - padding - barHeight;

      const gradient = ctx.createLinearGradient(
        xStart,
        y,
        xStart,
        canvas.height - padding,
      );
      gradient.addColorStop(0, "rgba(59, 130, 246, 0.8)");
      gradient.addColorStop(1, "rgba(59, 130, 246, 0.2)");
      ctx.fillStyle = gradient;
      ctx.fillRect(xStart, y, barWidth, barHeight);
    }
    // Step annotation
    ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(
      `Step: ${formatNumber(data.step, true)}`,
      canvas.width - padding,
      padding - 10,
    );
  }, [data, theme, globalMaxFreq, xAxisRange, canvasRef]);

  useEffect(() => {
    const frameId = requestAnimationFrame(drawHistogram);
    return () => cancelAnimationFrame(frameId);
  }, [drawHistogram]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={400}
      className="w-full rounded-lg bg-background"
    />
  );
});
HistogramCanvas.displayName = "HistogramCanvas";

// ---------------------- GIF Export Utility ----------------------
async function createHistogramGif(
  canvas: HTMLCanvasElement,
  steps: HistogramStep[],
  theme: string,
  globalMaxFreq: number,
  xAxisRange: {
    min: number;
    max: number;
    globalMin: number;
    globalMax: number;
  },
  onProgress: (progress: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: canvas.width,
        height: canvas.height,
        workerScript: "/gif.worker.js",
        background: theme === "dark" ? "#000000" : "#ffffff",
        debug: true,
      });

      let processedFrames = 0;
      const totalFrames = steps.length;

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx)
        throw new Error("Failed to create temporary canvas context");

      gif.on("progress", (p: number) => onProgress(p));

      steps.forEach((step) => {
        try {
          tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
          const padding = 40;
          const width = tempCanvas.width - padding * 2;
          const height = tempCanvas.height - padding * 2;

          // Draw axes and ticks on temp canvas
          drawAxes(
            tempCtx,
            tempCanvas,
            theme,
            xAxisRange,
            globalMaxFreq,
            padding,
          );
          drawXTicks(tempCtx, tempCanvas, theme, xAxisRange, width, padding);
          drawYTicks(
            tempCtx,
            tempCanvas,
            theme,
            globalMaxFreq,
            height,
            padding,
          );

          // Draw histogram bars on temp canvas
          const { freq, bins } = step.histogramData;
          const dataBinWidth = (bins.max - bins.min) / bins.num;
          const visibleStartBin = Math.max(
            0,
            Math.floor((xAxisRange.min - bins.min) / dataBinWidth),
          );
          const visibleEndBin = Math.min(
            bins.num - 1,
            Math.ceil((xAxisRange.max - bins.min) / dataBinWidth),
          );
          for (let i = visibleStartBin; i <= visibleEndBin; i++) {
            const frequency = freq[i];
            if (frequency === undefined) continue;
            const binStart = bins.min + i * dataBinWidth;
            const binEnd = binStart + dataBinWidth;
            const xStart =
              padding +
              ((binStart - xAxisRange.min) /
                (xAxisRange.max - xAxisRange.min)) *
                width;
            const xEnd =
              padding +
              ((binEnd - xAxisRange.min) / (xAxisRange.max - xAxisRange.min)) *
                width;
            const barWidth = xEnd - xStart;
            const barHeight = (frequency / globalMaxFreq) * height;
            const y = tempCanvas.height - padding - barHeight;
            const gradient = tempCtx.createLinearGradient(
              xStart,
              y,
              xStart,
              tempCanvas.height - padding,
            );
            gradient.addColorStop(0, "rgba(59, 130, 246, 0.8)");
            gradient.addColorStop(1, "rgba(59, 130, 246, 0.2)");
            tempCtx.fillStyle = gradient;
            tempCtx.fillRect(xStart, y, barWidth, barHeight);
          }

          // Render step annotation
          tempCtx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
          tempCtx.font = "14px sans-serif";
          tempCtx.textAlign = "right";
          tempCtx.fillText(
            `Step: ${formatNumber(step.step, true)}`,
            tempCanvas.width - padding,
            tempCanvas.height - padding - 10,
          );

          gif.addFrame(tempCanvas, {
            delay: ANIMATION_CONFIG.GIF_FRAME_DELAY,
            copy: true,
            dispose: 2,
          });
          processedFrames++;
          if (processedFrames === totalFrames) gif.render();
        } catch (frameError) {
          console.error("Error processing frame:", frameError);
          throw frameError;
        }
      });

      gif.on("finished", (blob: Blob) => resolve(blob));
      gif.on("error", (error: Error) => reject(error));
    } catch (error) {
      reject(error);
    }
  });
}

// ---------------------- Main Component ----------------------
interface HistogramViewProps {
  logName: string;
  tenantId: string;
  projectName: string;
  runId: string;
}

export const HistogramView = ({
  logName,
  tenantId,
  projectName,
  runId,
}: HistogramViewProps) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState<number>(
    ANIMATION_CONFIG.DEFAULT_SPEED,
  );
  const { resolvedTheme: theme } = useTheme();
  const lastTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data, isLoading } = useGetHistogram(
    tenantId,
    projectName,
    runId,
    logName,
  );

  const sortedData = React.useMemo(() => {
    return data ? [...data].sort((a, b) => a.step - b.step) : [];
  }, [data]);

  const { globalMaxFreq, xAxisRange, normalizedData } = React.useMemo(() => {
    if (!sortedData.length) {
      return {
        globalMaxFreq: 0,
        xAxisRange: { min: 0, max: 1, globalMin: 0, globalMax: 1 },
        normalizedData: [],
      };
    }
    const globalMin = Math.min(
      ...sortedData.map((step) => step.histogramData.bins.min),
    );
    const globalMax = Math.max(
      ...sortedData.map((step) => step.histogramData.bins.max),
    );
    const optimalBinCount = Math.max(
      ...sortedData.map((step) => step.histogramData.bins.num),
    );
    const globalBinWidth = (globalMax - globalMin) / optimalBinCount;

    const normalized = sortedData.map((stepData) => {
      const { freq, bins } = stepData.histogramData;
      const oldBinWidth = (bins.max - bins.min) / bins.num;
      const newFreq = new Array(optimalBinCount).fill(0);
      freq.forEach((frequency, i) => {
        if (frequency <= 0) return;
        const oldBinStart = bins.min + i * oldBinWidth;
        const oldBinEnd = oldBinStart + oldBinWidth;
        const startBin = Math.max(
          0,
          Math.floor((oldBinStart - globalMin) / globalBinWidth),
        );
        const endBin = Math.min(
          optimalBinCount - 1,
          Math.ceil((oldBinEnd - globalMin) / globalBinWidth),
        );
        if (startBin === endBin) {
          newFreq[startBin] += frequency;
        } else {
          for (let newBin = startBin; newBin <= endBin; newBin++) {
            const binStart = globalMin + newBin * globalBinWidth;
            const binEnd = binStart + globalBinWidth;
            const overlapStart = Math.max(oldBinStart, binStart);
            const overlapEnd = Math.min(oldBinEnd, binEnd);
            const overlapWidth = Math.max(0, overlapEnd - overlapStart);
            if (overlapWidth > 0) {
              const proportion = overlapWidth / oldBinWidth;
              newFreq[newBin] += frequency * proportion;
            }
          }
        }
      });
      const cleanedFreq = newFreq.map((f) =>
        Math.max(0, Math.round(f * 1e6) / 1e6),
      );
      return {
        ...stepData,
        histogramData: {
          ...stepData.histogramData,
          freq: cleanedFreq,
          bins: { min: globalMin, max: globalMax, num: optimalBinCount },
          maxFreq: Math.max(...cleanedFreq),
        },
      };
    });

    const maxFreq = Math.max(
      ...normalized.map((step) => Math.max(...step.histogramData.freq)),
    );
    const rangeBuffer = (globalMax - globalMin) * 0.1;

    return {
      globalMaxFreq: maxFreq,
      xAxisRange: {
        min: globalMin - rangeBuffer,
        max: globalMax + rangeBuffer,
        globalMin,
        globalMax,
      },
      normalizedData: normalized,
    };
  }, [sortedData]);

  const maxStepIndex = normalizedData.length - 1;
  const currentStep = normalizedData[currentStepIndex]?.step ?? 0;
  const minStep = normalizedData[0]?.step ?? 0;
  const maxStep = normalizedData[maxStepIndex]?.step ?? 0;

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      if (timestamp - lastTimeRef.current >= animationSpeed) {
        setCurrentStepIndex((prev) => {
          if (prev >= maxStepIndex) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
        lastTimeRef.current = timestamp;
      }
      if (isPlaying) animationFrameRef.current = requestAnimationFrame(animate);
    };
    if (isPlaying) animationFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, animationSpeed, maxStepIndex]);

  const handleExport = useCallback(
    async (exportType: "snapshot" | "gif") => {
      if (!canvasRef.current) {
        toast("Canvas reference not available", {
          description: "Export failed",
        });
        return;
      }
      try {
        if (exportType === "snapshot") {
          const dataUrl = canvasRef.current.toDataURL("image/png");
          const link = document.createElement("a");
          link.download = `histogram-${logName}-step-${currentStep}.png`;
          link.href = dataUrl;
          link.click();
          toast("Snapshot saved as PNG", { description: "Export successful" });
        } else {
          setIsExporting(true);
          setExportProgress(0);
          const gifBlob = await createHistogramGif(
            canvasRef.current,
            normalizedData,
            theme,
            globalMaxFreq,
            xAxisRange,
            (progress) => setExportProgress(progress),
          );
          const url = URL.createObjectURL(gifBlob);
          const link = document.createElement("a");
          link.download = `histogram-${logName}-animation.gif`;
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
          toast("Animation saved as GIF", { description: "Export successful" });
        }
      } catch (error) {
        console.error("Export failed:", error);
        toast("Export failed", {
          description:
            error instanceof Error ? error.message : "Unknown error occurred",
        });
      } finally {
        setIsExporting(false);
        setExportProgress(0);
      }
    },
    [
      canvasRef,
      currentStep,
      logName,
      normalizedData,
      theme,
      globalMaxFreq,
      xAxisRange,
    ],
  );

  if (isLoading) {
    return (
      <div className="h-full w-full space-y-4 p-2">
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-2 p-2">
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          No histogram data found
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full space-y-4 p-2">
      <h3 className="text-center font-mono text-sm font-medium">{logName}</h3>
      <div className="space-y-2">
        <div className="relative">
          {normalizedData[currentStepIndex] && (
            <HistogramCanvas
              ref={canvasRef}
              data={normalizedData[currentStepIndex]}
              theme={theme}
              globalMaxFreq={globalMaxFreq}
              xAxisRange={xAxisRange}
            />
          )}
          {isExporting && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <div className="text-center">
                <div className="mb-2 text-sm">Exporting GIF...</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(exportProgress * 100)}%
                </div>
              </div>
            </div>
          )}
        </div>
        {normalizedData.length > 1 && (
          <>
            <div className="text-center font-mono text-xs text-muted-foreground">
              Step {formatNumber(currentStep, true)} of{" "}
              {formatNumber(maxStep, true)}
            </div>
            <AnimationControls
              currentStep={currentStepIndex}
              maxStep={maxStepIndex}
              isPlaying={isPlaying}
              animationSpeed={animationSpeed}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              onStepChange={setCurrentStepIndex}
              onSpeedChange={setAnimationSpeed}
              onExport={handleExport}
              isExporting={isExporting}
              currentStepValue={currentStep}
              maxStepValue={maxStep}
            />
          </>
        )}
      </div>
    </div>
  );
};
