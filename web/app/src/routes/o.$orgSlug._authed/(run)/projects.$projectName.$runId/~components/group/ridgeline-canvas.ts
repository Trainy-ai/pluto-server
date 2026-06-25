import {
  generateNiceNumbers,
  formatNumber,
  TICK_CONFIG,
  type HistogramStep,
} from "./histogram-canvas-utils";

export const RIDGELINE_LAYOUT = {
  // Wider than the 32 we had originally so 4-5 digit Y-tick labels
  // ("5000.00", "11730.8") fit on the left edge without clipping in
  // Step mode. Ridgeline/heatmap modes' xLeft is max(leftMargin,
  // leftLabelGutter), so the row-label gutter still dominates there.
  leftMargin: 56,
  // Bumped 8 → 44 to reserve a column on the right for the
  // ColorLegendOverlay (heatmap mode). 44 = 10px bar + ~34px for the
  // top/bottom numeric labels ("1.2e+4" is ~42px wide), all of which
  // sit at the widget's right edge. Modes without a legend
  // (ridgeline + step) get a slightly wider right margin —
  // negligible vs the legend collision in heatmap.
  rightMargin: 44,
  // Bumped 8 → 22 to leave vertical room for the Y axis-title overlay
  // ("step" / "freq" / "value") above the topmost tick number.
  topMargin: 22,
  // Bumped 24 → 38 to give the X axis-title overlay its own row below
  // the tick-number row. With bottomMargin=24, the bottom-right X label
  // and the rightmost tick text both lived in the same ~18px slice and
  // cramped together visually.
  bottomMargin: 38,
  rightGutter: 36,
  ridgeHeightMultiplier: 8.0,
  paddingFraction: 0.02,
  minStepLabelSpacingPx: 16,
  xTicks: 5,
  maxRidges: 30,
  // Transposed (Steps-on-X) has the full canvas WIDTH to stack ridges
  // along instead of HEIGHT — pack ~2x as many columns since the page is
  // typically much wider than tall and each column is narrow.
  maxRidgesTransposed: 60,
} as const;

export function sampleStepsForRidgeline(
  steps: HistogramStep[],
  maxRidges: number = RIDGELINE_LAYOUT.maxRidges,
): HistogramStep[] {
  if (steps.length <= maxRidges) return steps;
  const stride = Math.ceil(steps.length / maxRidges);
  const result: HistogramStep[] = [];
  for (let i = 0; i < steps.length; i += stride) result.push(steps[i]);
  const last = steps[steps.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

interface RidgePolygonOpts {
  globalXDomain: [number, number];
  globalMaxFreq: number;
  slotBaselineY: number;
  ridgeHeight: number;
  xLeft: number;
  xRight: number;
}

export interface RidgelineProps {
  steps: HistogramStep[];
  width: number;
  height: number;
  baseColor: string;
  theme: "light" | "dark";
  // Optional cross-run shared overrides. When rendering one ridgeline per run
  // in the multi-run view we compute these once across the union of all runs
  // and pass them to each per-run canvas so heights and X scales are
  // visually comparable across cards.
  globalMaxFreq?: number;
  globalXDomain?: [number, number];
  /** Experimental Steps-on-X transpose for numeric histograms. When
   *  true, ridges stack vertically with one row per BIN INDEX and each
   *  polygon walks across STEPS. Mirrors the categorical bars
   *  transposed-ridgeline shape. Bins are positional (not rebinned), so
   *  the visual is sensible only when bin layouts are stable across
   *  steps. */
  stepsOnX?: boolean;
  /** In transposed mode, the hovered step's polygon renders OUTSIDE
   *  the chart-area clip rect so its leftward peak can spill past the
   *  Y axis (otherwise step 0's overflow is hidden by clipping). */
  hoverStepIdx?: number;
}

export function computeGlobalXDomain(
  steps: HistogramStep[],
): [number, number] {
  if (steps.length === 0) return [0, 1];
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const s of steps) {
    const { min, max } = s.histogramData.bins;
    if (min < xMin) xMin = min;
    if (max > xMax) xMax = max;
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return [0, 1];
  const span = xMax - xMin;
  if (span === 0) {
    const pad = Math.abs(xMin) > 0 ? Math.abs(xMin) * 0.5 : 0.5;
    return [xMin - pad, xMax + pad];
  }
  const pad = span * RIDGELINE_LAYOUT.paddingFraction;
  return [xMin - pad, xMax + pad];
}

export function computeGlobalMaxFreq(steps: HistogramStep[]): number {
  let m = 0;
  for (const s of steps) {
    if (s.histogramData.maxFreq > m) m = s.histogramData.maxFreq;
  }
  return m;
}

export function computeRidgePolygon(
  step: HistogramStep,
  opts: RidgePolygonOpts,
): Array<{ x: number; y: number }> {
  const { freq, bins } = step.histogramData;
  const {
    globalXDomain: [xMin, xMax],
    globalMaxFreq,
    slotBaselineY,
    ridgeHeight,
    xLeft,
    xRight,
  } = opts;

  const xRange = xMax - xMin;
  const usableWidth = xRight - xLeft;
  const binWidth = (bins.max - bins.min) / bins.num;

  const toCanvasX = (value: number): number =>
    xRange === 0
      ? xLeft + usableWidth / 2
      : xLeft + ((value - xMin) / xRange) * usableWidth;

  const safeGlobalMax = globalMaxFreq > 0 ? globalMaxFreq : 1;

  const points: Array<{ x: number; y: number }> = [];

  // When the user's X clamp is wider than the actual data range, the
  // polygon's leftmost/rightmost vertex sits in the middle of the plot.
  // Anchor the baseline at xLeft (and xRight) so the row reads as a
  // continuous flat line across the full chart width — same as the
  // visual when bins exactly match the clamp.
  const bxLeft = toCanvasX(bins.min);
  const bxRight = toCanvasX(bins.max);
  if (bxLeft > xLeft) points.push({ x: xLeft, y: slotBaselineY });

  // Drop to baseline at the leftmost bin edge, then connect each bin's
  // (binCenter, freqHeight) with straight lines (TensorBoard's polyline
  // style — smooth angular peaks), then drop back to baseline at the
  // rightmost bin edge. 2 + bins.num points total (plus optional xLeft/
  // xRight anchors).
  points.push({ x: bxLeft, y: slotBaselineY });

  for (let i = 0; i < bins.num; i++) {
    const f = freq[i] ?? 0;
    const yTop = slotBaselineY - (f / safeGlobalMax) * ridgeHeight;
    const binCenter = bins.min + (i + 0.5) * binWidth;
    points.push({ x: toCanvasX(binCenter), y: yTop });
  }

  points.push({ x: bxRight, y: slotBaselineY });

  if (bxRight < xRight) points.push({ x: xRight, y: slotBaselineY });

  return points;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function parseHsl(input: string): Hsl | null {
  const m = input.match(
    /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?/i,
  );
  if (!m) return null;
  return { h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) };
}

function hexToHsl(hex: string): Hsl | null {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      case b:
        hue = (r - g) / d + 4;
        break;
    }
    hue /= 6;
  }
  return { h: hue * 360, s: s * 100, l: l * 100 };
}

