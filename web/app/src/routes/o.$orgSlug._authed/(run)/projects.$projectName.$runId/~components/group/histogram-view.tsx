import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/lib/hooks/use-theme";
import GIF from "gif.js";
import { toast } from "@/components/ui/sonner";
import { useGetHistogram } from "../../~queries/get-histogram";
import { StepNavigator } from "../shared/step-navigator";
import { useSyncedStepNavigation } from "../../~hooks/use-synced-step-navigation";
import { useHistogramCanvas } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/hooks/use-histogram-canvas";
import { AnimationControls } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/components/animation-controls";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SlidersHorizontalIcon } from "lucide-react";
import { HistogramAxisControlsInline } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/components/histogram-axis-controls-inline";
import type { AxisBounds } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/components/histogram-axis-controls";
import {
  drawRidgeline,
  drawRidgelineHoverHighlight,
  hitTestRidgelinePolygons,
  RIDGELINE_LAYOUT,
  sampleStepsForRidgeline,
  computeGlobalMaxFreq as computeRidgelineMaxFreq,
  computeGlobalXDomain as computeRidgelineXDomain,
} from "./ridgeline-canvas";
import {
  drawHeatmap,
  drawHeatmapHighlight,
  hitTestCell,
  HEATMAP_LAYOUT,
  computeGlobalXDomain as computeHeatmapXDomain,
} from "./heatmap-canvas";
import type { HistogramStep } from "./histogram-canvas-utils";
import { computeStepXRange, computeStepMaxFreq } from "./histogram-step-axes";
import { AxisOverlayLabels } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/components/axis-overlay-labels";
import { ColorLegendOverlay } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/components/color-legend-overlay";

const DEFAULT_HISTOGRAM_COLOR = "hsl(216, 66%, 60%)";

const ANIMATION_CONFIG = {
  MIN_SPEED: 1,
  MAX_SPEED: 1000,
  DEFAULT_SPEED: 10,
  GIF_FRAME_DELAY: 100,
} as const;

export type HistogramViewMode = "step" | "ridgeline" | "heatmap";

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

// ---------------------- Mode Toggle ----------------------
interface HistogramModeToggleProps {
  mode: HistogramViewMode;
  onChange: (mode: HistogramViewMode) => void;
}

