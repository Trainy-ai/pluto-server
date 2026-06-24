import React, { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import {
  CATEGORICAL_LAYOUT,
  categoricalBottomMargin,
  computeCategoricalGeometry,
  drawCategoricalBars,
  drawCategoricalHeatmap,
  drawCategoricalHighlight,
  drawCategoricalRidgeline,
  drawCategoricalRidgelineHoverHighlight,
  hitTestCategoricalBar,
  hitTestCategoricalGrid,
  hitTestCategoricalRidgelinePolygons,
  sampleCategoricalSteps,
  type CategoricalLayoutGeometry,
  type CategoricalStep,
  type CategoricalBars,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/categorical-canvas";
import { applyBinRange, type BinRange, type PerRunData } from "./categorical-bin-range";
import { HistogramFooterSliders } from "./components/histogram-footer-sliders";
import { AxisOverlayLabels } from "./components/axis-overlay-labels";
import { ColorLegendOverlay } from "./components/color-legend-overlay";
import { useSyncedStepNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~hooks/use-synced-step-navigation";
import { useSyncedRunNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/run-sync-context";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import { extractCaptionFromDOM } from "@/components/charts/chart-export-utils";
import { buildBarsCaptionShape } from "./bars-caption-shape";
import { computeBarsFencedMaxFreq } from "./bars-outlier-fences";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SlidersHorizontalIcon } from "lucide-react";

const DEFAULT_BARS_COLOR = "hsl(216, 66%, 60%)";

// Default max bins shown before the W&B-style top-N + _other rollup
// kicks in. 30 was picked because: (a) at typical widget widths
// (~1200px), each bin gets ~30px which is enough for the projected
// rotated label width with the default font, (b) cap matches the
// ridge sampling target so density is consistent across modes.
const DEFAULT_MAX_BINS = 30;

export type BarsViewMode = "step" | "ridgeline" | "heatmap";
export type BarsDepthAxis = "step" | "run";

interface RunRef {
  runId: string;
  runName: string;
  // Optional palette color per run. The whole point of preserving this
  // through every view mode is identity consistency: run A is yellow
  // in Step mode, yellow in Ridgeline (depth=run), yellow in Heatmap.
  color?: string;
}

export interface MultiRunCategoricalViewProps {
  orgId: string;
  projectName: string;
  pathPrefix: string;
  runs: RunRef[];
  initialMode?: BarsViewMode;
  initialDepthAxis?: BarsDepthAxis;
  onModeChange?: (mode: BarsViewMode) => void;
  onDepthAxisChange?: (depthAxis: BarsDepthAxis) => void;
  onBinRangeChange?: (range: BinRange) => void;
  hideToggle?: boolean;
  // Bin-range window into the canonical-ordered bin list. 1-indexed
  // inclusive on both ends. Default when unset: {1, min(30, N)} —
  // the top-30 (or fewer if the prefix has <30 bins). X-axis labels
  // are shown when the window has ≤30 bins, hidden when larger.
  binRange?: BinRange;
  // W&B-style "Ignore outliers" toggle. Tukey-fences the per-step maxFreq
  // values so one extreme step doesn't squish every other step's bars.
  // Default true on the read side. Persisted on `BarsConfig.ignoreOutliers`.
  initialIgnoreOutliers?: boolean;
  onIgnoreOutliersChange?: (next: boolean) => void;
  // Transpose: steps on X axis (bins stack vertically). Default false.
  // Only honored in Ridgeline/Heatmap modes with depthAxis="step".
  initialStepsOnX?: boolean;
  onStepsOnXChange?: (next: boolean) => void;
  /**
   * Compact-chrome mode used by dynamic-section widgets where the bars
   * panel is the ONLY thing in the widget. In compact mode:
   *   • inner Ignore-Outliers gear is hidden (caller surfaces it via
   *     the outer widget toolbar)
   *   • inner per-panel fullscreen button is hidden (caller's outer
   *     fullscreen covers the whole widget)
   *   • header doesn't reserve the `mr-16` right indent — no hover
   *     buttons need that breathing room
   *   • binRange numeric inputs render smaller (w-10 vs w-12) so the
   *     `bars: [_] - [_] of N | Y:step Y:run | Step Ridge Heat` row
   *     fits without wrap-around in a half-width dynamic widget
   * Static-section widgets keep the original chrome.
   */
  compactChrome?: boolean;
}

// ============================================================================
// Header toggles
// ============================================================================
function ModeToggle({
  mode,
  onChange,
}: {
  mode: BarsViewMode;
  onChange: (m: BarsViewMode) => void;
}) {
  return (
    <Tabs
      value={mode}
      onValueChange={(v) => onChange(v as BarsViewMode)}
      data-testid="categorical-mode-toggle"
    >
      <TabsList className="h-7 p-0.5">
        <TabsTrigger value="step" className="h-6 px-2 text-xs" data-testid="categorical-mode-step">
          Step
        </TabsTrigger>
        <TabsTrigger
          value="ridgeline"
          className="h-6 px-2 text-xs"
          data-testid="categorical-mode-ridgeline"
        >
          Ridgeline
        </TabsTrigger>
        <TabsTrigger
          value="heatmap"
          className="h-6 px-2 text-xs"
          data-testid="categorical-mode-heatmap"
        >
          Heatmap
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// Bin-range input: two number boxes for the start/end of the visible
// window (both 1-indexed inclusive). Persists via onChange so the
// dashboard saves the choice. The right-side info always reads
// "X – Y of N" so users can see the window vs total at a glance.
//
// Clamping rules (commit time):
//   start: clamped to [1, totalBins]. If start > end, end is bumped to
//          start so the window stays ≥ 1 wide.
//   end:   clamped to [1, totalBins]. If end < start, start is pulled
//          down to end. This prevents the buggy "input says 30 of 240
//          but only 24 render" state — invalid input is normalized
//          before the chart sees it.
function BinRangeControl({
  start,
  end,
  totalBins,
  onChange,
}: {
  start: number;
  end: number;
  totalBins: number;
  onChange: (range: BinRange) => void;
}) {
  const [startDraft, setStartDraft] = useState(String(start));
  const [endDraft, setEndDraft] = useState(String(end));
  useEffect(() => setStartDraft(String(start)), [start]);
  useEffect(() => setEndDraft(String(end)), [end]);

  const clampInt = (raw: string, fallback: number): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(totalBins || 1, Math.floor(n)));
  };

  const commitStart = () => {
    const s = clampInt(startDraft, start);
    const e = Math.max(s, end);
    if (s !== start || e !== end) onChange({ start: s, end: e });
    setStartDraft(String(s));
    if (e !== end) setEndDraft(String(e));
  };
  const commitEnd = () => {
    const e = clampInt(endDraft, end);
    const s = Math.min(start, e);
    if (s !== start || e !== end) onChange({ start: s, end: e });
    setEndDraft(String(e));
    if (s !== start) setStartDraft(String(s));
  };

  // Tighter than the original (h-7 w-12 px-1.5) so the
  // `bars: [_] – [_] of N | Y:step Y:run | Step Ridge Heat` header row
  // doesn't wrap on narrow widgets (dynamic-section halves, multi-panel
  // static widgets at smaller viewports).
  const inputClass =
    "h-6 w-9 rounded border border-border bg-background px-1 tabular-nums text-foreground text-center";

  return (
    <div
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      data-testid="categorical-bin-range"
    >
      <span className="font-medium">bars:</span>
      <input
        type="number"
        min={1}
        max={Math.max(1, totalBins)}
        value={startDraft}
        onChange={(e) => setStartDraft(e.target.value)}
        onBlur={commitStart}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={inputClass}
        aria-label="Bar range start"
      />
      <span aria-hidden>–</span>
      <input
        type="number"
        min={1}
        max={Math.max(1, totalBins)}
        value={endDraft}
        onChange={(e) => setEndDraft(e.target.value)}
        onBlur={commitEnd}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={inputClass}
        aria-label="Bar range end"
      />
      <span className="tabular-nums">of {totalBins}</span>
    </div>
  );
}

function DepthAxisToggle({
  value,
  onChange,
  disabled,
}: {
  value: BarsDepthAxis;
  onChange: (v: BarsDepthAxis) => void;
  disabled?: boolean;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as BarsDepthAxis)}
      data-testid="categorical-depth-axis-toggle"
    >
      <TabsList className="h-7 p-0.5">
        <TabsTrigger
          value="step"
          className="h-6 px-2 text-xs"
          data-testid="categorical-depth-axis-step"
          disabled={disabled}
        >
          Y: step
        </TabsTrigger>
        <TabsTrigger
          value="run"
          className="h-6 px-2 text-xs"
          data-testid="categorical-depth-axis-run"
          disabled={disabled}
        >
          Y: run
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// Compact settings popover for the bars widget. Today it carries the
// W&B-style "Ignore outliers" toggle. Y-max input could land here too
// if we add it for parity with numeric histograms — for now the
// universe of settings is just the one checkbox so we keep it small.
export function BarsSettingsPopover({
  ignoreOutliers,
  onIgnoreOutliersChange,
  stepsOnX,
  onStepsOnXChange,
  stepsOnXDisabled = false,
  variant = "icon",
}: {
  ignoreOutliers: boolean;
  onIgnoreOutliersChange: (next: boolean) => void;
  // "Steps on X" transpose. When undefined the row is hidden; when
  // defined we render the checkbox, disabling it in modes where the
  // swap is meaningless (Step mode, or depthAxis=run).
  stepsOnX?: boolean;
  onStepsOnXChange?: (next: boolean) => void;
  stepsOnXDisabled?: boolean;
  /**
   * "icon" = small ghost button used in the per-panel hover toolbar.
   * "header" = outlined `Settings` text button matching the line-chart
   * `ChartScalePopover` look in the fullscreen dialog header.
   */
  variant?: "icon" | "header";
}) {
  const [open, setOpen] = useState(false);
  // Close the popover when the user scrolls anywhere on the page so it
  // doesn't float over the chart canvas as the user pans the dashboard
  // (it has no positioning anchor on a scrolling parent). The 250ms guard
  // is there to absorb the small layout shift Radix triggers when it
  // measures + positions the popover on open — without it the popover
  // closes immediately on its own open animation. Mirrors the pattern in
  // (multi-group + run-group) histogram-view.
  useEffect(() => {
    if (!open) return;
    const openedAt = Date.now();
    const handler = () => {
      if (Date.now() - openedAt < 250) return;
      setOpen(false);
    };
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "header" ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="bars-settings-btn"
            aria-label="Bars settings"
          >
            <SlidersHorizontalIcon className="size-3.5" />
            Settings
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            data-testid="bars-settings-btn"
            aria-label="Bars settings"
          >
            <SlidersHorizontalIcon className="size-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1.5">
          <label
            className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
            title="Clamp the shared maxFreq used for ridge heights / heatmap colors / step bars to the 95th-percentile fence, so one extreme step doesn't squish the rest into a flat baseline."
          >
            <input
              type="checkbox"
              checked={ignoreOutliers}
              onChange={(e) => onIgnoreOutliersChange(e.target.checked)}
              className="h-3.5 w-3.5"
              aria-label="Ignore outliers"
              data-testid="bars-ignore-outliers"
            />
            <span className="font-medium">Ignore outliers</span>
          </label>
          {onStepsOnXChange !== undefined && (
            <label
              className={
                stepsOnXDisabled
                  ? "inline-flex cursor-not-allowed items-center gap-1.5 text-[11px] text-muted-foreground/50"
                  : "inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
              }
              title={
                stepsOnXDisabled
                  ? "Available only on Ridgeline/Heatmap when Y axis is step."
                  : "Transpose the chart so steps run along the X axis and bins stack vertically — useful when stacking multiple bar charts so their step axes align."
              }
            >
              <input
                type="checkbox"
                checked={!stepsOnXDisabled && (stepsOnX ?? false)}
                disabled={stepsOnXDisabled}
                onChange={(e) => onStepsOnXChange(e.target.checked)}
                className="h-3.5 w-3.5"
                aria-label="Steps on X"
                data-testid="bars-steps-on-x"
              />
              <span className="font-medium">Steps on X</span>
            </label>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// devicePixelRatio-aware canvas hook
// ============================================================================
function useCanvasRender(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: ReadonlyArray<unknown>,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, ...deps]);

  return { canvasRef, containerRef };
}

// ============================================================================
// Helpers
// ============================================================================
function pickClosestStep(
  steps: CategoricalStep[],
  target: number,
): CategoricalStep | null {
  if (steps.length === 0) return null;
  let best = steps[0];
  let bestDist = Math.abs(best.step - target);
  for (let i = 1; i < steps.length; i++) {
    const d = Math.abs(steps[i].step - target);
    if (d < bestDist) {
      best = steps[i];
      bestDist = d;
    }
  }
  return best;
}

// Largest logged step number for a run, or -Infinity if it has no data.
// Used to detect "the union slider scrubbed past this run's last step"
// so we can render a blank row / placeholder instead of snapping a
// long-finished run back to its terminal snapshot.
function getMaxStep(steps: CategoricalStep[]): number {
  let m = -Infinity;
  for (const s of steps) if (s.step > m) m = s.step;
  return m;
}

// Shared "No data for this step" card used by the bar chart's Step mode
// when the union slider scrubs past this run's last logged step. Class
// list is kept verbatim identical to the numeric histogram's empty
// state (web/.../multi-group/histogram-view.tsx) so the two widgets
// render the same card in the same placement.
function NoDataForStepCard() {
  return (
    <div
      data-testid="bars-no-data-for-step"
      className="flex h-full min-h-[160px] items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground"
    >
      No data for this step
    </div>
  );
}

function emptyCategoricalBars(labels: string[]): CategoricalBars {
  return {
    freq: new Array(labels.length).fill(0),
    labels,
    maxFreq: 0,
    shape: "categorical",
    type: "Histogram",
  };
}

// ============================================================================
// Main view
// ============================================================================
export function MultiRunCategoricalView({
  orgId,
  projectName,
  pathPrefix,
  runs,
  initialMode = "ridgeline",
  initialDepthAxis = "step",
  onModeChange,
  onDepthAxisChange,
  onBinRangeChange,
  hideToggle = false,
  binRange,
  initialIgnoreOutliers = true,
  onIgnoreOutliersChange,
  initialStepsOnX = false,
  onStepsOnXChange,
  compactChrome = false,
}: MultiRunCategoricalViewProps) {
  const { resolvedTheme: theme } = useTheme();
  // perRun lands later in the function, but we need a single-run flag
  // early so the depth-axis state stays clamped to "step". With one run
  // selected, depthAxis="run" renders a degenerate 1-row layout AND
  // exposes a 1-of-1 run slider — neither helps the user. The IR pages
  // mount this same component, so force "step" there.
  const isSingleRunContext = runs.length <= 1;
  const [mode, setMode] = useState<BarsViewMode>(initialMode);
  const [depthAxis, setDepthAxis] = useState<BarsDepthAxis>(
    isSingleRunContext ? "step" : initialDepthAxis,
  );
  // Captured by ChartExportMenu (in MediaCardWrapper's fullscreen header)
  // and read by extractCaptionFromDOM. Lives on the categorical-view body
  // so the data-export-* attrs are reachable from inside the dialog tree.
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(
    () => setDepthAxis(isSingleRunContext ? "step" : initialDepthAxis),
    [initialDepthAxis, isSingleRunContext],
  );

  const [ignoreOutliers, setIgnoreOutliers] = useState<boolean>(initialIgnoreOutliers);
  useEffect(() => setIgnoreOutliers(initialIgnoreOutliers), [initialIgnoreOutliers]);
  const handleIgnoreOutliers = (next: boolean) => {
    setIgnoreOutliers(next);
    onIgnoreOutliersChange?.(next);
  };

  const [stepsOnX, setStepsOnXLocal] = useState<boolean>(initialStepsOnX);
  useEffect(() => setStepsOnXLocal(initialStepsOnX), [initialStepsOnX]);
  const handleStepsOnX = (next: boolean) => {
    setStepsOnXLocal(next);
    onStepsOnXChange?.(next);
  };
  // Disabled when the feature wouldn't actually do anything:
  //   • Step viewMode (no Y=step to swap onto X).
  //   • depthAxis="run" (Y is runs, not steps — there's nothing to put on X).
  // The effective flag passed to the canvas is also gated, so toggling
  // it on then switching back to a disabled mode is harmless.
  const stepsOnXDisabled = mode === "step" || depthAxis === "run";
  const effectiveStepsOnX = !stepsOnXDisabled && stepsOnX;

  const handleMode = (m: BarsViewMode) => {
    setMode(m);
    onModeChange?.(m);
  };
  const handleDepth = (v: BarsDepthAxis) => {
    setDepthAxis(v);
    onDepthAxisChange?.(v);
  };

  // Parallel fetch one rollup per run.
  const queries = useQueries({
    queries: runs.map((r) => ({
      queryKey: trpc.runs.data.barsData.queryKey({
        organizationId: orgId,
        projectName,
        runId: r.runId,
        pathPrefix,
      }),
      queryFn: () =>
        trpcClient.runs.data.barsData.query({
          organizationId: orgId,
          projectName,
          runId: r.runId,
          pathPrefix,
        }),
      // Guard `.length` on possibly-undefined values — same crash class as
      // the one fixed in useEligiblePrefixesForRuns. `pathPrefix` and
      // `r.runId` are typed `string` but can briefly be undefined during
      // a config edit / route transition before the parent re-renders.
      enabled: (pathPrefix?.length ?? 0) > 0 && (r.runId?.length ?? 0) > 0,
      staleTime: 1000 * 5,
    })),
  });

  const anyLoading = queries.some((q) => q.isLoading);
  const allEmpty = !anyLoading && queries.every((q) => !q.data || q.data.rows.length === 0);

  const perRunRaw: PerRunData[] = useMemo(() => {
    return runs.map((ref, i) => {
      // useQueries should return one result per input, but defending
      // against the edge case where `runs` updates a frame before the
      // useQueries derivation re-runs costs nothing — and a raw
      // `q.data` access on undefined would crash the whole widget.
      const q = queries[i];
      const rows = q?.data?.rows ?? [];
      const steps: CategoricalStep[] = rows.map((row) => ({
        step: row.step,
        bars: row.bars,
      }));
      return {
        runId: ref.runId,
        runName: ref.runName,
        color: ref.color ?? DEFAULT_BARS_COLOR,
        steps,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, ...queries.map((q) => q.data)]);

  // Drop runs whose rollup came back empty for this prefix — most
  // commonly because the run never logged any scalar metric under
  // the prefix at all (e.g. older runs that pre-date the prefix
  // being introduced). Without this filter those runs show up as
  // blank rows in depth=run mode, eating vertical space and making
  // the chart hard to read.
  const perRunWithData = useMemo(
    () => perRunRaw.filter((r) => r.steps.length > 0),
    [perRunRaw],
  );

  // Union canonical labels across ALL selected runs. The server proc
  // returns labels scoped to one run (each query is per-run), so when
  // runs disagree about which children exist under `pathPrefix`, the
  // raw per-run label sets disagree. Without unioning, scrubbing the
  // run slider changes the X-axis categories AND the "of N" bin count.
  // We rebuild a global label order (max-desc across all runs, tie-
  // break alpha) and remap every step's freq array to that order,
  // zero-filling for missing labels — same approach the server uses
  // within a single run.
  const globalCanonicalLabels = useMemo<string[]>(() => {
    const max = new Map<string, number>();
    for (const r of perRunWithData) {
      for (const s of r.steps) {
        const { labels, freq } = s.bars;
        for (let i = 0; i < labels.length; i++) {
          const v = Number(freq[i] ?? 0);
          const cur = max.get(labels[i]) ?? -Infinity;
          if (v > cur) max.set(labels[i], v);
        }
      }
    }
    return Array.from(max.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([k]) => k);
  }, [perRunWithData]);

  // Re-align each run's steps to the union labels. freq becomes a
  // dense array of length globalCanonicalLabels.length; positions that
  // a run doesn't have are zero. maxFreq is recomputed because the
  // post-zero-fill max can be lower than the per-run max (if every
  // bin in the union exists in the run, it's identical).
  const perRunAligned = useMemo(() => {
    if (globalCanonicalLabels.length === 0) return perRunWithData;
    const idxByLabel = new Map<string, number>();
    globalCanonicalLabels.forEach((l, i) => idxByLabel.set(l, i));
    return perRunWithData.map((r) => ({
      ...r,
      steps: r.steps.map((s) => {
        const { labels, freq } = s.bars;
        const aligned = new Array<number>(globalCanonicalLabels.length).fill(0);
        let maxFreq = 0;
        for (let i = 0; i < labels.length; i++) {
          const gi = idxByLabel.get(labels[i]);
          if (gi === undefined) continue;
          const v = Number(freq[i] ?? 0);
          aligned[gi] = v;
          if (v > maxFreq) maxFreq = v;
        }
        return {
          ...s,
          bars: {
            ...s.bars,
            labels: globalCanonicalLabels,
            freq: aligned,
            maxFreq,
          },
        };
      }),
    }));
  }, [perRunWithData, globalCanonicalLabels]);

  // Total available bins (pre-windowing) — used by the bin-range
  // control AND to compute the default window when binRange is unset.
  // Reads from the unioned label set so it's stable across run scrubs.
  const totalBins = globalCanonicalLabels.length;

  // Effective {start, end} window. If a binRange prop is supplied, we
  // clamp it to [1, totalBins]; otherwise we default to top-30 (or
  // fewer if the prefix has <30 bins). Recomputed only when the prop
  // or totalBins changes — not when the window itself does, since
  // committed changes flow back through onBinRangeChange.
  const effectiveRange = useMemo<BinRange>(() => {
    if (totalBins <= 0) return { start: 1, end: 1 };
    if (binRange) {
      const s = Math.max(1, Math.min(totalBins, Math.floor(binRange.start)));
      const e = Math.max(s, Math.min(totalBins, Math.floor(binRange.end)));
      return { start: s, end: e };
    }
    return { start: 1, end: Math.min(DEFAULT_MAX_BINS, totalBins) };
  }, [binRange, totalBins]);

  // Apply the window. {1, totalBins} is a no-op (returns input).
  const perRun = useMemo(
    () => applyBinRange(perRunAligned, effectiveRange.start, effectiveRange.end),
    [perRunAligned, effectiveRange.start, effectiveRange.end],
  );


  // Union of steps across all runs — used by both sliders + closest-step lookup
  const unionSteps = useMemo(() => {
    const set = new Set<number>();
    for (const r of perRun) for (const s of r.steps) set.add(s.step);
    return Array.from(set).sort((a, b) => a - b);
  }, [perRun]);

  // Canonical label set (assumes the rollup proc returns the same canonical
  // labels for every run in a project — which it does, since it sorts by
  // global max-value).
  const canonicalLabels = useMemo(() => {
    for (const r of perRun) {
      const first = r.steps[0];
      if (first) return first.bars.labels;
    }
    return [];
  }, [perRun]);

  // Slider state. Step navigation goes through useSyncedStepNavigation
  // and run navigation through useSyncedRunNavigation so BOTH sliders
  // get cross-widget sync-link icons when the corresponding provider
  // (ImageStepSyncProvider / RunSyncProvider) is mounted.
  const syncableSteps = useMemo(
    () => unionSteps.map((s) => ({ step: s })),
    [unionSteps],
  );
  const {
    currentStepIndex: stepIdx,
    goToStepIndex: setStepIdx,
    isLocked: isStepLocked,
    setIsLocked: setIsStepLocked,
    hasSyncContext: hasStepSyncContext,
  } = useSyncedStepNavigation(syncableSteps);
  const runIds = useMemo(() => perRun.map((r) => r.runId), [perRun]);
  const {
    runIdx,
    setRunIdx,
    isLocked: isRunLocked,
    setIsLocked: setIsRunLocked,
    hasSyncContext: hasRunSyncContext,
  } = useSyncedRunNavigation({ runIds });

  // Clamp `runIdx` against the current `perRun` length: when the user
  // deselects runs, perRun shrinks one render before useSyncedRunNavigation
  // re-clamps its internal runIdx via runIds. During that single frame
  // an unclamped lookup would return undefined and any downstream
  // currentRun.foo would crash. Matches the StepSliderRow / RunSliderRow
  // pattern in HistogramFooterSliders.
  const currentRun = perRun[Math.min(runIdx, perRun.length - 1)];
  const currentStepValue = unionSteps[stepIdx] ?? 0;

  // globalMaxFreq controls ridge heights / heatmap-cell colors. Pool
  // depends on what's actually rendered:
  //   • depthAxis="step" (ridges/cells per STEP of the CURRENT run)
  //     pools only currentRun's per-step maxes — same as the IR view.
  //     Pooling across all selected runs here caused AR Y:step to
  //     visibly diverge from IR for the same data: other runs' per-
  //     step max spread widened the fence's IQR and tripped the
  //     range-dominance activation guard, so the toggle silently
  //     no-op'd even though the displayed run has a clear outlier.
  //   • depthAxis="run" (ridges/cells per RUN) pools across all
  //     selected runs because every run is on screen at once and
  //     their ridge heights need to be comparable to each other.
  //
  // Step mode renders one (run, step) snapshot via payload.maxFreq
  // and ignores globalMaxFreq entirely, so the choice of pool here is
  // moot for that mode. We follow depthAxis so the value still makes
  // sense if step mode ever subscribes.
  const globalMaxFreq = useMemo(() => {
    const perStepMaxFreqs: number[] = [];
    if (depthAxis === "step") {
      if (currentRun) {
        for (const s of currentRun.steps) perStepMaxFreqs.push(s.bars.maxFreq);
      }
    } else {
      for (const r of perRun) {
        for (const s of r.steps) perStepMaxFreqs.push(s.bars.maxFreq);
      }
    }
    return computeBarsFencedMaxFreq(perStepMaxFreqs, { ignoreOutliers }).maxFreq;
  }, [perRun, currentRun, depthAxis, ignoreOutliers]);

  // Step mode: the union-of-runs slider goes up to the max step across
  // ALL runs. When it scrubs past THIS run's last step, pickClosestStep
  // would snap the chart back to the terminal snapshot — which reads as
  // "still logging" even though the run ended. Detect it here so the
  // parent can mount the same histogram-style empty-state card instead
  // (single-source-of-truth: matching widgets render the same way).
  const isStepNoData =
    mode === "step" &&
    !!currentRun &&
    currentStepValue > getMaxStep(currentRun.steps);

  if (anyLoading) {
    // h-full alone doesn't work here because the parent wrapper in
    // file-group-widget only sets minHeight (no defined height for
    // h-full to resolve against). Use an explicit min-h matching the
    // wrapper's minHeight so the skeleton actually fills the slot.
    return <Skeleton className="h-full min-h-[420px] w-full" />;
  }

  if (allEmpty || !currentRun) {
    return (
      <div
        className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground"
        data-testid="categorical-empty-state"
      >
        No metrics found under prefix &quot;{pathPrefix}&quot;.
      </div>
    );
  }

  // compactChrome: the bars panel is the entire widget body (dynamic-
  // section single-item widgets). The outer widget chrome already owns
  // the Camera + Settings + Fullscreen affordances, so we skip the
  // MediaCardWrapper (inner gear + inner per-panel fullscreen) and let
  // the bars content paint full-bleed. The data-export-* stamps below
  // still drive caption extraction for the outer Camera button.
  const wrappedBody = (
    <>
    <div
      ref={chartContainerRef}
      className="flex h-full w-full flex-col gap-2"
      data-categorical-mode={mode}
      data-categorical-depth-axis={depthAxis}
      // `effectiveStepsOnX` is the resolved boolean — the saved
      // `stepsOnX` flag AND-gated against `stepsOnXDisabled` (Step mode
      // or depthAxis=run forces it off). E2E tests can sample this
      // attribute to verify the toggle actually applied without
      // pixel-sampling axis labels.
      data-categorical-steps-on-x={effectiveStepsOnX ? "true" : "false"}
      data-testid="multi-run-categorical-view"
      // Caption shape per (mode, depthAxis) lives in bars-caption-shape so
      // the matrix is unit-testable. See that module for the rationale.
      data-export-step={
        buildBarsCaptionShape({
          mode,
          depthAxis,
          currentStepValue,
          currentRun: currentRun
            ? { name: currentRun.runName, color: currentRun.color }
            : null,
          perRun: perRun.map((r) => ({ name: r.runName, color: r.color })),
        }).step
      }
      data-export-runs={JSON.stringify(
        buildBarsCaptionShape({
          mode,
          depthAxis,
          currentStepValue,
          currentRun: currentRun
            ? { name: currentRun.runName, color: currentRun.color }
            : null,
          perRun: perRun.map((r) => ({ name: r.runName, color: r.color })),
        }).runs,
      )}
    >
      {/* Header (mode + depth + bin range, all on the right). The
          `mr-16` right indent reserves space for the inner hover
          gear + per-panel fullscreen so they don't overlap the
          mode/depth toggles; in compactChrome mode neither button
          renders so the indent is removed. The leftmost pathPrefix
          label is never rendered here — every consumer (static
          widget-card chrome, dynamic-section header, fullscreen
          dialog) already shows the `{prefix}{bars}` title outside
          the panel body, so the inner repeat was always just wasted
          header real estate. */}
      <div className="flex shrink-0 items-center justify-end gap-3">
        {!hideToggle && (
          <div
            className={cn(
              "flex items-center gap-2",
              !compactChrome && "mr-16",
            )}
          >
            <BinRangeControl
              start={effectiveRange.start}
              end={effectiveRange.end}
              totalBins={totalBins}
              onChange={(r) => onBinRangeChange?.(r)}
            />
            {/* Y: step / Y: run toggle. Drops out entirely on single-run
                contexts (IR page) — there's nothing to stack between, and
                forcing it hidden also prevents users from clicking into
                the degenerate 1-row layout. */}
            {!isSingleRunContext && (
              <DepthAxisToggle
                value={depthAxis}
                onChange={handleDepth}
                disabled={mode === "step"}
              />
            )}
            <ModeToggle mode={mode} onChange={handleMode} />
          </div>
        )}
      </div>

      {/* Single graph area — fills remaining space. Step-mode falls
          through to a histogram-style "No data for this step" card when
          the user scrubs the union slider past this run's last logged
          step; in that case we suppress the axis-title overlays + color
          legend so the bar chart's empty state matches the numeric
          histogram's exactly. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isStepNoData ? (
          <NoDataForStepCard />
        ) : (
          <>
            <SingleGraph
              mode={mode}
              depthAxis={depthAxis}
              perRun={perRun}
              currentRun={currentRun}
              currentStepValue={currentStepValue}
              canonicalLabels={canonicalLabels}
              globalMaxFreq={globalMaxFreq}
              theme={theme}
              stepsOnX={effectiveStepsOnX}
            />
            <AxisOverlayLabels
              xLabel={
                mode === "step"
                  ? "Category"
                  : effectiveStepsOnX
                    ? "Step"
                    : "Category"
              }
              yLabel={
                mode === "step"
                  ? "Value"
                  : effectiveStepsOnX
                    ? "Category"
                    : depthAxis === "run"
                      ? "Run"
                      : "Step"
              }
            />
            {mode === "heatmap" &&
              (depthAxis === "step" || isSingleRunContext) &&
              currentRun && (
                <ColorLegendOverlay
                  kind="heatmap"
                  baseColor={currentRun.color}
                  theme={theme === "dark" ? "dark" : "light"}
                  maxFreq={globalMaxFreq}
                  title="Value"
                />
              )}
          </>
        )}
      </div>

      {/* Pinned footer with stepper(s). sticky+z-10+bg matches the
          pattern numeric-histograms use so the slider stays visible at
          the bottom of the file-group widget's scroll viewport even
          when the user scrolls between entries. */}
      <div className="sticky bottom-0 z-20 border-t border-border bg-background px-2 pt-1.5 pb-0.5">
        <HistogramFooterSliders
          showStepSlider={mode === "step" || depthAxis === "run"}
          // Single-run IR pages: nothing to slide between — hide the
          // run slider (and its sync-lock) regardless of mode/depth.
          showRunSlider={
            !isSingleRunContext && (mode === "step" || depthAxis === "step")
          }
          stepIdx={stepIdx}
          runIdx={runIdx}
          steps={unionSteps}
          runs={perRun}
          onStepIdxChange={setStepIdx}
          onRunIdxChange={setRunIdx}
          showStepLock={hasStepSyncContext}
          isStepLocked={isStepLocked}
          onStepLockChange={setIsStepLocked}
          showRunLock={hasRunSyncContext}
          isRunLocked={isRunLocked}
          onRunLockChange={setIsRunLocked}
        />
      </div>
    </div>
    </>
  );

  if (compactChrome) {
    return <div className="relative h-full w-full">{wrappedBody}</div>;
  }

  // Same shape that consumers' outer chrome (`getWidgetTitle`) uses, so
  // the fullscreen dialog title reads `train/*` instead of `train/`.
  // The trailing slash on pathPrefix becomes redundant when we append
  // `/*`, so strip it first.
  const formattedTitle = `${pathPrefix.replace(/\/$/, "")}/*`;

  return (
    <MediaCardWrapper
      title={formattedTitle}
      className="h-full w-full"
      // Settings gear sits next to the fullscreen button in the hover
      // toolbar, matching how histograms surface theirs. Always-visible
      // would crowd the always-on Mode toggle to its left.
      toolbarExtra={
        <BarsSettingsPopover
          ignoreOutliers={ignoreOutliers}
          onIgnoreOutliersChange={handleIgnoreOutliers}
          stepsOnX={stepsOnX}
          onStepsOnXChange={handleStepsOnX}
          stepsOnXDisabled={stepsOnXDisabled}
        />
      }
      fullscreenHeaderExtra={
        <>
          <ChartExportMenu
            getContainer={() => chartContainerRef.current}
            fileName={formattedTitle}
            variant="header"
            getCaption={() =>
              chartContainerRef.current
                ? extractCaptionFromDOM(chartContainerRef.current)
                : null
            }
          />
          {/* Bars-equivalent of the line-chart fullscreen Settings popover.
              Mirrors the histogram Settings affordance (Ignore Outliers
              checkbox), styled as the outlined `Settings` button. */}
          <BarsSettingsPopover
            ignoreOutliers={ignoreOutliers}
            onIgnoreOutliersChange={handleIgnoreOutliers}
            stepsOnX={stepsOnX}
            onStepsOnXChange={handleStepsOnX}
            stepsOnXDisabled={stepsOnXDisabled}
            variant="header"
          />
        </>
      }
    >
      {wrappedBody}
    </MediaCardWrapper>
  );
}

// ============================================================================
// The single canvas area — dispatches by (mode, depthAxis)
// ============================================================================
interface SingleGraphProps {
  mode: BarsViewMode;
  depthAxis: BarsDepthAxis;
  perRun: PerRunData[];
  currentRun: PerRunData;
  currentStepValue: number;
  canonicalLabels: string[];
  globalMaxFreq: number;
  theme: "light" | "dark";
  // Already gated by the caller — true means we should actually
  // transpose. Step mode and depth=run paths ignore it regardless.
  stepsOnX: boolean;
}

// Hover state for tooltips. row + col are zero-indexed into the
// currently-rendered grid; the formatter is mode-specific (different
// modes show different secondary info — step for ridgeline depth=step,
// run name for ridgeline depth=run, etc).
interface HoverInfo {
  row: number;
  col: number;
  value: number;
  cursorX: number;
  cursorY: number;
  label: string;        // bin name (subdataset)
  secondary?: string;   // step or run name, depending on mode
  swatchColor?: string;
}

function CategoricalTooltip({ hover }: { hover: HoverInfo | null }) {
  // We measure the parent's width AND height so the tooltip can flip
  // both horizontally (LEFT of cursor when right side runs out) and
  // vertically (ABOVE cursor when bottom side runs out). Without the
  // vertical flip, hovering near the bottom of the chart pushes the
  // tooltip past the container's overflow-hidden bound and clips it
  // (visible in the LDW signed_drift screenshot — last line cut off).
  const ref = useRef<HTMLDivElement>(null);
  const [parentSize, setParentSize] = useState({ w: 0, h: 0 });
  // Tooltip's own rendered height — needed to know whether placing it
  // BELOW the cursor will fit. Measured after first render via a
  // second ResizeObserver on the tooltip element itself.
  const [tooltipHeight, setTooltipHeight] = useState(40);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const update = () => setParentSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hover != null]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setTooltipHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setTooltipHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hover != null]);
  if (!hover) return null;
  const TOOLTIP_MAX_W = 280;
  const PADDING = 8;
  // Horizontal: prefer right of cursor, flip left if it'd overflow.
  let left = hover.cursorX + 12;
  if (parentSize.w > 0 && left + TOOLTIP_MAX_W > parentSize.w - PADDING) {
    left = Math.max(PADDING, hover.cursorX - TOOLTIP_MAX_W - 12);
  }
  // Vertical: prefer below cursor, flip above if it'd overflow the
  // parent's bottom edge. Clamp to ≥ PADDING so the flip doesn't push
  // the tooltip above the top edge for cursors near yTop.
  let top = hover.cursorY + 12;
  if (parentSize.h > 0 && top + tooltipHeight > parentSize.h - PADDING) {
    top = Math.max(PADDING, hover.cursorY - tooltipHeight - 12);
  }
  return (
    <div
      ref={ref}
      data-testid="bars-tooltip"
      className="pointer-events-none absolute z-10 rounded border border-border bg-popover/95 px-2 py-1 text-[11px] leading-tight text-popover-foreground shadow-md backdrop-blur-sm"
      style={{ left, top, maxWidth: TOOLTIP_MAX_W }}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {hover.swatchColor && (
          <span
            className="inline-block size-2 shrink-0 rounded-sm"
            style={{ backgroundColor: hover.swatchColor }}
            aria-hidden
          />
        )}
        <span className="truncate">{hover.label}</span>
      </div>
      <div className="mt-0.5 tabular-nums text-muted-foreground">
        {Math.round(hover.value * 100) / 100}
        {hover.secondary ? ` · ${hover.secondary}` : ""}
      </div>
    </div>
  );
}

function SingleGraph(props: SingleGraphProps) {
  const { mode, depthAxis, perRun, currentRun, currentStepValue, canonicalLabels, globalMaxFreq, theme, stepsOnX } = props;
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Step mode: ONE bar chart for (currentRun, currentStepValue).
  // Auto-scales the Y axis to the CURRENT snapshot's max — using the
  // cross-run/cross-step globalMaxFreq made bars look tiny when other
  // runs had much higher counts. Step mode shows a single moment, so
  // the local max is the right reference.
  if (mode === "step") {
    // No-data-for-step is handled by the parent (MultiRunCategoricalView)
    // so the empty state can match the numeric histogram's card style —
    // hoisted so we can also drop the axis-title + colorbar overlays
    // when the panel has no data to paint.
    const stepData = pickClosestStep(currentRun.steps, currentStepValue);
    const payload =
      stepData?.bars ?? emptyCategoricalBars(canonicalLabels);
    return (
      <>
        <CanvasArea
          onHover={(cursorX, cursorY, w, h) => {
            const geom = computeCategoricalGeometry({
              width: w,
              height: h,
              numBins: payload.labels.length,
              numRows: 1,
              hasRowLabels: false,
              willRotate: false,
              mode: "step",
              labels: payload.labels,
            });
            const bottomMargin = categoricalBottomMargin(payload.labels.length);
            const col = hitTestCategoricalBar(
              cursorX,
              cursorY,
              payload.labels.length,
              geom.xLeft,
              geom.xRight,
              geom.yTop,
              bottomMargin,
              h,
            );
            if (col === null) {
              setHover(null);
              return;
            }
            setHover({
              row: 0,
              col,
              value: payload.freq[col] ?? 0,
              cursorX,
              cursorY,
              label: payload.labels[col] ?? "",
              secondary: `step ${stepData?.step ?? currentStepValue} · ${currentRun.runName}`,
              swatchColor: currentRun.color,
            });
          }}
          onLeave={() => setHover(null)}
        >
          {({ ctx, w, h }) => {
            drawCategoricalBars(ctx, payload, w, h, currentRun.color, theme);
            if (hover && hover.col >= 0 && payload.labels.length > 0) {
              const geom = computeCategoricalGeometry({
                width: w,
                height: h,
                numBins: payload.labels.length,
                numRows: 1,
                hasRowLabels: false,
                willRotate: false,
                mode: "step",
                labels: payload.labels,
              });
              drawCategoricalHighlight({
                ctx,
                geom,
                mode: "step",
                numBins: payload.labels.length,
                numRows: 1,
                hoverCol: hover.col,
                hoverRow: null,
                theme,
              });
            }
          }}
        </CanvasArea>
        <CategoricalTooltip hover={hover} />
      </>
    );
  }

  // Depth=step: stacked steps for ONE run.
  if (depthAxis === "step") {
    const steps = currentRun.steps;
    // For hit-testing we sample to the same row count the drawer uses.
    const sampledRidge = sampleCategoricalSteps(steps, CATEGORICAL_LAYOUT.maxRidges);
    const sampledHeat = sampleCategoricalSteps(steps, CATEGORICAL_LAYOUT.maxHeatmapRows);
    const sampled = mode === "ridgeline" ? sampledRidge : sampledHeat;
    const numBins = sampled[0]?.bars.labels.length ?? 0;
    const handleHover = (cursorX: number, cursorY: number, w: number, h: number) => {
      const labels = sampled[0]?.bars.labels ?? [];
      const geom = computeCategoricalGeometry({
        width: w,
        height: h,
        numBins,
        numRows: sampled.length,
        hasRowLabels: false,
        willRotate: false,
        mode,
        labels,
        stepsOnX,
      });
      // Ridgeline → polygon-containment (matches what's visible at the
      // cursor). Heatmap → grid cell. The view's globalMaxFreq drives
      // the drawer's peak-Y math, so we must pass the SAME value.
      const hit =
        mode === "ridgeline"
          ? hitTestCategoricalRidgelinePolygons(
              cursorX,
              cursorY,
              sampled,
              geom,
              globalMaxFreq,
              { stepsOnX },
            )
          : hitTestCategoricalGrid(cursorX, cursorY, numBins, sampled.length, geom, mode, { stepsOnX });
      if (!hit) {
        setHover(null);
        return;
      }
      const stepRow = sampled[hit.row];
      const value = stepRow?.bars.freq[hit.col] ?? 0;
      setHover({
        row: hit.row,
        col: hit.col,
        value,
        cursorX,
        cursorY,
        label: labels[hit.col] ?? "",
        secondary: `step ${stepRow?.step ?? ""} · ${currentRun.runName}`,
        swatchColor: currentRun.color,
      });
    };
    return (
      <>
        <CanvasArea
          onHover={handleHover}
          onLeave={() => setHover(null)}
        >
          {({ ctx, w, h }) => {
            if (mode === "ridgeline") {
              drawCategoricalRidgeline(ctx, {
                steps,
                width: w,
                height: h,
                baseColor: currentRun.color,
                theme,
                globalMaxFreq,
                stepsOnX,
              });
            } else {
              drawCategoricalHeatmap(ctx, {
                steps,
                width: w,
                height: h,
                baseColor: currentRun.color,
                theme,
                globalMaxFreq,
                stepsOnX,
              });
            }
            if (hover && hover.col >= 0 && numBins > 0) {
              const geom = computeCategoricalGeometry({
                width: w,
                height: h,
                numBins,
                numRows: sampled.length,
                hasRowLabels: false,
                willRotate: false,
                mode,
                labels: sampled[0]?.bars.labels ?? [],
                stepsOnX,
              });
              // Ridgeline: re-stroke the hovered row's whole polygon
              // so the curve under the cursor stands out. The column
              // outline below still shows the specific bin too.
              if (mode === "ridgeline" && hover.row >= 0) {
                drawCategoricalRidgelineHoverHighlight({
                  ctx,
                  steps: sampled,
                  geom,
                  globalMaxFreq,
                  hoverRow: hover.row,
                  theme,
                  stepsOnX,
                  // In transposed mode the polygon to re-stroke is
                  // identified by the BIN row (= hover.col under the
                  // hit-test's `{row: stepCol, col: binRow}` return
                  // shape). Without this the highlight function no-ops
                  // because hoverBinCol falls back to -1.
                  hoverBinCol: stepsOnX ? hover.col : undefined,
                });
              }
              drawCategoricalHighlight({
                ctx,
                geom,
                mode,
                numBins,
                numRows: sampled.length,
                hoverCol: hover.col,
                hoverRow: hover.row,
                theme,
                stepsOnX,
              });
            }
          }}
        </CanvasArea>
        <CategoricalTooltip hover={hover} />
      </>
    );
  }

  // Depth=run: stacked runs at ONE step. One row per run, colored per run.
  // Runs that ended before `currentStepValue` get an empty-bars row so
  // their slot reads as blank space — without this, "closest" pins
  // those rows to their final-step snapshot, which both heatmap and
  // ridgeline modes would paint as still-active data.
  const perRunRows: CategoricalStep[] = perRun.map((r, i) => {
    const beyondLastStep = currentStepValue > getMaxStep(r.steps);
    const closest = beyondLastStep ? null : pickClosestStep(r.steps, currentStepValue);
    return {
      step: i,
      bars: closest?.bars ?? emptyCategoricalBars(canonicalLabels),
    };
  });
  const runColors = perRun.map((r) => r.color);
  const runLabels = perRun.map((r) => r.runName);

  const numBins = perRunRows[0]?.bars.labels.length ?? 0;
  const handleHover = (cursorX: number, cursorY: number, w: number, h: number) => {
    const labels = perRunRows[0]?.bars.labels ?? [];
    const geom = computeCategoricalGeometry({
      width: w,
      height: h,
      numBins,
      numRows: perRunRows.length,
      hasRowLabels: true,
      willRotate: false,
      mode,
      labels,
    });
    const hit =
      mode === "ridgeline"
        ? hitTestCategoricalRidgelinePolygons(
            cursorX,
            cursorY,
            perRunRows,
            geom,
            globalMaxFreq,
          )
        : hitTestCategoricalGrid(cursorX, cursorY, numBins, perRunRows.length, geom, mode);
    if (!hit) {
      setHover(null);
      return;
    }
    const value = perRunRows[hit.row]?.bars.freq[hit.col] ?? 0;
    setHover({
      row: hit.row,
      col: hit.col,
      value,
      cursorX,
      cursorY,
      label: labels[hit.col] ?? "",
      secondary: `${runLabels[hit.row] ?? ""} · step ${currentStepValue}`,
      swatchColor: runColors[hit.row],
    });
  };

  if (mode === "ridgeline") {
    return (
      <>
        <CanvasArea
          onHover={handleHover}
          onLeave={() => setHover(null)}
        >
          {({ ctx, w, h }) => {
            drawCategoricalRidgeline(ctx, {
              steps: perRunRows,
              width: w,
              height: h,
              baseColor: currentRun.color,
              theme,
              globalMaxFreq,
              rowLabels: runLabels,
              rowLabelSwatchColors: runColors,
              perRidgeColors: runColors,
            });
            if (hover && hover.col >= 0 && numBins > 0) {
              const geom = computeCategoricalGeometry({
                width: w,
                height: h,
                numBins,
                numRows: perRunRows.length,
                hasRowLabels: true,
                willRotate: false,
                mode: "ridgeline",
                labels: perRunRows[0]?.bars.labels ?? [],
              });
              // Re-stroke the hovered run's whole ridge polygon so the
              // entire curve under the cursor pops out, matching the
              // depth=step ridgeline (and the numeric ridgeline).
              if (hover.row >= 0) {
                drawCategoricalRidgelineHoverHighlight({
                  ctx,
                  steps: perRunRows,
                  geom,
                  globalMaxFreq,
                  hoverRow: hover.row,
                  theme,
                });
              }
              drawCategoricalHighlight({
                ctx,
                geom,
                mode: "ridgeline",
                numBins,
                numRows: perRunRows.length,
                hoverCol: hover.col,
                hoverRow: hover.row,
                theme,
              });
            }
          }}
        </CanvasArea>
        <CategoricalTooltip hover={hover} />
      </>
    );
  }
  // heatmap, depth=run
  return (
    <>
      <CanvasArea onHover={handleHover} onLeave={() => setHover(null)}>
        {({ ctx, w, h }) => {
          drawCategoricalHeatmap(ctx, {
            steps: perRunRows,
            width: w,
            height: h,
            baseColor: currentRun.color,
            theme,
            globalMaxFreq,
            rowLabels: runLabels,
            perRowColors: runColors,
            rowLabelSwatchColors: runColors,
          });
          if (hover && hover.col >= 0 && numBins > 0) {
            const geom = computeCategoricalGeometry({
              width: w,
              height: h,
              numBins,
              numRows: perRunRows.length,
              hasRowLabels: true,
              willRotate: false,
              mode: "heatmap",
              labels: perRunRows[0]?.bars.labels ?? [],
            });
            drawCategoricalHighlight({
              ctx,
              geom,
              mode: "heatmap",
              numBins,
              numRows: perRunRows.length,
              hoverCol: hover.col,
              hoverRow: hover.row,
              theme,
            });
          }
        }}
      </CanvasArea>
      <CategoricalTooltip hover={hover} />
    </>
  );
}

// Per-bin minimum px when forcing horizontal scroll. Below this density
// Wrapper that handles the devicePixelRatio canvas dance with one
// callback for drawing, plus optional mouse-move/leave handlers so
// the parent can implement hover tooltips. The canvas always fits
// the container width — horizontal scroll is gone; the bin-range
// control replaces the "scroll through all bins" mode.
function CanvasArea({
  children,
  onHover,
  onLeave,
}: {
  children: (ctx: { ctx: CanvasRenderingContext2D; w: number; h: number }) => void;
  onHover?: (cursorX: number, cursorY: number, w: number, h: number) => void;
  onLeave?: () => void;
}) {
  const { canvasRef, containerRef } = useCanvasRender(
    (ctx, w, h) => children({ ctx, w, h }),
    [children],
  );
  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHover) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    onHover(x, y, rect.width, rect.height);
  };
  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseMove={onHover ? handleMove : undefined}
        onMouseLeave={onLeave}
      />
    </div>
  );
}