function rgbToHsl(input: string): Hsl | null {
  const m = input.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i,
  );
  if (!m) return null;
  const r = parseFloat(m[1]) / 255;
  const g = parseFloat(m[2]) / 255;
  const b = parseFloat(m[3]) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      case b:
        hue = (r - g) / d + 4;
        break;
    }
    hue /= 6;
  }
  return { h: hue * 360, s: s * 100, l: l * 100 };
}

export function parseBaseColor(color: string): Hsl {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const parsed = hexToHsl(trimmed);
    if (parsed) return parsed;
  } else if (trimmed.toLowerCase().startsWith("hsl")) {
    const parsed = parseHsl(trimmed);
    if (parsed) return parsed;
  } else if (trimmed.toLowerCase().startsWith("rgb")) {
    const parsed = rgbToHsl(trimmed);
    if (parsed) return parsed;
  }
  return { h: 216, s: 66, l: 60 };
}

function clampLightness(l: number): number {
  if (l < 15) return 15;
  if (l > 85) return 85;
  return l;
}

export function ridgeColor(
  baseColor: string,
  stepIdx: number,
  totalSteps: number,
  theme: "light" | "dark",
): { fill: string; stroke: string } {
  const { h, s, l } = parseBaseColor(baseColor);
  const denom = totalSteps > 1 ? totalSteps - 1 : 1;
  const t = totalSteps > 1 ? stepIdx / denom : 0;
  // Two-color ramp from dark blue (oldest) to mid cyan-blue (newest).
  // - Lightness: 22 -> 65 (was 25 -> 85). Light end is much less washed-out
  //   so it pops against the white stroke instead of fading toward white.
  // - Hue: +8 -> -16 from base (216 -> 224 at dark, 200 at light), giving
  //   the dark end a slightly more pure-blue cast and the light end a
  //   clear cyan shift.
  // - Saturation boost so both ends stay vivid.
  const fillH = h + 8 - 38 * t;
  const fillS = Math.min(100, s + 14);
  const fillL = clampLightness(l - 38 + t * 33);
  const strokeRgb = theme === "dark" ? "255, 255, 255" : "0, 0, 0";
  return {
    fill: `hsl(${fillH.toFixed(2)}, ${fillS.toFixed(2)}%, ${fillL.toFixed(2)}%)`,
    stroke: `rgb(${strokeRgb})`,
  };
}

export function hitTestStep(
  cursorY: number,
  numSteps: number,
  height: number,
  topMargin: number,
  bottomMargin: number,
): number | null {
  if (numSteps <= 0) return null;
  const top = topMargin;
  const bottom = height - bottomMargin;
  if (cursorY < top || cursorY >= bottom) return null;
  const usable = bottom - top;
  if (usable <= 0) return null;
  const { slotHeight, topBaseline } = computeRidgelineLayout(
    numSteps,
    height,
    topMargin,
    bottomMargin,
  );
  const localY = cursorY - topBaseline;
  let slotIdx = Math.round(localY / slotHeight);
  if (slotIdx < 0) slotIdx = 0;
  if (slotIdx > numSteps - 1) slotIdx = numSteps - 1;
  return slotIdx;
}