function HistogramModeToggle({ mode, onChange }: HistogramModeToggleProps) {
  return (
    <Tabs
      value={mode}
      onValueChange={(v) => onChange(v as HistogramViewMode)}
      data-testid="histogram-mode-toggle"
    >
      <TabsList className="h-7 p-0.5">
        <TabsTrigger
          value="step"
          className="h-6 px-2 text-xs"
          data-testid="histogram-mode-step"
        >
          Step
        </TabsTrigger>
        <TabsTrigger
          value="ridgeline"
          className="h-6 px-2 text-xs"
          data-testid="histogram-mode-ridgeline"
        >
          Ridgeline
        </TabsTrigger>
        <TabsTrigger
          value="heatmap"
          className="h-6 px-2 text-xs"
          data-testid="histogram-mode-heatmap"
        >
          Heatmap
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// Mirrors the chart-area padding rule used inside drawSingleHistogram
// (use-histogram-canvas.ts). The drawer computes this on every render
// from the canvas's CSS dimensions; the hover hit-test has to match
// exactly so cursor X maps to the same bin position the bars draw at.
function singleHistogramPadding(width: number, height: number): number {
  const minDim = Math.min(width, height);
  return Math.max(40, Math.min(60, minDim * 0.1));
}

interface StepHistogramHover {
  binIdx: number;
  binStart: number;
  binEnd: number;
  freq: number;
  cursorX: number;
  cursorY: number;
  containerWidth: number;
  containerHeight: number;
}

// ---------------------- Shared Canvas Component (Step mode) ----------------------
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
  const [hover, setHover] = useState<StepHistogramHover | null>(null);

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
        highlightBinIdx: hover?.binIdx,
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [data, theme, globalMaxFreq, xAxisRange, canvasRef, drawSingleHistogram, color, hover?.binIdx]);

  // Reset hover when the step changes (slider scrub) so a stale
  // tooltip doesn't keep showing the previous step's bin value.
  useEffect(() => { setHover(null); }, [data]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || !data) return;
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const padding = singleHistogramPadding(rect.width, rect.height);
      const availableWidth = rect.width - padding * 2;
      const availableHeight = rect.height - padding * 2;
      if (
        cursorX < padding ||
        cursorX > rect.width - padding ||
        cursorY < padding ||
        cursorY > rect.height - padding ||
        availableWidth <= 0 ||
        availableHeight <= 0
      ) {
        setHover(null);
        return;
      }
      const xRange = xAxisRange.max - xAxisRange.min;
      if (xRange <= 0) { setHover(null); return; }
      const xValue =
        xAxisRange.min + ((cursorX - padding) / availableWidth) * xRange;
      const { bins, freq } = data.histogramData;
      const dataBinWidth = (bins.max - bins.min) / bins.num;
      if (dataBinWidth <= 0) { setHover(null); return; }
      const binIdxF = (xValue - bins.min) / dataBinWidth;
      if (binIdxF < 0 || binIdxF >= bins.num) { setHover(null); return; }
      const binIdx = Math.floor(binIdxF);
      const binStart = bins.min + binIdx * dataBinWidth;
      const binEnd = binStart + dataBinWidth;
      setHover({
        binIdx,
        binStart,
        binEnd,
        freq: freq[binIdx] ?? 0,
        cursorX,
        cursorY,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    },
    [data, xAxisRange],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const TOOLTIP_W = 200;
  const TOOLTIP_H = 84;
  const OFFSET = 12;
  const tooltipLeft = hover
    ? hover.cursorX + OFFSET + TOOLTIP_W <= hover.containerWidth
      ? hover.cursorX + OFFSET
      : Math.max(0, hover.cursorX - OFFSET - TOOLTIP_W)
    : 0;
  const tooltipTop = hover
    ? hover.cursorY + OFFSET + TOOLTIP_H <= hover.containerHeight
      ? hover.cursorY + OFFSET
      : Math.max(0, hover.cursorY - OFFSET - TOOLTIP_H)
    : 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[200px] w-full overflow-hidden rounded-md bg-background/50"
      data-testid="histogram-canvas-container"
      data-histogram-mode="step"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <AxisOverlayLabels xLabel="Value" yLabel="Freq" />
      {hover && (
        <div
          data-testid="histogram-step-tooltip"
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 font-mono text-xs text-popover-foreground shadow-md"
          style={{ left: tooltipLeft, top: tooltipTop, width: TOOLTIP_W }}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <span
              className="inline-block size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span>Bin {hover.binIdx + 1}</span>
          </div>
          <div className="text-muted-foreground">
            range: {formatNumber(hover.binStart)} – {formatNumber(hover.binEnd)}
          </div>
          <div className="text-muted-foreground">
            count: {formatNumber(hover.freq, true)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------- Step Mode View ----------------------
interface StepHistogramViewProps {
  logName: string;
  sortedData: HistogramStep[];
  theme: string;
  color?: string;
  /** Optional X/Y overrides set via the histogram settings popover. */
  axisBounds?: AxisBounds;
  /** Locked = share one axis across all steps; unlocked (default) = per-step. */
  lockAxes?: boolean;
}

function StepHistogramView({
  logName,
  sortedData,
  theme,
  color = DEFAULT_HISTOGRAM_COLOR,
  axisBounds,
  lockAxes = false,
}: StepHistogramViewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState<number>(
    ANIMATION_CONFIG.DEFAULT_SPEED,
  );
  const { drawSingleHistogram } = useHistogramCanvas();
  const lastTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { globalMaxFreq, xAxisRange, stepData } = useMemo(() => {
    if (!sortedData.length) {
      return {
        globalMaxFreq: 0,
        xAxisRange: { min: 0, max: 1, globalMin: 0, globalMax: 1 },
        stepData: [],
      };
    }
    const globalMin = Math.min(
      ...sortedData.map((step) => step.histogramData.bins.min),
    );
    const globalMax = Math.max(
      ...sortedData.map((step) => step.histogramData.bins.max),
    );

    // Draw each step's NATIVE bins, positioned by value on the shared X axis.
    // We deliberately do NOT resample every step onto one union grid: that
    // grid's width is fixed by the WIDEST step, so a single wide-range step
    // (e.g. a uniform [0, 100] step logged alongside [-4, 4] bell steps) makes
    // the shared bins coarse, and every narrow step then piles many source bins
    // into one display bin. That produced a huge FALSE spike (bar height and
    // tooltip disagreed) and inflated globalMaxFreq — the shared Y axis — with
    // the artifact, flattening every other step. drawSingleHistogram already
    // maps native bin positions onto xAxisRange, so no resampling is needed;
    // this matches the multi-group histogram view, which never rebins. For the
    // common case where every step shares one grid this is a no-op.
    const globalMaxFreq = Math.max(
      1,
      ...sortedData.map((step) => step.histogramData.maxFreq),
    );
    const rangeBuffer = (globalMax - globalMin) * 0.1;

    return {
      globalMaxFreq,
      xAxisRange: {
        min: globalMin - rangeBuffer,
        max: globalMax + rangeBuffer,
        globalMin,
        globalMax,
      },
      stepData: sortedData,
    };
  }, [sortedData]);

  // Step-view axes are scaled to the CURRENT step, computed below once
  // currentStepIndex is known (see effectiveXAxisRange / effectiveGlobalMaxFreq).

  const {
    currentStepIndex,
    currentStepValue: currentStep,
    availableSteps: stepValues,
    goToStepIndex,
    isLocked,
    setIsLocked,
    hasSyncContext,
  } = useSyncedStepNavigation(stepData);

  const maxStepIndex = Math.max(0, stepValues.length - 1);
  const maxStep = stepData[maxStepIndex]?.step ?? 0;

  // Scale the Step view to the CURRENT step's OWN bin range (X) and peak (Y) —
  // like W&B — not the union/max across all steps. A single wide-range step
  // (e.g. weights spanning 0–2000 at one step) would otherwise stretch the
  // shared X axis and squish every narrow step into an unreadable sliver at the
  // origin; a single tall step would likewise flatten the rest on Y. Manual
  // clamps from the settings popover still win. (The cross-step `xAxisRange` /
  // `globalMaxFreq` are kept for the GIF export's stable animation axis.)
  const effectiveXAxisRange = useMemo(() => {
    // Locked: share the cross-step union range (pre-per-step behavior).
    // Unlocked (default): each step scaled to its own bin range. Shared
    // locked-vs-per-step-vs-override logic lives in computeStepXRange.
    const b = stepData[currentStepIndex]?.histogramData.bins;
    const { min, max } = computeStepXRange({
      lockAxes,
      currentBins: b,
      lockedRange: xAxisRange,
      xMinOverride: axisBounds?.xMin,
      xMaxOverride: axisBounds?.xMax,
    });
    // globalMin/globalMax are retained for the GIF export's stable animation
    // axis: they track the per-step bins when unlocked, else the cross-step
    // union carried on xAxisRange.
    const usingPerStep = !lockAxes && b !== undefined && b.max > b.min;
    return {
      min,
      max,
      globalMin: usingPerStep ? b.min : xAxisRange.globalMin,
      globalMax: usingPerStep ? b.max : xAxisRange.globalMax,
    };
  }, [lockAxes, stepData, currentStepIndex, xAxisRange, axisBounds?.xMin, axisBounds?.xMax]);
  const effectiveGlobalMaxFreq = useMemo(
    () =>
      computeStepMaxFreq({
        lockAxes,
        currentMaxFreq: stepData[currentStepIndex]?.histogramData.maxFreq,
        lockedMaxFreq: globalMaxFreq,
        yMaxOverride: axisBounds?.yMax,
      }),
    [lockAxes, stepData, currentStepIndex, axisBounds?.yMax, globalMaxFreq],
  );

  const setCurrentStepIndex = useCallback(
    (valueOrUpdater: number | ((prev: number) => number)) => {
      if (typeof valueOrUpdater === "function") {
        const newIndex = valueOrUpdater(currentStepIndex);
        goToStepIndex(newIndex);
      } else {
        goToStepIndex(valueOrUpdater);
      }
    },
    [goToStepIndex, currentStepIndex],
  );

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
  }, [isPlaying, animationSpeed, maxStepIndex, setCurrentStepIndex]);

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
            stepData,
            theme,
            globalMaxFreq,
            xAxisRange,
            drawSingleHistogram,
            (progress) => setExportProgress(progress),
            color,
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
    [currentStep, logName, stepData, theme, globalMaxFreq, xAxisRange, drawSingleHistogram, color],
  );

  return (
    <div className="flex h-full w-full flex-col space-y-4">
      <div className="min-h-0 flex-1">
        <div className="relative h-full">
          {stepData[currentStepIndex] && (
            <HistogramCanvas
              data={stepData[currentStepIndex]}
              theme={theme}
              globalMaxFreq={effectiveGlobalMaxFreq}
              xAxisRange={effectiveXAxisRange}
              color={color}
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
      </div>
      {stepData.length > 1 && (
        <div className="sticky bottom-0 space-y-2 border-t border-border bg-background pt-1.5 pb-0.5">
          <StepNavigator
            currentStepIndex={currentStepIndex}
            currentStepValue={currentStep}
            availableSteps={stepValues}
            onStepChange={goToStepIndex}
            isLocked={isLocked}
            onLockChange={setIsLocked}
            showLock={hasSyncContext}
          />
          <div className="text-center font-mono text-xs text-muted-foreground">
            Step {formatNumber(currentStep, true)} of{" "}
            {formatNumber(maxStep, true)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------- Ridgeline Mode View ----------------------
interface RidgelineHistogramViewProps {
  steps: HistogramStep[];
  theme: string;
  color?: string;
  /** Settings-popover X clamp. Y max ignored in Ridgeline. */
  axisBounds?: AxisBounds;
  /** Transpose: violin-per-step rotated 90° so peaks point leftward. */
  stepsOnX?: boolean;
}

interface RidgelineHover {
  stepIdx: number;
  cursorX: number;
  cursorY: number;
  containerWidth: number;
  containerHeight: number;
}

function RidgelineHistogramView({
  steps,
  theme,
  color = DEFAULT_HISTOGRAM_COLOR,
  axisBounds,
  stepsOnX = false,
}: RidgelineHistogramViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<RidgelineHover | null>(null);

  const displayedSteps = useMemo(() => sampleStepsForRidgeline(steps), [steps]);

  // Build the effective X domain from the user clamp, falling back to
  // the data's natural [min, max]. Skip when both clamps are unset so
  // the canvas keeps its own auto-computed domain.
  const effectiveXDomain = useMemo<[number, number] | undefined>(() => {
    if (axisBounds?.xMin == null && axisBounds?.xMax == null) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of displayedSteps) {
      if (s.histogramData.bins.min < lo) lo = s.histogramData.bins.min;
      if (s.histogramData.bins.max > hi) hi = s.histogramData.bins.max;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    return [axisBounds.xMin ?? lo, axisBounds.xMax ?? hi];
  }, [displayedSteps, axisBounds?.xMin, axisBounds?.xMax]);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRidgeline(ctx, {
        steps: displayedSteps,
        width: rect.width,
        height: rect.height,
        baseColor: color,
        theme: theme === "dark" ? "dark" : "light",
        globalXDomain: effectiveXDomain,
        stepsOnX,
        // In transposed mode the hovered ridge gets a second pass
        // outside the chart-area clip so its leftward peak spills
        // visibly past the Y axis labels (mirrors the multi-run view).
        hoverStepIdx: stepsOnX && hover ? hover.stepIdx : undefined,
      });
      if (hover) {
        const xDomain: [number, number] =
          effectiveXDomain ?? computeRidgelineXDomain(displayedSteps);
        drawRidgelineHoverHighlight({
          ctx,
          width: rect.width,
          height: rect.height,
          steps: displayedSteps,
          globalXDomain: xDomain,
          globalMaxFreq: computeRidgelineMaxFreq(displayedSteps),
          hoverStepIdx: hover.stepIdx,
          theme: theme === "dark" ? "dark" : "light",
          stepsOnX,
        });
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [displayedSteps, theme, color, effectiveXDomain, hover, stepsOnX]);

  useEffect(() => {
    setHover(null);
  }, [displayedSteps]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || displayedSteps.length === 0) return;
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      // Polygon-containment hit-test (mirrors the all-runs page) so the
      // tooltip attributes the cursor to the ridge actually visible
      // underneath. Falls back to the next-baseline-below rule for
      // dead-space cursors.
      const xDomain: [number, number] =
        effectiveXDomain ?? computeRidgelineXDomain(displayedSteps);
      const slotIdx = hitTestRidgelinePolygons(
        cursorX,
        cursorY,
        displayedSteps,
        {
          width: rect.width,
          height: rect.height,
          topMargin: RIDGELINE_LAYOUT.topMargin,
          bottomMargin: RIDGELINE_LAYOUT.bottomMargin,
          // In transposed mode the chart area inflates to mirror the
          // multi-run view's 120/16 margins; non-transposed keeps the
          // original rightGutter/rightMargin layout.
          xLeft: stepsOnX
            ? RIDGELINE_LAYOUT.leftMargin
            : RIDGELINE_LAYOUT.rightGutter,
          xRight: stepsOnX
            ? rect.width - 44
            : rect.width - RIDGELINE_LAYOUT.rightMargin,
        },
        xDomain,
        computeRidgelineMaxFreq(displayedSteps),
        { stepsOnX },
      );
      if (slotIdx === null) {
        setHover(null);
        return;
      }
      setHover({
        // Oldest at top means slotIdx 0 is stepIdx 0; no inversion.
        stepIdx: slotIdx,
        cursorX,
        cursorY,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    },
    [displayedSteps, effectiveXDomain, stepsOnX],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hovered = hover ? displayedSteps[hover.stepIdx] : null;
  const TOOLTIP_W = 168;
  const TOOLTIP_H = 84;
  const OFFSET = 12;
  const tooltipLeft = hover
    ? hover.cursorX + OFFSET + TOOLTIP_W <= hover.containerWidth
      ? hover.cursorX + OFFSET
      : Math.max(0, hover.cursorX - OFFSET - TOOLTIP_W)
    : 0;
  const tooltipTop = hover
    ? hover.cursorY + OFFSET + TOOLTIP_H <= hover.containerHeight
      ? hover.cursorY + OFFSET
      : Math.max(0, hover.cursorY - OFFSET - TOOLTIP_H)
    : 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[300px] w-full overflow-hidden rounded-md bg-background/50"
      data-testid="histogram-canvas-container"
      data-histogram-mode="ridgeline"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <AxisOverlayLabels
        xLabel={stepsOnX ? "Step" : "Value"}
        yLabel={stepsOnX ? "Value" : "Step"}
      />
      {hover && hovered && (
        <div
          data-testid="histogram-ridgeline-tooltip"
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 font-mono text-xs text-popover-foreground shadow-md"
          style={{ left: tooltipLeft, top: tooltipTop, width: TOOLTIP_W }}
        >
          <div className="font-semibold">
            Step {formatNumber(hovered.step, true)}
          </div>
          <div className="text-muted-foreground">
            min: {formatNumber(hovered.histogramData.bins.min)}
          </div>
          <div className="text-muted-foreground">
            max: {formatNumber(hovered.histogramData.bins.max)}
          </div>
          <div className="text-muted-foreground">
            maxFreq: {formatNumber(hovered.histogramData.maxFreq, true)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------- Heatmap Mode View ----------------------
interface HeatmapHistogramViewProps {
  steps: HistogramStep[];
  theme: string;
  color?: string;
  /** Settings-popover X clamp. Y max ignored in Heatmap. */
  axisBounds?: AxisBounds;
  /** Transpose: bins on Y, steps on X (W&B-style). */
  stepsOnX?: boolean;
}

interface HeatmapHover {
  stepIdx: number;
  binIdx: number;
  cursorX: number;
  cursorY: number;
  containerWidth: number;
  containerHeight: number;
}

function HeatmapHistogramView({
  steps,
  theme,
  color = DEFAULT_HISTOGRAM_COLOR,
  axisBounds,
  stepsOnX = false,
}: HeatmapHistogramViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HeatmapHover | null>(null);

  const globalXDomain = useMemo<[number, number]>(
    () => (steps.length > 0 ? computeHeatmapXDomain(steps) : [0, 1]),
    [steps],
  );
  // Apply the settings-popover X clamp on top of the data-derived
  // domain. Each side falls back independently when only one bound
  // is set.
  const effectiveXDomain = useMemo<[number, number]>(
    () => [
      axisBounds?.xMin ?? globalXDomain[0],
      axisBounds?.xMax ?? globalXDomain[1],
    ],
    [globalXDomain, axisBounds?.xMin, axisBounds?.xMax],
  );

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawHeatmap(ctx, {
        steps,
        width: rect.width,
        height: rect.height,
        baseColor: color,
        scale: "linear",
        theme: theme === "dark" ? "dark" : "light",
        globalXDomain: effectiveXDomain,
        stepsOnX,
      });
      if (hover) {
        drawHeatmapHighlight({
          ctx,
          width: rect.width,
          height: rect.height,
          steps,
          globalXDomain: effectiveXDomain,
          hoverStepIdx: hover.stepIdx,
          hoverBinIdx: hover.binIdx,
          theme: theme === "dark" ? "dark" : "light",
          stepsOnX,
        });
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [steps, theme, color, effectiveXDomain, hover, stepsOnX]);

  useEffect(() => {
    setHover(null);
  }, [steps]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || steps.length === 0) return;
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      // In transposed mode leftMargin/rightMargin mirror what drawHeatmap
      // uses (120 left, 16 right) so the cursor maps to the painted cell.
      const cell = hitTestCell(
        cursorX,
        cursorY,
        steps,
        {
          width: rect.width,
          height: rect.height,
          leftMargin: stepsOnX
            ? HEATMAP_LAYOUT.leftMargin
            : HEATMAP_LAYOUT.leftMargin,
          rightMargin: stepsOnX ? 44 : HEATMAP_LAYOUT.rightMargin,
          topMargin: HEATMAP_LAYOUT.topMargin,
          bottomMargin: HEATMAP_LAYOUT.bottomMargin,
          globalXDomain: effectiveXDomain,
        },
        { stepsOnX },
      );
      if (cell === null) {
        setHover(null);
        return;
      }
      setHover({
        stepIdx: cell.stepIdx,
        binIdx: cell.binIdx,
        cursorX,
        cursorY,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    },
    [steps, effectiveXDomain, stepsOnX],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hoveredStep = hover ? steps[hover.stepIdx] : null;
  const hoveredBin = useMemo(() => {
    if (!hover || !hoveredStep) return null;
    const { bins, freq } = hoveredStep.histogramData;
    if (bins.num <= 0) return null;
    const binWidth = (bins.max - bins.min) / bins.num;
    const binStart = bins.min + hover.binIdx * binWidth;
    const binEnd = binStart + binWidth;
    const f = freq[hover.binIdx] ?? 0;
    return { binStart, binEnd, freq: f };
  }, [hover, hoveredStep]);

  const TOOLTIP_W = 200;
  const TOOLTIP_H = 84;
  const OFFSET = 12;
  const tooltipLeft = hover
    ? hover.cursorX + OFFSET + TOOLTIP_W <= hover.containerWidth
      ? hover.cursorX + OFFSET
      : Math.max(0, hover.cursorX - OFFSET - TOOLTIP_W)
    : 0;
  const tooltipTop = hover
    ? hover.cursorY + OFFSET + TOOLTIP_H <= hover.containerHeight
      ? hover.cursorY + OFFSET
      : Math.max(0, hover.cursorY - OFFSET - TOOLTIP_H)
    : 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[300px] w-full overflow-hidden rounded-md bg-background/50"
      data-testid="histogram-canvas-container"
      data-histogram-mode="heatmap"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <AxisOverlayLabels
        xLabel={stepsOnX ? "Step" : "Value"}
        yLabel={stepsOnX ? "Value" : "Step"}
      />
      <ColorLegendOverlay
        kind="heatmap"
        baseColor={color}
        theme={theme === "dark" ? "dark" : "light"}
        maxFreq={computeRidgelineMaxFreq(steps)}
        title="Freq"
      />
      {hover && hoveredStep && hoveredBin && (
        <div
          data-testid="histogram-heatmap-tooltip"
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 font-mono text-xs text-popover-foreground shadow-md"
          style={{ left: tooltipLeft, top: tooltipTop, width: TOOLTIP_W }}
        >
          <div className="font-semibold">
            Step {formatNumber(hoveredStep.step, true)}
          </div>
          <div className="text-muted-foreground">
            bin: [{formatNumber(hoveredBin.binStart)},{" "}
            {formatNumber(hoveredBin.binEnd)})
          </div>
          <div className="text-muted-foreground">
            freq: {formatNumber(hoveredBin.freq, true)}
          </div>
        </div>
      )}
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

// NOTE: The single-run Step view draws each step's NATIVE bins — it does NOT
// re-bin onto a shared `[globalMin, globalMax]` grid (see the block below,
// which now just passes steps through). It previously resampled, which made a
// wide-range step coarsen the grid and pile narrow steps' frequency onto edge
// bins — a false spike. With native bins, an outlier-fenced X/Y clamp simply
// clips the outlier step at the edges, so the fence behaves like the multi-run
// view's "Ignore outliers". The settings popover surfaces X min / X max / Y max
// here for manual clamping.
export const HistogramView = ({
  logName,
  tenantId,
  projectName,
  runId,
}: HistogramViewProps) => {
  const [mode, setMode] = useState<HistogramViewMode>("ridgeline");
  const { resolvedTheme: theme } = useTheme();
  // Settings-popover state — mirrors the multi-run histogram-view so
  // both pages expose the same X min / X max / Y max controls. Y max
  // applies only in Step mode (frequency-on-Y); X bounds apply in all
  // three modes. Hoist above any early returns so React's hook order
  // stays stable across loading → loaded transitions.
  const [axisBounds, setAxisBounds] = useState<AxisBounds>({});
  // Lock axes across steps (Step mode). Default unlocked = per-step scaling.
  const [lockAxes, setLockAxes] = useState(false);
  // Steps-on-X transpose (Ridgeline + Heatmap only). Local-only state on
  // this view — the IR Charts tab auto-discovers metrics and has no
  // dashboard config to persist the flag against, unlike the
  // multi-run histogram view where stepsOnX rides on the distributions
  // widget's per-entry config. Flipped via the same
  // HistogramAxisControlsInline checkbox the dashboard side uses.
  const [stepsOnXLocal, setStepsOnXLocal] = useState(false);
  const stepsOnXDisabled = mode === "step";
  const stepsOnX = !stepsOnXDisabled && stepsOnXLocal;
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!settingsOpen) return;
    const openedAt = Date.now();
    const handler = () => {
      if (Date.now() - openedAt < 250) return;
      setSettingsOpen(false);
    };
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [settingsOpen]);
  const isStepMode = mode === "step";

  const { data, isLoading } = useGetHistogram(
    tenantId,
    projectName,
    runId,
    logName,
  );

  // Backend orders by step ASC; no client-side sort needed.
  const sortedData = useMemo<HistogramStep[]>(() => data?.rows ?? [], [data]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col gap-2 p-4">
        <h3 className="truncate font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <Skeleton className="min-h-0 w-full flex-1" />
      </div>
    );
  }

  if (!data?.rows?.length) {
    return (
      <div className="flex h-full w-full flex-col gap-2 p-4">
        <h3 className="truncate font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          No histogram data found
        </div>
      </div>
    );
  }

  // Settings popover — matches the multi-run view's chart-widget-style
  // chrome: plain ghost icon with no semi-opaque backdrop and no Radix
  // tooltip, so it reads as a hover-toolbar icon rather than a chunky
  // button parked on the canvas.
  const settingsButton = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          data-testid="histogram-settings-btn"
          aria-label="Histogram settings"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <HistogramAxisControlsInline
          axisBounds={axisBounds}
          onAxisBoundsChange={setAxisBounds}
          showYMax={isStepMode}
          lockAxes={lockAxes}
          onLockAxesChange={setLockAxes}
          stepsOnX={stepsOnX}
          onStepsOnXChange={setStepsOnXLocal}
          stepsOnXDisabled={stepsOnXDisabled}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <MediaCardWrapper
      title={logName}
      className="h-full w-full"
      toolbarExtra={settingsButton}
    >
      <div
        data-testid="histogram-widget"
        data-histogram-view-mode={mode}
        data-histogram-steps-on-x={stepsOnX ? "true" : "false"}
        className="flex h-full w-full flex-col gap-2 p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-mono text-sm font-medium text-muted-foreground">
            {logName}
          </h3>
          {/* mr-16 (64px) clears the absolute-positioned hover gear +
              fullscreen icons in MediaCardWrapper's top-right corner,
              matching the multi-run histogram view's spacing. */}
          <div className="mr-16">
            <HistogramModeToggle mode={mode} onChange={setMode} />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {mode === "step" ? (
            <StepHistogramView
              logName={logName}
              sortedData={sortedData}
              theme={theme}
              axisBounds={axisBounds}
              lockAxes={lockAxes}
            />
          ) : mode === "ridgeline" ? (
            <RidgelineHistogramView
              steps={sortedData}
              theme={theme}
              axisBounds={axisBounds}
              stepsOnX={stepsOnX}
            />
          ) : (
            <HeatmapHistogramView
              steps={sortedData}
              theme={theme}
              axisBounds={axisBounds}
              stepsOnX={stepsOnX}
            />
          )}
        </div>
      </div>
    </MediaCardWrapper>
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
  color: string,
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
          color,
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
