import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/lib/hooks/use-theme";
import GIF from "gif.js";
import { toast } from "@/components/ui/sonner";
import { useGetHistogram } from "../../~queries/get-histogram";
import { StepNavigator } from "../shared/step-navigator";
import { useHistogramCanvas } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/hooks/use-histogram-canvas";
import { AnimationControls } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/components/animation-controls";

// Default color for single-run histograms
const DEFAULT_HISTOGRAM_COLOR = "hsl(216, 66%, 60%)";

const ANIMATION_CONFIG = {
  MIN_SPEED: 1,
  MAX_SPEED: 1000,
  DEFAULT_SPEED: 10,
  GIF_FRAME_DELAY: 100,
} as const;

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

// ---------------------- Utility ----------------------
function formatNumber(value: number, isInteger = false): string {
  if (value === 0) return "0";
  if (isInteger) return value.toFixed(0);
  const absValue = Math.abs(value);
  if (absValue < 0.0001 || absValue >= 1000000) return value.toExponential(2);
  if (absValue < 0.1) return value.toFixed(4);
  if (absValue < 1000) return value.toFixed(2);
  return value.toFixed(1);
}

// ---------------------- Shared Canvas Component ----------------------
// Same canvas component used by multi-group/histogram-view.tsx (SingleRunHistogramCanvas)
function HistogramCanvas({
  data,
  theme,
  globalMaxFreq,
  xAxisRange,
  color = DEFAULT_HISTOGRAM_COLOR,
  canvasRef: externalCanvasRef,
}: {
  data: HistogramStep;
  theme: string;
  globalMaxFreq: number;
  xAxisRange: { min: number; max: number };
  color?: string;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = externalCanvasRef || internalCanvasRef;
  const { drawSingleHistogram } = useHistogramCanvas();

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current || !data) return;

    const draw = () => {
      if (!canvasRef.current || !data) return;
      canvasRef.current.style.width = "100%";
      canvasRef.current.style.height = "100%";
      drawSingleHistogram({
        canvas: canvasRef.current,
        data,
        xAxisRange,
        theme,
        globalMaxFreq,
        color,
        hideStepLabel: true,
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [data, theme, globalMaxFreq, xAxisRange, canvasRef, drawSingleHistogram, color]);

  return (
    <div ref={containerRef} className="relative min-h-[200px] w-full overflow-hidden rounded-md bg-background/50">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
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
  const { drawSingleHistogram } = useHistogramCanvas();
  const lastTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data, isLoading } = useGetHistogram(
    tenantId,
    projectName,
    runId,
    logName,
  );

  const sortedData = useMemo(() => {
    return data ? [...data].sort((a, b) => a.step - b.step) : [];
  }, [data]);

  const { globalMaxFreq, xAxisRange, normalizedData } = useMemo(() => {
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
        toast("Canvas reference not available", { description: "Export failed" });
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
            drawSingleHistogram,
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
          description: error instanceof Error ? error.message : "Unknown error occurred",
        });
      } finally {
        setIsExporting(false);
        setExportProgress(0);
      }
    },
    [currentStep, logName, normalizedData, theme, globalMaxFreq, xAxisRange, drawSingleHistogram],
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
      <div className="h-full w-full space-y-4 p-2">
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
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">{logName}</h3>
      <div className="space-y-2">
        <div className="relative">
          {normalizedData[currentStepIndex] && (
            <HistogramCanvas
              data={normalizedData[currentStepIndex]}
              theme={theme}
              globalMaxFreq={globalMaxFreq}
              xAxisRange={xAxisRange}
              canvasRef={canvasRef}
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
            <StepNavigator
              currentStepIndex={currentStepIndex}
              currentStepValue={currentStep}
              availableSteps={normalizedData.map((d) => d.step)}
              onStepChange={setCurrentStepIndex}
            />
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
            />
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------- GIF Export ----------------------
async function createHistogramGif(
  canvas: HTMLCanvasElement,
  steps: HistogramStep[],
  theme: string,
  globalMaxFreq: number,
  xAxisRange: { min: number; max: number; globalMin: number; globalMax: number },
  drawFn: (opts: any) => void,
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

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;

      gif.on("progress", (p: number) => onProgress(p));

      let processedFrames = 0;
      steps.forEach((step) => {
        drawFn({
          canvas: tempCanvas,
          data: step,
          xAxisRange,
          theme,
          globalMaxFreq,
          color: DEFAULT_HISTOGRAM_COLOR,
          hideStepLabel: false,
        });

        gif.addFrame(tempCanvas, {
          delay: ANIMATION_CONFIG.GIF_FRAME_DELAY,
          copy: true,
          dispose: 2,
        });
        processedFrames++;
        if (processedFrames === steps.length) gif.render();
      });

      gif.on("finished", (blob: Blob) => resolve(blob));
      gif.on("error", (error: Error) => reject(error));
    } catch (error) {
      reject(error);
    }
  });
}