// Polygon Y at cursor X for ONE numeric step's ridge, matching the
// shape computeRidgePolygon draws. Used by the polygon-containment
// hit-test below — slot-only (Y-based) hit-testing falls apart on the
// numeric ridgeline because tall ridges' tails reach far into the
// slots above their baseline, and the user sees that visually but the
// Y-only hit-test still attributes the hover to the row whose
// baseline the cursor is closest to.
function numericPolygonYAtX(
  cursorX: number,
  bins: { min: number; max: number; num: number },
  freq: number[],
  baselineY: number,
  ridgeHeight: number,
  xLeft: number,
  xRight: number,
  xMin: number,
  xMax: number,
  safeMax: number,
): number {
  const numBins = bins.num;
  if (numBins === 0) return baselineY;
  const xRange = xMax - xMin;
  if (xRange <= 0) return baselineY;
  const usable = xRight - xLeft;
  const toCanvasX = (v: number) => xLeft + ((v - xMin) / xRange) * usable;
  const bxLeft = toCanvasX(bins.min);
  const bxRight = toCanvasX(bins.max);
  // computeRidgePolygon bookends the polygon with flat baselines at
  // xLeft/xRight outside [bxLeft, bxRight] — match that here so dead
  // space outside the data range correctly attributes to the row.
  if (cursorX <= bxLeft || cursorX >= bxRight) return baselineY;
  const binWidth = (bins.max - bins.min) / numBins;
  const peakY = (i: number) =>
    baselineY - (Math.max(0, freq[i] ?? 0) / safeMax) * ridgeHeight;
  const centerX = (i: number) => toCanvasX(bins.min + (i + 0.5) * binWidth);
  // Left tail: bxLeft → centerX(0).
  if (cursorX <= centerX(0)) {
    const x0 = bxLeft;
    const y0 = baselineY;
    const x1 = centerX(0);
    const y1 = peakY(0);
    if (x1 - x0 < 0.0001) return y1;
    return y0 + ((cursorX - x0) / (x1 - x0)) * (y1 - y0);
  }
  // Right tail: centerX(N-1) → bxRight.
  if (cursorX >= centerX(numBins - 1)) {
    const x0 = centerX(numBins - 1);
    const y0 = peakY(numBins - 1);
    const x1 = bxRight;
    const y1 = baselineY;
    if (x1 - x0 < 0.0001) return y0;
    return y0 + ((cursorX - x0) / (x1 - x0)) * (y1 - y0);
  }
  // Interior: bin centers are uniform in data space, so canvas spacing
  // is constant. Solve for k directly instead of scanning.
  const cw = (usable * binWidth) / xRange;
  if (cw <= 0) return baselineY;
  const k = Math.floor((cursorX - centerX(0)) / cw);
  const kClamped = Math.max(0, Math.min(numBins - 2, k));
  const x0 = centerX(kClamped);
  const y0 = peakY(kClamped);
  const x1 = centerX(kClamped + 1);
  const y1 = peakY(kClamped + 1);
  if (x1 - x0 < 0.0001) return y0;
  return y0 + ((cursorX - x0) / (x1 - x0)) * (y1 - y0);
}

