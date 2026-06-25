import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useNormalizedHistogramData } from "./hooks/use-normalized-histogram";
import { computeHistogramFences } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/histogram-outlier-fences";
import {
  useHistogramCanvas,
  type HistogramStep,
} from "./hooks/use-histogram-canvas";
import { type AxisBounds } from "./components/histogram-axis-controls";
import { HistogramAxisControlsInline } from "./components/histogram-axis-controls-inline";
import { HistogramFooterSliders } from "./components/histogram-footer-sliders";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SlidersHorizontalIcon } from "lucide-react";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import { extractCaptionFromDOM } from "@/components/charts/chart-export-utils";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { useSyncedRunNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/run-sync-context";
import {
  drawRidgeline,
  drawRidgelineHoverHighlight,
  hitTestRidgelinePolygons,
  RIDGELINE_LAYOUT,
  sampleStepsForRidgeline,
  computeGlobalXDomain as computeRidgelineXDomain,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/ridgeline-canvas";
import {
  drawHeatmap,
  drawHeatmapHighlight,
  hitTestCell,
  HEATMAP_LAYOUT,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/heatmap-canvas";
import { AxisOverlayLabels } from "./components/axis-overlay-labels";
import { ColorLegendOverlay } from "./components/color-legend-overlay";

export type HistogramViewMode = "step" | "ridgeline" | "heatmap";

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

export function HistogramModeToggle({ mode, onChange }: HistogramModeToggleProps) {
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

// ---------------------- Step Mode: Single-Run Histogram Canvas ----------------------
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
  const [hover, setHover] = useState<StepHistogramHover | null>(null);

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
        highlightBinIdx: hover?.binIdx,
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [stepData, xAxisRange, globalMaxFreq, theme, runColor, drawSingleHistogram, hover?.binIdx]);

  // Resetting hover on step data change avoids a stale tooltip showing
  // the previous step's bin/value when the slider scrubs.
  useEffect(() => { setHover(null); }, [stepData]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || !stepData) return;
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const padding = singleHistogramPadding(rect.width, rect.height);
      const availableWidth = rect.width - padding * 2;
      const availableHeight = rect.height - padding * 2;
      // Outside the plot area → no hover.
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
      const { bins, freq } = stepData.histogramData;
      const dataBinWidth = (bins.max - bins.min) / bins.num;
      if (dataBinWidth <= 0) { setHover(null); return; }
      const binIdxF = (xValue - bins.min) / dataBinWidth;
      // Cursor falls outside this step's actual bin range — no bar to
      // attribute the hover to.
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
    [stepData, xAxisRange],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  // Tooltip positioning mirrors the Ridgeline/Heatmap pattern: flip to
  // the opposite side when the cursor approaches the right/bottom edge
  // so the tooltip never overflows the canvas container.
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

  if (!stepData) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground">
        No data for this step
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[160px] w-full overflow-hidden rounded-md bg-background/50"
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
              style={{ backgroundColor: runColor }}
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

// ---------------------- Ridgeline Mode: Per-Run Canvas ----------------------
interface MultiRunRidgelineHover {
  stepIdx: number;
  cursorX: number;
  cursorY: number;
  containerWidth: number;
  containerHeight: number;
}

function MultiRunRidgelineCanvas({
  steps,
  baseColor,
  theme,
  globalMaxFreq,
  globalXDomain,
  stepsOnX = false,
}: {
  steps: HistogramStep[];
  baseColor: string;
  theme: string;
  globalMaxFreq: number;
  globalXDomain: [number, number];
  stepsOnX?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<MultiRunRidgelineHover | null>(null);

  const displayedSteps = useMemo(
    () =>
      sampleStepsForRidgeline(
        steps,
        stepsOnX
          ? RIDGELINE_LAYOUT.maxRidgesTransposed
          : RIDGELINE_LAYOUT.maxRidges,
      ),
    [steps, stepsOnX],
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
      drawRidgeline(ctx, {
        steps: displayedSteps,
        width: rect.width,
        height: rect.height,
        baseColor,
        theme: theme === "dark" ? "dark" : "light",
        globalMaxFreq,
        globalXDomain,
        stepsOnX,
        // In transposed mode the hovered ridge gets a second pass
        // outside the chart-area clip so its leftward peak spills
        // visibly past the Y axis labels.
        hoverStepIdx: stepsOnX && hover ? hover.stepIdx : undefined,
      });
      if (hover) {
        drawRidgelineHoverHighlight({
          ctx,
          width: rect.width,
          height: rect.height,
          steps: displayedSteps,
          globalXDomain,
          globalMaxFreq,
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
  }, [displayedSteps, baseColor, theme, globalMaxFreq, globalXDomain, hover, stepsOnX]);

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
      // Polygon-containment hit-test so the tooltip attributes the
      // cursor to the ridge actually visible underneath, not just the
      // slot whose baseline is closest in Y. xLeft / xRight here MUST
      // mirror what drawRidgelineTransposed uses (120 left, 16 right)
      // so the cursor's mapped-step matches the painted polygon.
      const slotIdx = hitTestRidgelinePolygons(
        cursorX,
        cursorY,
        displayedSteps,
        {
          width: rect.width,
          height: rect.height,
          topMargin: RIDGELINE_LAYOUT.topMargin,
          bottomMargin: RIDGELINE_LAYOUT.bottomMargin,
          xLeft: stepsOnX
            ? RIDGELINE_LAYOUT.leftMargin
            : RIDGELINE_LAYOUT.rightGutter,
          xRight: stepsOnX
            ? rect.width - 44
            : rect.width - RIDGELINE_LAYOUT.rightMargin,
        },
        globalXDomain,
        globalMaxFreq,
        { stepsOnX },
      );
      if (slotIdx === null) {
        setHover(null);
        return;
      }
      setHover({
        // Oldest at top means slotIdx 0 is stepIdx 0; no inversion.
        // drawRidgeline paints displayedSteps[i] at slot i from the top.
        stepIdx: slotIdx,
        cursorX,
        cursorY,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    },
    [displayedSteps, globalXDomain, globalMaxFreq, stepsOnX],
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
      className="relative h-full min-h-0 w-full overflow-hidden rounded-md bg-background/50"
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

// ---------------------- Heatmap Mode: Per-Run Canvas ----------------------
interface MultiRunHeatmapHover {
  stepIdx: number;
  binIdx: number;
  cursorX: number;
  cursorY: number;
  containerWidth: number;
  containerHeight: number;
}

function MultiRunHeatmapCanvas({
  steps,
  baseColor,
  theme,
  globalMaxFreq,
  globalXDomain,
  stepsOnX = false,
}: {
  steps: HistogramStep[];
  baseColor: string;
  theme: string;
  stepsOnX?: boolean;
  globalMaxFreq: number;
  globalXDomain: [number, number];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<MultiRunHeatmapHover | null>(null);

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
        baseColor,
        scale: "linear",
        theme: theme === "dark" ? "dark" : "light",
        globalMaxFreq,
        globalXDomain,
        stepsOnX,
      });
      if (hover && hover.binIdx >= 0) {
        // binIdx = -1 (cursor outside step's bin range) gets no cell
        // outline — there's no real cell to outline there. The tooltip
        // still shows "no samples in this range" via the consumer.
        drawHeatmapHighlight({
          ctx,
          width: rect.width,
          height: rect.height,
          steps,
          globalXDomain,
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
  }, [steps, baseColor, theme, globalMaxFreq, globalXDomain, hover, stepsOnX]);

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
      // leftMargin / rightMargin in transposed mode MUST mirror what
      // drawHeatmap uses (120 left, 16 right) so the cursor maps to
      // the painted cell. Non-transposed keeps the original margins.
      const cell = hitTestCell(cursorX, cursorY, steps, {
        width: rect.width,
        height: rect.height,
        leftMargin: stepsOnX
          ? HEATMAP_LAYOUT.leftMargin
          : HEATMAP_LAYOUT.leftMargin,
        rightMargin: stepsOnX ? 44 : HEATMAP_LAYOUT.rightMargin,
        topMargin: HEATMAP_LAYOUT.topMargin,
        bottomMargin: HEATMAP_LAYOUT.bottomMargin,
        globalXDomain,
      }, {
        stepsOnX,
      });
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
    [steps, globalXDomain, stepsOnX],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hoveredStep = hover ? steps[hover.stepIdx] : null;
  // binIdx = -1 is the "no samples in this bin range" sentinel returned
  // by hitTestCell when the cursor falls outside the step's actual bin
  // range. We still want hover (so users get the step row + a clear
  // "no samples" message) but the per-bin freq lookup is skipped.
  const hoveredBin = useMemo(() => {
    if (!hover || !hoveredStep) return null;
    if (hover.binIdx < 0) return { binStart: null, binEnd: null, freq: 0 };
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
      className="relative h-full min-h-0 w-full overflow-hidden rounded-md bg-background/50"
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
        baseColor={baseColor}
        theme={theme === "dark" ? "dark" : "light"}
        maxFreq={globalMaxFreq}
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
          {hoveredBin.binStart !== null && hoveredBin.binEnd !== null ? (
            <>
              <div className="text-muted-foreground">
                bin: [{formatNumber(hoveredBin.binStart)},{" "}
                {formatNumber(hoveredBin.binEnd)})
              </div>
              <div className="text-muted-foreground">
                freq: {formatNumber(hoveredBin.freq, true)}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">
              no samples in this range
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------- Main Component ----------------------
interface MultiHistogramViewProps {
  logName: string;
  tenantId: string;
  projectName: string;
  runs: any[];
  className?: string;
  /** Controlled mode. If omitted, the component manages its own state. */
  mode?: HistogramViewMode;
  /** Fires when the user toggles the mode. */
  onModeChange?: (mode: HistogramViewMode) => void;
  /** When true, suppress the inline toggle (caller renders one elsewhere, e.g. in a widget card header). */
  hideToggle?: boolean;
  /**
   * W&B-style "Ignore outliers" toggle. When true, the X domain and
   * globalMaxFreq for whichever run is currently rendered are clamped
   * to 5th/95th-percentile fences so a single outlier step doesn't
   * squish all the others. Default true.
   */
  ignoreOutliers?: boolean;
  /** Fires when the user toggles the Ignore-outliers checkbox. */
  onIgnoreOutliersChange?: (next: boolean) => void;
  /** Hide the internal <h3> title row. Set by distributions-widget so
   *  the multi-panel layout can render its own uniform top-left title
   *  outside MultiHistogramView (white, text-xs, line-chart style). */
  hideTitle?: boolean;
  /** Experimental Steps-on-X transpose for numeric histograms.
   *  Default false. Only meaningful in Ridgeline / Heatmap modes; Step
   *  mode is a per-step snapshot so transposing it is undefined. The
   *  numeric canvas math is naive (bins are indexed positionally
   *  across steps, not rebinned onto a shared numeric grid) so this
   *  looks reasonable when bin ranges are stable across steps and
   *  weird otherwise — tracked as a follow-up. */
  initialStepsOnX?: boolean;
  onStepsOnXChange?: (next: boolean) => void;
}

export const MultiHistogramView: React.FC<MultiHistogramViewProps> = ({
  logName,
  tenantId,
  projectName,
  runs,
  className,
  mode: controlledMode,
  onModeChange,
  hideToggle = false,
  ignoreOutliers = true,
  onIgnoreOutliersChange,
  hideTitle = false,
  initialStepsOnX = false,
  onStepsOnXChange,
}) => {
  const { data, isLoading, hasError } = useNormalizedHistogramData(runs, {
    tenantId,
    projectName,
    logName,
  });

  const [internalMode, setInternalMode] =
    useState<HistogramViewMode>("ridgeline");
  const mode = controlledMode ?? internalMode;
  const handleModeChange = useCallback(
    (next: HistogramViewMode) => {
      if (controlledMode === undefined) setInternalMode(next);
      onModeChange?.(next);
    },
    [controlledMode, onModeChange],
  );

  const [axisBounds, setAxisBounds] = useState<AxisBounds>({});

  // Experimental Steps-on-X for numeric histograms. Disabled in Step
  // mode (snapshot view). Naive — bins are indexed positionally across
  // steps rather than rebinned onto a shared numeric grid. Looks
  // reasonable when bin layout is stable across steps.
  const [stepsOnXLocal, setStepsOnXLocal] = useState<boolean>(initialStepsOnX);
  const stepsOnXDisabled = mode === "step";
  const stepsOnX = !stepsOnXDisabled && stepsOnXLocal;
  const handleStepsOnXChange = useCallback(
    (next: boolean) => {
      setStepsOnXLocal(next);
      onStepsOnXChange?.(next);
    },
    [onStepsOnXChange],
  );

  const runsWithData = useMemo(() => {
    return data.normalizedData.filter(
      (run: any) => run.data.length > 0,
    );
  }, [data.normalizedData]);

  const syntheticStepData = useMemo(() => {
    if (!runsWithData.length) return [];
    const allSteps = new Set<number>();
    runsWithData.forEach((run: any) => {
      run.data.forEach((d: any) => allSteps.add(d.step));
    });
    return Array.from(allSteps).sort((a, b) => a - b).map((step) => ({ step }));
  }, [runsWithData]);

  const {
    currentStepIndex: stepIndex,
    currentStepValue: currentStep,
    availableSteps: stepValues,
    goToStepIndex,
    hasMultipleSteps,
    isLocked,
    setIsLocked,
    hasSyncContext,
  } = useSyncedStepNavigation(syntheticStepData);

  const maxStepIndex = Math.max(0, stepValues.length - 1);

  const setStepIndex = useCallback(
    (valueOrUpdater: number | ((prev: number) => number)) => {
      if (typeof valueOrUpdater === "function") {
        const newIndex = valueOrUpdater(stepIndex);
        goToStepIndex(newIndex);
      } else {
        goToStepIndex(valueOrUpdater);
      }
    },
    [goToStepIndex, stepIndex],
  );

  const { resolvedTheme: theme } = useTheme();

  // Cross-widget run sync. Keep runIdx state inside the hook so the
  // RunSyncProvider can broadcast/listen across panels. Hook clamps
  // runIdx itself when runIds shrink.
  const runIds = useMemo(
    () => runsWithData.map((r: any) => String(r.runId)),
    [runsWithData],
  );
  const {
    runIdx,
    setRunIdx,
    isLocked: isRunLocked,
    setIsLocked: setIsRunLocked,
    hasSyncContext: hasRunSyncContext,
  } = useSyncedRunNavigation({ runIds });

  // The single canvas shows whichever run the run-slider is on.
  const currentRun = runsWithData[Math.min(runIdx, runsWithData.length - 1)];

  // ── X domain + maxFreq fencing ────────────────────────────────
  // Numeric histogram views currently union bins.min/bins.max across
  // every loaded run + every step. That's two failure modes wrapped
  // in one:
  //
  //   - Cross-run mismatch: one wide run (σ=15) drags the X axis to
  //     ±60 even when scrubbed onto a tight run (σ=0.05). Per-W&B,
  //     each rendered panel gets its OWN X axis instead.
  //   - Within-run outlier step: even on a single run, one rogue
  //     step (σ=30) drags X to ±90 while the other 99 sit at ±0.2.
  //     W&B's "Ignore outliers" toggle = 5th/95th-percentile
  //     fences. Same trigger model as line-chart `useYRange`.
  //
  // For Ridgeline/Heatmap we use the CURRENT run's data only (a
  // single run renders at a time via the run slider). For Step mode
  // we keep the union (every run is overlaid at the same step) but
  // still apply fences so an outlier step's wide bell doesn't
  // squish the rest. See histogram-outlier-fences.ts.
  const currentRunFences = useMemo(
    () =>
      computeHistogramFences(
        (currentRun?.data as HistogramStep[] | undefined) ?? [],
        { ignoreOutliers },
      ),
    [currentRun, ignoreOutliers],
  );

  // Step mode renders the current run's distribution at the current
  // step via SingleRunHistogramCanvas — ONE run at a time, just like
  // Ridgeline/Heatmap. So all three modes share the same per-
  // rendered-run fenced domain. (The runStepData map is computed but
  // never reaches Step mode's render — kept around for legacy
  // overlay paths the dashboard isn't using anymore.)
  const effectiveXAxisRange = useMemo(() => ({
    min: axisBounds.xMin ?? currentRunFences.xDomain[0],
    max: axisBounds.xMax ?? currentRunFences.xDomain[1],
  }), [axisBounds.xMin, axisBounds.xMax, currentRunFences.xDomain]);

  const effectiveGlobalMaxFreq = useMemo(
    () => axisBounds.yMax ?? currentRunFences.maxFreq,
    [axisBounds.yMax, currentRunFences.maxFreq],
  );

  const sharedGlobalXDomain = currentRunFences.xDomain;

  // Apply the settings-popover X clamp to Ridgeline/Heatmap. When the
  // user sets X min/max, we override the data-derived domain so they
  // can zoom into a subrange the same way Step mode does. (Y max is
  // Step-only because Ridgeline/Heatmap put steps — not frequency — on Y.)
  const effectiveSharedGlobalXDomain = useMemo<[number, number]>(
    () => [
      axisBounds.xMin ?? sharedGlobalXDomain[0],
      axisBounds.xMax ?? sharedGlobalXDomain[1],
    ],
    [axisBounds.xMin, axisBounds.xMax, sharedGlobalXDomain],
  );

  const sharedGlobalMaxFreq = currentRunFences.maxFreq;

  const runStepData = useMemo(() => {
    return runsWithData.map((run: any) => ({
      runName: run.runName as string,
      color: run.color as string,
      stepData: run.data.find(
        (d: { step: number }) => d.step === currentStep,
      ) as HistogramStep | undefined,
    }));
  }, [runsWithData, currentStep]);
  const currentStepData = useMemo<HistogramStep | undefined>(() => {
    if (!currentRun) return undefined;
    return (currentRun.data as HistogramStep[]).find(
      (d) => d.step === currentStep,
    );
  }, [currentRun, currentStep]);

  // Mapping for the run-slider row (color + name only).
  const runSliderRefs = useMemo(
    () =>
      runsWithData.map((r: any) => ({
        runName: r.runName as string,
        color: r.color as string,
      })),
    [runsWithData],
  );

  // Settings popover state. MUST live above the loading/error early
  // returns below — otherwise the useState+useEffect pair gets called
  // on success renders only, and React error #310 fires the first
  // time the data flips from loading → loaded.
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
  // Independent state for the fullscreen "Chart Settings" popover.
  // Mounts/unmounts with the fullscreen dialog, so it never conflicts
  // with the toolbar popover.
  const [fullscreenSettingsOpen, setFullscreenSettingsOpen] = useState(false);

  // Ref to the histogram content container for the Export menu — it
  // captures this DOM subtree to PNG / clipboard.
  const chartContainerRef = useRef<HTMLDivElement>(null);

  if (isLoading) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <div
          className={cn(
            "flex items-center gap-2",
            hideTitle ? "justify-end" : "justify-between",
          )}
        >
          {!hideTitle && (
            <h3 className="truncate font-mono text-sm font-medium text-muted-foreground">
              {logName}
            </h3>
          )}
          {!hideToggle && (
            <HistogramModeToggle mode={mode} onChange={handleModeChange} />
          )}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (hasError || runsWithData.length === 0) {
    return (
      <div className={cn("flex h-full w-full flex-col space-y-4 p-4", className)}>
        <div
          className={cn(
            "flex items-center gap-2",
            hideTitle ? "justify-end" : "justify-between",
          )}
        >
          {!hideTitle && (
            <h3 className="truncate font-mono text-sm font-medium text-muted-foreground">
              {logName}
            </h3>
          )}
          {!hideToggle && (
            <HistogramModeToggle mode={mode} onChange={handleModeChange} />
          )}
        </div>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {hasError ? "Error loading data" : "No data found"}
        </div>
      </div>
    );
  }

  const isStepMode = mode === "step";
  // Only show the step slider in Step mode. Ridgeline/Heatmap stack
  // every step as rows already, so a step picker is redundant (and
  // confusing — the lock icon would imply step-syncing a chart that
  // shows all steps).
  const showStepSlider = isStepMode && hasMultipleSteps();
  const showRunSlider = runsWithData.length > 1;

  // Settings popover for X/Y axis overrides. Mirrors the image
  // widget's settings popover exactly:
  //   - SlidersHorizontalIcon button styled with bg-background/80 +
  //     backdrop-blur-sm so it reads as part of the hover toolbar.
  //   - Controlled open state so we can implement scroll-to-close,
  //     matching ImageSettingsPopover.
  //   - sideOffset={8} on the content so the popover sits below
  //     the trigger with breathing room.
  //   - onOpenAutoFocus prevented so the popover opens with no field
  //     focused (Radix would otherwise auto-focus X min).
  // Available in all three modes. Y max is hidden in Ridgeline/Heatmap
  // (those modes put steps on Y, not frequency) via showYMax={isStepMode}.
  // settingsOpen state + scroll-close effect are declared up above
  // (before the early returns) to satisfy React's hook-order rule.
  // Match the chart-widget toolbar styling: plain ghost button, no
  // semi-opaque backdrop, no Radix tooltip. Reads cleanly as "an icon
  // in a hover toolbar" rather than "a chunky button parked on the
  // canvas" — same as the camera/sliders/fullscreen trio rendered by
  // WidgetCard for `widget.type === "chart"`.
  // Render the axis controls inline. Shared by the hover-toolbar
  // popover AND the fullscreen "Chart Settings" popover so both
  // surfaces stay in sync.
  const axisControlsInline = (
    <HistogramAxisControlsInline
      axisBounds={axisBounds}
      onAxisBoundsChange={setAxisBounds}
      showYMax={isStepMode}
      ignoreOutliers={ignoreOutliers}
      onIgnoreOutliersChange={onIgnoreOutliersChange}
      stepsOnX={stepsOnX}
      onStepsOnXChange={handleStepsOnXChange}
      stepsOnXDisabled={stepsOnXDisabled}
    />
  );

  const settingsButton = !hideToggle ? (
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
        {axisControlsInline}
      </PopoverContent>
    </Popover>
  ) : null;

  // Fullscreen header buttons — matches the chart-widget pattern (Export
  // + Chart Settings). The Export button captures the histogram canvas
  // container via chartContainerRef; the Settings button reuses the same
  // axisControlsInline render so toolbar + fullscreen don't drift.
  const fullscreenHeaderExtra = !hideToggle ? (
    <>
      <ChartExportMenu
        getContainer={() => chartContainerRef.current}
        fileName={logName}
        variant="header"
        getCaption={() =>
          chartContainerRef.current
            ? extractCaptionFromDOM(chartContainerRef.current)
            : null
        }
      />
      <Popover open={fullscreenSettingsOpen} onOpenChange={setFullscreenSettingsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="histogram-fullscreen-settings-btn"
          >
            <SlidersHorizontalIcon className="size-3.5" />
            Settings
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-auto p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {axisControlsInline}
        </PopoverContent>
      </Popover>
    </>
  ) : null;

  return (
    <MediaCardWrapper
      title={logName}
      className="h-full w-full"
      toolbarExtra={settingsButton}
      fullscreenHeaderExtra={fullscreenHeaderExtra}
    >
      <div
        ref={chartContainerRef}
        data-testid="histogram-widget"
        data-histogram-view-mode={mode}
        // Stamped (matches the bars view's data-categorical-steps-on-x)
        // so E2E tests can assert the Steps-on-X toggle stuck without
        // having to inspect the underlying canvas pixels. Reads the
        // effective state — disabled in Step mode evaluates to "false"
        // regardless of the stored config flag.
        data-histogram-steps-on-x={stepsOnX ? "true" : "false"}
        // Stamped so E2E tests can scope this widget by metric without
        // depending on the visible title text — the wrapping distributions
        // widget uses `hideTitle` in multi-entry mode so the metric label
        // isn't always inside the widget DOM as visible text.
        data-metric={logName}
        // Stamped for the PNG export caption (extractCaptionFromDOM):
        // step mode shows one (run, step) pair → step text + currentRun chip.
        // Ridgeline/heatmap show every step for the currently-selected run
        // (run-slider picks it); step text is meaningless across all-steps,
        // so we omit it and just surface the run chip.
        data-export-step={mode === "step" ? `step ${currentStep}` : undefined}
        data-export-runs={JSON.stringify(
          currentRun
            ? [{ name: currentRun.runName, color: currentRun.color }]
            : [],
        )}
        className={cn("flex h-full w-full flex-col gap-2 p-4", className)}
      >
        {/* Header: title (left) · mode toggle (right, with 64px right
            indent so the hover-only gear + fullscreen icons in the
            MediaCardWrapper's top-right corner sit clear of it). The
            title hides when the wrapping context provides its own
            (e.g. the distributions widget renders a uniform top-left
            title above every panel). */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-3",
            hideTitle ? "justify-end" : "justify-between",
          )}
        >
          {!hideTitle && (
            <h3 className="truncate font-mono text-sm font-medium text-muted-foreground">
              {logName}
            </h3>
          )}
          {!hideToggle && (
            <div className="mr-16">
              <HistogramModeToggle mode={mode} onChange={handleModeChange} />
            </div>
          )}
        </div>

        {/* Single-canvas body. Run + step are picked via the footer
            steppers, no more vertical stack of one-panel-per-run. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {currentRun ? (
            mode === "step" ? (
              <SingleRunHistogramCanvas
                runColor={currentRun.color as string}
                stepData={currentStepData}
                xAxisRange={effectiveXAxisRange}
                globalMaxFreq={effectiveGlobalMaxFreq}
                theme={theme}
              />
            ) : mode === "ridgeline" ? (
              <MultiRunRidgelineCanvas
                steps={currentRun.data as HistogramStep[]}
                baseColor={currentRun.color as string}
                theme={theme}
                globalMaxFreq={sharedGlobalMaxFreq}
                globalXDomain={effectiveSharedGlobalXDomain}
                stepsOnX={stepsOnX}
              />
            ) : (
              <MultiRunHeatmapCanvas
                steps={currentRun.data as HistogramStep[]}
                baseColor={currentRun.color as string}
                theme={theme}
                globalMaxFreq={sharedGlobalMaxFreq}
                globalXDomain={effectiveSharedGlobalXDomain}
                stepsOnX={stepsOnX}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No run selected
            </div>
          )}
        </div>

        {/* Pinned footer steppers. Step gets the sync-link icon when
            useSyncedStepNavigation exposes a context. Run is local
            to this widget (no cross-widget run sync). */}
        {(showStepSlider || showRunSlider) && (
          <div className="sticky bottom-0 border-t border-border bg-background pt-1.5 pb-0.5">
            <HistogramFooterSliders
              showStepSlider={showStepSlider}
              showRunSlider={showRunSlider}
              stepIdx={stepIndex}
              runIdx={runIdx}
              steps={stepValues}
              runs={runSliderRefs}
              onStepIdxChange={setStepIndex}
              onRunIdxChange={setRunIdx}
              showStepLock={hasSyncContext}
              isStepLocked={isLocked}
              onStepLockChange={setIsLocked}
              showRunLock={hasRunSyncContext}
              isRunLocked={isRunLocked}
              onRunLockChange={setIsRunLocked}
            />
          </div>
        )}
      </div>
    </MediaCardWrapper>
  );
};
