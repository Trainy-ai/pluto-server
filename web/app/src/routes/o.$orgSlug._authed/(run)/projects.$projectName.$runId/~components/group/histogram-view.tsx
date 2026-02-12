import React, { useEffect, useRef, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/lib/hooks/use-theme";
import { toast } from "@/components/ui/sonner";
import { useGetHistogram } from "../../~queries/get-histogram";
import { StepNavigator } from "../shared/step-navigator";
import {
  ANIMATION_CONFIG,
  formatNumber,
  type HistogramStep,
} from "./histogram-canvas-utils";
import { AnimationControls } from "./histogram-animation-controls";
import { HistogramCanvas } from "./histogram-canvas";
import { createHistogramGif } from "./histogram-gif-export";

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
        normalizedData: [] as HistogramStep[],
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
              currentStepValue={currentStep}
              maxStepValue={maxStep}
            />
          </>
        )}
      </div>
    </div>
  );
};