// Polygon-containment hit-test for the numeric ridgeline. Walks ridges
// from topmost (last-painted, i=N-1) down — first polygon whose
// (cursorX, cursorY) lies inside [polyY, baselineY] wins, which is
// what the user sees at the cursor. Falls back to the next-baseline-
// below rule for dead-space cursors (when no polygon contains the
// cursor but the row visually beneath is flat there).
export function hitTestRidgelinePolygons(
  cursorX: number,
  cursorY: number,
  steps: HistogramStep[],
  layout: {
    width: number;
    height: number;
    topMargin: number;
    bottomMargin: number;
    xLeft: number;
    xRight: number;
  },
  globalXDomain: [number, number],
  globalMaxFreq: number,
  options?: { stepsOnX?: boolean },
): number | null {
  const { width, height, topMargin, bottomMargin, xLeft, xRight } = layout;
  void width;
  if (steps.length === 0) return null;
  if (cursorX < xLeft || cursorX >= xRight) return null;
  if (cursorY < topMargin || cursorY > height - bottomMargin) return null;

  if (options?.stepsOnX) {
    // Transposed: steps run along X (mapped by step VALUE), bin values
    // along Y (low at bottom, high at top — matches the drawer's
    // flipped valueToY). Z-order is oldest-on-top, so walk steps from
    // FIRST (oldest, on top) toward last; the first polygon that
    // contains the cursor is the visually topmost.
    const yBottom = height - bottomMargin;
    const yTop = topMargin;
    const usableHeight = yBottom - yTop;
    const usableWidth = xRight - xLeft;
    if (usableHeight <= 0 || usableWidth <= 0) return null;
    const [valueMin, valueMax] = globalXDomain;
    const valueRange = valueMax - valueMin;
    if (valueRange <= 0) return null;
    const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
    const xPos = computeTransposedXPositions(steps, xLeft, xRight);
    const peakWidthOf = (s: number): number => {
      const fallback = usableWidth / steps.length;
      if (steps.length === 1) return fallback * 2.4;
      if (s < steps.length - 1) return (xPos[s + 1] - xPos[s]) * 2.4;
      return (xPos[s] - xPos[s - 1]) * 2.4;
    };
    const worldY =
      valueMin + ((yBottom - cursorY) / usableHeight) * valueRange;
    // Newest-on-top z-order: walk steps from last (newest, on top)
    // toward first. First polygon that contains the cursor wins.
    for (let s = steps.length - 1; s >= 0; s--) {
      const { freq, bins } = steps[s].histogramData;
      if (bins.num <= 0) continue;
      if (worldY < bins.min || worldY >= bins.max) continue;
      const binIdx = Math.floor(
        ((worldY - bins.min) / (bins.max - bins.min)) * bins.num,
      );
      const clampedBinIdx = Math.max(0, Math.min(bins.num - 1, binIdx));
      const f = Math.max(0, freq[clampedBinIdx] ?? 0);
      // Leftward-pointing polygon: anchor RIGHT edge at xPos[s], left
      // edge at xPos[s] - (f/safeMax)*peakWidth.
      const baseX = xPos[s];
      const stepPeakWidth = peakWidthOf(s);
      const polyLeftX = baseX - (f / safeMax) * stepPeakWidth;
      if (cursorX >= polyLeftX && cursorX <= baseX) {
        return s;
      }
    }
    return null;
  }

  const [xMin, xMax] = globalXDomain;
  const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
  const { slotHeight, topBaseline, ridgeHeight } = computeRidgelineLayout(
    steps.length,
    height,
    topMargin,
    bottomMargin,
  );

  for (let i = steps.length - 1; i >= 0; i--) {
    const baselineY = slotBaselineY(
      i,
      steps.length,
      height,
      topMargin,
      bottomMargin,
    );
    const { bins, freq } = steps[i].histogramData;
    const polyY = numericPolygonYAtX(
      cursorX,
      bins,
      freq,
      baselineY,
      ridgeHeight,
      xLeft,
      xRight,
      xMin,
      xMax,
      safeMax,
    );
    if (cursorY >= polyY && cursorY <= baselineY) return i;
  }

  // Dead-space fallback: cursor sits below one polygon and above the
  // next baseline. Mirrors the categorical hit-test's territorial rule
  // — smallest i where baselineY(i) >= cursorY.
  const rel = (cursorY - topBaseline) / Math.max(slotHeight, 0.0001);
  let i = Math.ceil(rel) | 0;
  if (i < 0) i = 0;
  if (i >= steps.length) i = steps.length - 1;
  return i;
}

// Single source of truth for the vertical layout used by slotBaselineY,
// hitTestStep, and drawRidgeline. Reserves headroom equal to ridgeHeight
// above the topmost baseline so the tallest ridge's peak fits inside the
// usable area instead of clipping at topMargin.
export function computeRidgelineLayout(
  numSteps: number,
  height: number,
  topMargin: number,
  bottomMargin: number,
): { slotHeight: number; ridgeHeight: number; topBaseline: number } {
  const usable = Math.max(0, height - topMargin - bottomMargin);
  const mult = RIDGELINE_LAYOUT.ridgeHeightMultiplier;
  const denom = numSteps > 1 ? numSteps - 1 + mult : mult;
  const slotHeight = usable / denom;
  const ridgeHeight = slotHeight * mult;
  return { slotHeight, ridgeHeight, topBaseline: topMargin + ridgeHeight };
}

export function slotBaselineY(
  stepIdx: number,
  numSteps: number,
  height: number,
  topMargin: number,
  bottomMargin: number,
): number {
  if (numSteps <= 0) return height - bottomMargin;
  const { slotHeight, topBaseline } = computeRidgelineLayout(
    numSteps,
    height,
    topMargin,
    bottomMargin,
  );
  // Oldest step (index 0) sits at the back/top; newest (index N-1) at the
  // front/bottom. Matches TensorBoard's OFFSET-mode convention and our own
  // Heatmap mode.
  return topBaseline + stepIdx * slotHeight;
}

function pickStepLabelStride(
  numSteps: number,
  usableHeight: number,
  minSpacing: number,
): number {
  if (numSteps <= 1) return 1;
  const slotHeight = usableHeight / numSteps;
  if (slotHeight >= minSpacing) return 1;
  return Math.max(1, Math.ceil(minSpacing / Math.max(slotHeight, 0.0001)));
}

export function drawRidgeline(
  ctx: CanvasRenderingContext2D,
  props: RidgelineProps,
): void {
  const { steps, width, height, baseColor, theme } = props;
  if (steps.length === 0) return;
  if (props.stepsOnX) {
    drawRidgelineTransposed(ctx, props);
    return;
  }

  const {
    leftMargin,
    rightMargin,
    topMargin,
    bottomMargin,
    rightGutter,
    ridgeHeightMultiplier,
  } = RIDGELINE_LAYOUT;

  ctx.clearRect(0, 0, width, height);

  // Row (step) labels live in the LEFT gutter. Step numbers are
  // short — slim rightGutter (36) is enough; the wider leftMargin
  // (56) is only justified for Step mode's value-axis ticks like
  // "5000.00", which this drawer doesn't render.
  const xLeft = rightGutter;
  const xRight = width - rightMargin;
  const usableWidth = xRight - xLeft;
  const usableHeight = height - topMargin - bottomMargin;
  if (usableWidth <= 0 || usableHeight <= 0) return;

  const globalXDomain = props.globalXDomain ?? computeGlobalXDomain(steps);
  const globalMaxFreq = props.globalMaxFreq ?? computeGlobalMaxFreq(steps);
  const { slotHeight, ridgeHeight } = computeRidgelineLayout(
    steps.length,
    height,
    topMargin,
    bottomMargin,
  );
  void ridgeHeightMultiplier;

  // Clip ridge polygons to the plot area so rows whose underlying
  // histogram extends past the user's X clamp (xMin / xMax) don't
  // paint past xRight / before xLeft. Affects both fill and stroke.
  ctx.save();
  ctx.beginPath();
  ctx.rect(xLeft, topMargin, usableWidth, usableHeight);
  ctx.clip();

  // Paint back-to-front: with oldest-at-top, that means draw stepIdx=0 first
  // (back row, top of chart) so each newer ridge below it sits in front in
  // z-order, occluding the older rows where they overlap.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const baselineY = slotBaselineY(
      i,
      steps.length,
      height,
      topMargin,
      bottomMargin,
    );
    const polygon = computeRidgePolygon(step, {
      globalXDomain,
      globalMaxFreq,
      slotBaselineY: baselineY,
      ridgeHeight,
      xLeft,
      xRight,
    });
    const { fill, stroke } = ridgeColor(baseColor, i, steps.length, theme);

    ctx.beginPath();
    for (let p = 0; p < polygon.length; p++) {
      const pt = polygon[p];
      if (p === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  const axisColor = theme === "dark" ? "#94a3b8" : "#666";
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xLeft, height - bottomMargin);
  ctx.lineTo(xRight, height - bottomMargin);
  ctx.stroke();

  const [xMin, xMax] = globalXDomain;
  const xTicks = generateNiceNumbers(xMin, xMax, RIDGELINE_LAYOUT.xTicks);
  ctx.fillStyle = axisColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xRange = xMax - xMin;
  for (const tick of xTicks) {
    if (tick < xMin || tick > xMax) continue;
    const x = xRange === 0 ? xLeft + usableWidth / 2 : xLeft + ((tick - xMin) / xRange) * usableWidth;
    ctx.beginPath();
    ctx.moveTo(x, height - bottomMargin);
    ctx.lineTo(x, height - bottomMargin + TICK_CONFIG.TICK_LENGTH);
    ctx.stroke();
    ctx.fillText(
      formatNumber(tick),
      x,
      height - bottomMargin + TICK_CONFIG.TICK_LENGTH + 2,
    );
  }

  const labelStride = pickStepLabelStride(
    steps.length,
    usableHeight,
    RIDGELINE_LAYOUT.minStepLabelSpacingPx,
  );
  ctx.fillStyle = axisColor;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i < steps.length; i++) {
    if (i % labelStride !== 0 && i !== steps.length - 1) continue;
    const baselineY = slotBaselineY(
      i,
      steps.length,
      height,
      topMargin,
      bottomMargin,
    );
    ctx.fillText(formatNumber(steps[i].step, true), xLeft - 4, baselineY - slotHeight / 2);
  }
}

// Re-stroke the hovered step's polygon on top of the rendered ridgeline
// so the hovered curve reads at a glance — a 2.5px outline in the
// theme-contrast color (white in dark mode, black in light), drawn
// inside the same plot-area clip the main draw call uses so a tall
// polygon doesn't bleed past xRight when the user's X clamp is wide.
//
// Re-uses computeRidgePolygon and computeRidgelineLayout so the path
// matches the drawn shape exactly (including the bookended baselines
// at xLeft/xRight). Drawn under the ridge labels but over the ridges
// themselves — call after drawRidgeline, before any axis-on-top art.
export function drawRidgelineHoverHighlight(args: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  steps: HistogramStep[];
  globalXDomain: [number, number];
  globalMaxFreq: number;
  hoverStepIdx: number;
  theme: "light" | "dark";
  stepsOnX?: boolean;
}): void {
  const { ctx, width, height, steps, globalXDomain, globalMaxFreq, hoverStepIdx, theme, stepsOnX } = args;
  if (steps.length === 0) return;
  if (hoverStepIdx < 0 || hoverStepIdx >= steps.length) return;

  if (stepsOnX) {
    drawRidgelineHoverHighlightTransposed({
      ctx,
      width,
      height,
      steps,
      globalXDomain,
      globalMaxFreq,
      hoverStepIdx,
      theme,
    });
    return;
  }

  const { rightGutter, rightMargin, topMargin, bottomMargin } = RIDGELINE_LAYOUT;
  const xLeft = rightGutter;
  const xRight = width - rightMargin;
  const usableHeight = height - topMargin - bottomMargin;
  if (xRight - xLeft <= 0 || usableHeight <= 0) return;

  const { ridgeHeight } = computeRidgelineLayout(
    steps.length,
    height,
    topMargin,
    bottomMargin,
  );
  const baselineY = slotBaselineY(
    hoverStepIdx,
    steps.length,
    height,
    topMargin,
    bottomMargin,
  );
  const polygon = computeRidgePolygon(steps[hoverStepIdx], {
    globalXDomain,
    globalMaxFreq,
    slotBaselineY: baselineY,
    ridgeHeight,
    xLeft,
    xRight,
  });
  if (polygon.length < 2) return;

  // Inverted vs. the normal ridge outlines (which are white-ish in dark
  // and black-ish in light). The hovered ridge needs HIGH contrast
  // against its neighbors so the user can read the active polygon at
  // a glance; matching the neighbors blends in and the highlight
  // disappears in a dense stack.
  const strokeColor =
    theme === "dark" ? "rgba(0,0,0,0.95)" : "rgba(255,255,255,0.95)";
  ctx.save();
  ctx.beginPath();
  ctx.rect(xLeft, topMargin, xRight - xLeft, usableHeight);
  ctx.clip();

  ctx.beginPath();
  for (let p = 0; p < polygon.length; p++) {
    const pt = polygon[p];
    if (p === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.closePath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

// Map each step's index to its X coordinate based on STEP VALUE. The
// first sampled step lands at xLeft and the last at xRight, so the
// histogram fills the full widget width — the on-page positions of
// the "0" tick and the last-step tick align with the bars-chart
// sibling above by virtue of identical widget width + identical
// leftMargin/rightMargin constants (the numeric tick VALUES differ;
// each panel shows its own data's range). Falls back to uniform
// spacing when all steps share the same value.
function computeTransposedXPositions(
  steps: HistogramStep[],
  xLeft: number,
  xRight: number,
): number[] {
  const usable = xRight - xLeft;
  if (steps.length <= 1) return [xLeft];
  const first = steps[0].step;
  const last = steps[steps.length - 1].step;
  const range = last - first;
  if (range <= 0) {
    const colWidth = usable / steps.length;
    return steps.map((_, s) => xLeft + s * colWidth);
  }
  return steps.map((s) => xLeft + ((s.step - first) / range) * usable);
}

// ─── Steps-on-X transposed ridgeline ────────────────────────────────
// One vertical density curve per STEP, stacked side by side along X.
// Y axis is the numeric bin VALUE (union range across all steps). Each
// step's column draws a polygon that walks down through its own bins,
// with horizontal "lean" proportional to freq[bin] at each row. Adjacent
// step columns overlap in z-order so the most recent step paints on top.
//
// Reads as a violin-over-time view: hotspots in the value distribution
// show up as bulges within each step's column, and how those bulges
// shift across steps tells you how the distribution evolves over time.
function drawRidgelineTransposed(
  ctx: CanvasRenderingContext2D,
  props: RidgelineProps,
): void {
  const { steps, width, height, baseColor, theme } = props;
  const { leftMargin, topMargin, bottomMargin, rightGutter } =
    RIDGELINE_LAYOUT;
  ctx.clearRect(0, 0, width, height);
  // xLeft: slim value-tick gutter. A numeric histogram's transposed Y axis
  // shows short value ticks ("6.00", "-4.00") that fit in leftMargin (56).
  // We no longer pad to 120 — that width exists for categorical bars' long
  // bin-name labels and just left a big dead indent on numeric histogram
  // widgets. xLeft/xRight are mirrored in the transposed hit-test and
  // hover-highlight; change any one and the others must follow.
  const xLeft = leftMargin;
  // Right padding bumped 16 → 30 to clear the X axis-title overlay
  // ("step") at bottom-right. The rightmost step tick was centered at
  // `xRight = width - 16` and its text overhang collided with the
  // overlay. Mirrored in the hit-test below + heatmap transposed +
  // categorical bars (stepsOnXRightMargin) so all transposed views
  // line up.
  const xRight = width - 44;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  const usableWidth = xRight - xLeft;
  const usableHeight = yBottom - yTop;
  if (usableWidth <= 0 || usableHeight <= 0) return;
  void rightGutter;

  if (steps.length === 0) return;
  const globalXDomain = props.globalXDomain ?? computeGlobalXDomain(steps);
  const globalMaxFreq = props.globalMaxFreq ?? computeGlobalMaxFreq(steps);
  const [valueMin, valueMax] = globalXDomain;
  const valueRange = valueMax - valueMin;
  if (valueRange <= 0) return;
  const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;

  // Map a numeric bin value to a canvas Y. Higher values render higher
  // on the canvas (top-of-canvas = valueMax, bottom = valueMin) so the
  // Y axis reads naturally as a number line.
  const valueToY = (v: number): number =>
    yBottom - ((v - valueMin) / valueRange) * usableHeight;

  // Per-step column geometry. xPos maps each step to its real X by
  // STEP VALUE — first sampled step lands at xLeft, last at xRight.
  // peakWidth scales with the LOCAL inter-step gap.
  const xPos = computeTransposedXPositions(steps, xLeft, xRight);
  const peakWidth = (s: number): number => {
    const fallback = usableWidth / steps.length;
    if (steps.length === 1) return fallback * 2.4;
    if (s < steps.length - 1) return (xPos[s + 1] - xPos[s]) * 2.4;
    return (xPos[s] - xPos[s - 1]) * 2.4;
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(xLeft, yTop, usableWidth, usableHeight);
  ctx.clip();

  // Per-step vertical baseline. Sits UNDER the polygons so the leftmost
  // edge of each ridge column reads as anchored to a tick. Use a dim
  // axis color so the lines don't compete with the painted ridges.
  const baselineColor = theme === "dark" ? "rgba(148,163,184,0.35)" : "rgba(102,102,102,0.35)";
  ctx.strokeStyle = baselineColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let s = 0; s < steps.length; s++) {
    const x = xPos[s];
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
  }
  ctx.stroke();

  // Build each step's polygon once so we can reuse the geometry below
  // when the hovered ridge needs an unclipped redraw outside the clip.
  const buildStepPolygon = (s: number): Array<{ x: number; y: number }> | null => {
    const { freq, bins } = steps[s].histogramData;
    if (bins.num <= 0) return null;
    const baseX = xPos[s];
    const stepPeakWidth = peakWidth(s);
    const binValueWidth = (bins.max - bins.min) / bins.num;
    const polygon: Array<{ x: number; y: number }> = [];
    const topY = valueToY(bins.max);
    const bottomY = valueToY(bins.min);
    polygon.push({ x: baseX, y: topY });
    for (let b = bins.num - 1; b >= 0; b--) {
      const binCenterV = bins.min + (b + 0.5) * binValueWidth;
      const f = Math.max(0, freq[b] ?? 0);
      const offset = (f / safeMax) * stepPeakWidth;
      polygon.push({ x: baseX - offset, y: valueToY(binCenterV) });
    }
    polygon.push({ x: baseX, y: bottomY });
    return polygon;
  };

  const fillStepPolygon = (s: number, polygon: Array<{ x: number; y: number }>) => {
    // Leftward-pointing polygon: anchor RIGHT edge at xPos[s] and walk
    // left by (freq/safeMax) * peakWidth at each bin. Step 0's polygon
    // would overflow LEFT past xLeft — the clip rect hides that
    // overflow, and a hovered ridge gets a second pass outside the
    // clip so it becomes fully visible past the Y axis labels.
    const { fill, stroke } = ridgeColor(baseColor, s, steps.length, theme);
    ctx.beginPath();
    for (let p = 0; p < polygon.length; p++) {
      const pt = polygon[p];
      if (p === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  // Z-order: newest step paints LAST so it sits on top. Skip the
  // hovered step here — it gets a second pass below OUTSIDE the clip
  // so its leftward overflow becomes visible.
  const hoverIdx = props.hoverStepIdx ?? -1;
  for (let s = 0; s < steps.length; s++) {
    if (s === hoverIdx) continue;
    const poly = buildStepPolygon(s);
    if (poly) fillStepPolygon(s, poly);
  }
  ctx.restore();

  if (hoverIdx >= 0 && hoverIdx < steps.length) {
    const poly = buildStepPolygon(hoverIdx);
    if (poly) fillStepPolygon(hoverIdx, poly);
  }

  // Axes — X = step numbers along the bottom (strided), Y = numeric
  // bin VALUES in the left gutter (same nice-numbers tick logic the
  // non-transposed mode uses on its X axis).
  const axisColor = theme === "dark" ? "#94a3b8" : "#666";
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xLeft, yBottom);
  ctx.lineTo(xRight, yBottom);
  ctx.moveTo(xLeft, yTop);
  ctx.lineTo(xLeft, yBottom);
  ctx.stroke();

  ctx.fillStyle = axisColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // Cap label count by AVAILABLE WIDTH, not a fixed tick count: on a small
  // widget ~10 step labels still overlap (e.g. "8000 9000"). Allow ~48px per
  // label and never exceed the standard tick budget. Matches how the Y step
  // axis already strides by available pixels (labelStride). Floors at 2 so the
  // first + last step always show.
  const STEP_LABEL_MIN_PX = 48;
  const usableStepWidth = Math.max(1, xRight - xLeft);
  const stepLabelBudget = Math.max(
    2,
    Math.min(
      RIDGELINE_LAYOUT.xTicks,
      Math.floor(usableStepWidth / STEP_LABEL_MIN_PX),
    ),
  );
  const stepStride = Math.max(
    1,
    Math.ceil(steps.length / stepLabelBudget),
  );
  for (let s = 0; s < steps.length; s++) {
    if (s % stepStride !== 0 && s !== steps.length - 1) continue;
    // Tick lands at the polygon's baseline (left edge), matching the
    // step VALUE's true X position — first sampled step sits flush
    // with xLeft, last with xRight.
    const x = xPos[s];
    ctx.beginPath();
    ctx.moveTo(x, yBottom);
    ctx.lineTo(x, yBottom + TICK_CONFIG.TICK_LENGTH);
    ctx.stroke();
    // Right-align the LAST tick so its text ends at xRight rather than
    // overhanging into the rightMargin gutter where the X axis-title
    // overlay ("step") sits.
    const isLast = s === steps.length - 1;
    ctx.textAlign = isLast ? "right" : "center";
    ctx.fillText(
      formatNumber(steps[s].step, true),
      x,
      yBottom + TICK_CONFIG.TICK_LENGTH + 2,
    );
  }
  ctx.textAlign = "center";

  const yTicks = generateNiceNumbers(
    valueMin,
    valueMax,
    RIDGELINE_LAYOUT.xTicks,
  );
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    if (tick < valueMin || tick > valueMax) continue;
    const y = valueToY(tick);
    ctx.beginPath();
    ctx.moveTo(xLeft - TICK_CONFIG.TICK_LENGTH, y);
    ctx.lineTo(xLeft, y);
    ctx.stroke();
    ctx.fillText(
      formatNumber(tick),
      xLeft - TICK_CONFIG.TICK_LENGTH - 2,
      y,
    );
  }
}

// Stroke outline of the hovered step's vertical density column. Mirrors
// the geometry drawRidgelineTransposed uses so the highlight aligns
// exactly with the painted polygon.
function drawRidgelineHoverHighlightTransposed(args: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  steps: HistogramStep[];
  globalXDomain: [number, number];
  globalMaxFreq: number;
  hoverStepIdx: number;
  theme: "light" | "dark";
}): void {
  const {
    ctx,
    width,
    height,
    steps,
    globalXDomain,
    globalMaxFreq,
    hoverStepIdx,
    theme,
  } = args;
  const { leftMargin, topMargin, bottomMargin } = RIDGELINE_LAYOUT;
  // Mirror drawRidgelineTransposed's xLeft / xRight exactly so the
  // highlight outline traces the painted polygon.
  const xLeft = leftMargin;
  const xRight = width - 44;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  const usableWidth = xRight - xLeft;
  const usableHeight = yBottom - yTop;
  if (usableWidth <= 0 || usableHeight <= 0) return;
  const [valueMin, valueMax] = globalXDomain;
  const valueRange = valueMax - valueMin;
  if (valueRange <= 0) return;
  const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
  const xPos = computeTransposedXPositions(steps, xLeft, xRight);
  const peakWidthOf = (s: number): number => {
    const fallback = usableWidth / steps.length;
    if (steps.length === 1) return fallback * 2.4;
    if (s < steps.length - 1) return (xPos[s + 1] - xPos[s]) * 2.4;
    return (xPos[s] - xPos[s - 1]) * 2.4;
  };
  const valueToY = (v: number): number =>
    yBottom - ((v - valueMin) / valueRange) * usableHeight;

  const step = steps[hoverStepIdx];
  const { freq, bins } = step.histogramData;
  if (bins.num <= 0) return;
  const baseX = xPos[hoverStepIdx];
  const stepPeakWidth = peakWidthOf(hoverStepIdx);
  const binValueWidth = (bins.max - bins.min) / bins.num;

  // Mirror the drawer's leftward-pointing polygon: anchor right edge
  // at xPos[s], walk left by (freq/safeMax) * peakWidth at each bin.
  const polygon: Array<{ x: number; y: number }> = [];
  const topY = valueToY(bins.max);
  const bottomY = valueToY(bins.min);
  polygon.push({ x: baseX, y: topY });
  for (let b = bins.num - 1; b >= 0; b--) {
    const binCenterV = bins.min + (b + 0.5) * binValueWidth;
    const f = Math.max(0, freq[b] ?? 0);
    const offset = (f / safeMax) * stepPeakWidth;
    polygon.push({ x: baseX - offset, y: valueToY(binCenterV) });
  }
  polygon.push({ x: baseX, y: bottomY });
  if (polygon.length < 2) return;

  const strokeColor =
    theme === "dark" ? "rgba(0,0,0,0.95)" : "rgba(255,255,255,0.95)";
  // No clip — the hovered ridge's fill was already redrawn outside the
  // clip rect by drawRidgelineTransposed, and the highlight outline
  // should match the painted polygon's full extent (including the
  // leftward overflow for step 0).
  ctx.beginPath();
  for (let p = 0; p < polygon.length; p++) {
    const pt = polygon[p];
    if (p === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.closePath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
}
