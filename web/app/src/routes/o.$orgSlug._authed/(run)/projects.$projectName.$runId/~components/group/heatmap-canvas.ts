import {
  generateNiceNumbers,
  formatNumber,
  TICK_CONFIG,
  type HistogramStep,
} from "./histogram-canvas-utils";
import {
  computeGlobalMaxFreq,
  computeGlobalXDomain,
  parseBaseColor,
} from "./ridgeline-canvas";

export const HEATMAP_LAYOUT = {
  leftMargin: 32,
  // Bumped 8 → 44 to reserve a column for the ColorLegendOverlay so
  // cells don't paint under either the gradient bar (~10px) or the
  // top/bottom numeric labels (up to ~42px for "1.2e+4"-style
  // exponential maxFreq).
  rightMargin: 44,
  // Bumped 8 → 22 to clear vertical room for the Y axis-title overlay
  // above the topmost tick number.
  topMargin: 22,
  // Bumped 24 → 38 to give the X axis-title overlay its own row below
  // the tick-number row.
  bottomMargin: 38,
  paddingFraction: 0.02,
  minStepLabelSpacingPx: 16,
  xTicks: 5,
} as const;

export type HeatmapScale = "linear" | "log";

// Map step sample i to its X coord in transposed mode using STEP VALUE
// (mirrors the ridgeline scheme). Cell `i` occupies [xPos[i], xPos[i+1])
// so cells widen wherever a sample sits further from its neighbour.
// First sampled step lands at xLeft and last at xRight, so the heatmap
// fills the full widget width.
function computeHeatmapTransposedXPositions(
  steps: HistogramStep[],
  xLeft: number,
  xRight: number,
): number[] {
  const usable = xRight - xLeft;
  if (steps.length === 0) return [];
  if (steps.length === 1) return [xLeft];
  const first = steps[0].step;
  const last = steps[steps.length - 1].step;
  const range = last - first;
  if (range <= 0) {
    const colWidth = usable / steps.length;
    return steps.map((_, s) => xLeft + s * colWidth);
  }
  return steps.map((s) => xLeft + ((s.step - first) / range) * usable);
}

export interface HeatmapProps {
  steps: HistogramStep[];
  width: number;
  height: number;
  baseColor: string;
  scale: HeatmapScale;
  theme: "light" | "dark";
  // Optional cross-run shared overrides. When rendering one heatmap per run
  // in the multi-run view we compute these once across the union of all runs
  // and pass them so the X scale and color-intensity ramp are comparable
  // across cards.
  globalMaxFreq?: number;
  globalXDomain?: [number, number];
  /** Experimental Steps-on-X transpose. When true, the X axis becomes
   *  step index and the Y axis becomes bin index. The mapping is naive
   *  (bins are positional across steps, not rebinned onto a shared
   *  numeric grid) so the visual is reasonable only when every step's
   *  bin layout is similar. Tracked as a follow-up. */
  stepsOnX?: boolean;
}

export interface HeatmapLayout {
  width: number;
  height: number;
  leftMargin: number;
  rightMargin: number;
  topMargin: number;
  bottomMargin: number;
  globalXDomain: [number, number];
}

export { computeGlobalMaxFreq, computeGlobalXDomain };

function clampLightness(l: number): number {
  if (l < 15) return 15;
  if (l > 85) return 85;
  return l;
}

export function densityColor(
  freq: number,
  maxFreq: number,
  baseColor: string,
  scale: HeatmapScale,
  theme: "light" | "dark",
): string | null {
  if (freq <= 0) return null;
  const safeMax = maxFreq > 0 ? maxFreq : 1;
  let n: number;
  if (scale === "log") {
    n = Math.log(1 + freq) / Math.log(1 + safeMax);
  } else {
    n = freq / safeMax;
  }
  if (n < 0) n = 0;
  if (n > 1) n = 1;
  // Theme-aware low end (blends with the bg) → saturated baseColor (high
  // end). Mirrors the categorical bars heatmap's mix(theme-bg, baseColor)
  // ramp and the ColorLegendOverlay's gradient.
  //   • dark theme: black → baseColor — hue same as baseColor, sat+l
  //     scale 0 → s,l with n.
  //   • light theme: white → baseColor — hue same, sat 0 → s, lightness
  //     100 → l.
  const { h, s, l } = parseBaseColor(baseColor);
  const lerpS = s * n;
  const lerpL =
    theme === "dark" ? l * n : 100 + (l - 100) * n;
  return `hsl(${h.toFixed(2)}, ${lerpS.toFixed(2)}%, ${lerpL.toFixed(2)}%)`;
}

export function hitTestCell(
  cursorX: number,
  cursorY: number,
  steps: HistogramStep[],
  layout: HeatmapLayout,
  options?: { stepsOnX?: boolean },
): { stepIdx: number; binIdx: number } | null {
  if (steps.length === 0) return null;
  const {
    width,
    height,
    leftMargin,
    rightMargin,
    topMargin,
    bottomMargin,
    globalXDomain,
  } = layout;
  const xLeft = leftMargin;
  const xRight = width - rightMargin;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  const usableWidth = xRight - xLeft;
  const usableHeight = yBottom - yTop;
  if (usableWidth <= 0 || usableHeight <= 0) return null;
  if (cursorX < xLeft || cursorX >= xRight) return null;
  if (cursorY < yTop || cursorY >= yBottom) return null;

  const [xMin, xMax] = globalXDomain;
  const valueRange = xMax - xMin;
  if (valueRange <= 0) return null;

  if (options?.stepsOnX) {
    // Transposed: X is step columns mapped by STEP VALUE (matching the
    // ridgeline transposed scheme), Y is bin VALUE. Cell `s` spans
    // [xPos[s], xPos[s+1]) so cells widen wherever a step sample is
    // spaced further from its neighbour — same shape the drawer paints.
    const xPos = computeHeatmapTransposedXPositions(
      steps,
      xLeft,
      xRight,
    );
    // Find the cell whose [xPos[s], rightEdge) contains cursorX. Linear
    // scan — steps.length is bounded by the histogram sampling cap.
    let stepIdx = -1;
    for (let s = 0; s < steps.length; s++) {
      const left = xPos[s];
      const right = s < steps.length - 1 ? xPos[s + 1] : xRight;
      if (cursorX >= left && cursorX < right) {
        stepIdx = s;
        break;
      }
    }
    if (stepIdx < 0) return null;
    // Inverse of the flipped toCanvasY in the transposed drawer: low
    // values live near yBottom, high values near yTop.
    const worldY =
      xMin + ((yBottom - cursorY) / usableHeight) * valueRange;
    const step = steps[stepIdx];
    const { bins } = step.histogramData;
    if (bins.num <= 0) return null;
    if (worldY < bins.min || worldY >= bins.max) {
      return { stepIdx, binIdx: -1 };
    }
    const binWidth = (bins.max - bins.min) / bins.num;
    if (binWidth <= 0) return null;
    let binIdx = Math.floor((worldY - bins.min) / binWidth);
    if (binIdx < 0) binIdx = 0;
    if (binIdx > bins.num - 1) binIdx = bins.num - 1;
    return { stepIdx, binIdx };
  }

  const cellHeight = usableHeight / steps.length;
  let stepIdx = Math.floor((cursorY - yTop) / cellHeight);
  if (stepIdx < 0) stepIdx = 0;
  if (stepIdx > steps.length - 1) stepIdx = steps.length - 1;

  const worldX = xMin + ((cursorX - xLeft) / usableWidth) * valueRange;

  const step = steps[stepIdx];
  const { bins } = step.histogramData;
  if (bins.num <= 0) return null;
  // Cursor outside the step's actual bin range: cell is painted black
  // (freq = 0 there), so users reasonably expect hover to confirm
  // "no samples in this range". Return binIdx = -1 so the tooltip
  // can show step + "no samples" rather than going dead. Common when
  // the X axis is wider than the visible run's bins (e.g. an outlier
  // step stretches the unioned axis past every other step's range).
  if (worldX < bins.min || worldX >= bins.max) {
    return { stepIdx, binIdx: -1 };
  }
  const binWidth = (bins.max - bins.min) / bins.num;
  if (binWidth <= 0) return null;
  let binIdx = Math.floor((worldX - bins.min) / binWidth);
  if (binIdx < 0) binIdx = 0;
  if (binIdx > bins.num - 1) binIdx = bins.num - 1;

  return { stepIdx, binIdx };
}

function pickStepLabelStride(
  numSteps: number,
  usableHeight: number,
  minSpacing: number,
): number {
  if (numSteps <= 1) return 1;
  const cellHeight = usableHeight / numSteps;
  if (cellHeight >= minSpacing) return 1;
  return Math.max(1, Math.ceil(minSpacing / Math.max(cellHeight, 0.0001)));
}

export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  props: HeatmapProps,
): void {
  const { steps, width, height, baseColor, scale, theme } = props;
  if (steps.length === 0) return;

  const { leftMargin, rightMargin, topMargin, bottomMargin } = HEATMAP_LAYOUT;

  ctx.clearRect(0, 0, width, height);

  // Slim value-tick gutter in both modes. The transposed numeric histogram's
  // Y axis shows short value ticks that fit in leftMargin (56); the 120px pad
  // is for categorical bars' bin-name labels and just wasted space here.
  const xLeft = leftMargin;
  // Right padding 44px in both modes — non-transposed reads it from
  // rightMargin; transposed forces 44 to clear both the X axis-title
  // overlay ("step") at the bottom corner AND the ColorLegendOverlay
  // bar + its top/bottom numeric labels.
  const xRight = props.stepsOnX ? width - 44 : width - rightMargin;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  const usableWidth = xRight - xLeft;
  const usableHeight = yBottom - yTop;
  if (usableWidth <= 0 || usableHeight <= 0) return;

  const globalXDomain = props.globalXDomain ?? computeGlobalXDomain(steps);
  const globalMaxFreq = props.globalMaxFreq ?? computeGlobalMaxFreq(steps);
  const [xMin, xMax] = globalXDomain;
  const xRange = xMax - xMin;
  const cellHeight = usableHeight / steps.length;

  const toCanvasX = (value: number): number =>
    xRange === 0
      ? xLeft + usableWidth / 2
      : xLeft + ((value - xMin) / xRange) * usableWidth;

  // Clip drawing to the plot area so cells whose bins straddle / overshoot
  // the user-set X clamp don't paint past xRight / before xLeft.
  ctx.save();
  ctx.beginPath();
  ctx.rect(xLeft, yTop, usableWidth, usableHeight);
  ctx.clip();
  if (props.stepsOnX) {
    // Transposed heatmap. Steps run along X — cells are positioned by
    // STEP VALUE (computeHeatmapTransposedXPositions, same as the
    // ridgeline) so first sampled step lands at xLeft and last at
    // xRight, filling the full widget width. Bin VALUES run along Y
    // using `globalXDomain` as the Y range. A step whose bins only
    // cover [-1, 1] leaves the rest of its column black.
    const valueRange = xMax - xMin;
    if (valueRange > 0 && steps.length > 0) {
      const xPos = computeHeatmapTransposedXPositions(
        steps,
        xLeft,
        xRight,
      );
      // Math convention: low at bottom, high at top. Matches the
      // ridgeline transposed mode so flipping between modes doesn't
      // visually invert the data.
      const toCanvasY = (value: number): number =>
        yBottom - ((value - xMin) / valueRange) * usableHeight;
      for (let s = 0; s < steps.length; s++) {
        const { freq, bins } = steps[s].histogramData;
        if (bins.num <= 0) continue;
        const xCell = xPos[s];
        // Cell stretches to the NEXT sample's left edge (or xRight
        // for the final sample) so neighbouring steps fill the entire
        // column band without gaps.
        const xNext = s < steps.length - 1 ? xPos[s + 1] : xRight;
        const cellWidth = xNext - xCell;
        if (cellWidth <= 0) continue;
        const binWidth = (bins.max - bins.min) / bins.num;
        for (let b = 0; b < bins.num; b++) {
          const f = freq[b] ?? 0;
          const color = densityColor(f, globalMaxFreq, baseColor, scale, theme);
          if (color === null) continue;
          const binStartV = bins.min + b * binWidth;
          const binEndV = binStartV + binWidth;
          // Low value → toCanvasY returns LARGER Y (further down). Top
          // of the cell on canvas is the END (higher value).
          const yLow = toCanvasY(binStartV);
          const yHigh = toCanvasY(binEndV);
          const h = yLow - yHigh;
          if (h <= 0) continue;
          ctx.fillStyle = color;
          ctx.fillRect(xCell, yHigh, cellWidth + 0.5, h + 0.5);
        }
      }
    }
  } else {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const { freq, bins } = step.histogramData;
      if (bins.num <= 0) continue;
      const binWidth = (bins.max - bins.min) / bins.num;
      const yCell = yTop + i * cellHeight;
      for (let b = 0; b < bins.num; b++) {
        const f = freq[b] ?? 0;
        const color = densityColor(f, globalMaxFreq, baseColor, scale, theme);
        if (color === null) continue;
        const binStart = bins.min + b * binWidth;
        const binEnd = binStart + binWidth;
        const xStart = toCanvasX(binStart);
        const xEnd = toCanvasX(binEnd);
        const w = xEnd - xStart;
        if (w <= 0) continue;
        // Skip bins entirely outside the visible window; the rest get
        // clipped by the rect clip above. Cheap reject to avoid touching
        // ctx for thousands of off-screen bins.
        if (xEnd < xLeft || xStart > xRight) continue;
        ctx.fillStyle = color;
        ctx.fillRect(xStart, yCell, w + 0.5, cellHeight + 0.5);
      }
    }
  }
  ctx.restore();

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

  if (props.stepsOnX) {
    // Transposed axes: X = step numbers (strided), Y = numeric bin
    // VALUES (same nice-numbers tick logic the non-transposed mode uses
    // on its X axis). Step labels land at xPos[s] (each cell's LEFT
    // edge — step VALUE) so first sampled step sits at xLeft and last
    // at xRight, filling the full widget width.
    const xPos = computeHeatmapTransposedXPositions(
      steps,
      xLeft,
      xRight,
    );
    // Width-aware label budget: on a small widget a fixed tick count still
    // overlaps. Allow ~48px per label, capped at the standard tick budget,
    // floored at 2 (first + last). Mirrors the ridgeline transposed axis.
    const STEP_LABEL_MIN_PX = 48;
    const usableStepWidth = Math.max(1, xRight - xLeft);
    const stepLabelBudget = Math.max(
      2,
      Math.min(
        HEATMAP_LAYOUT.xTicks,
        Math.floor(usableStepWidth / STEP_LABEL_MIN_PX),
      ),
    );
    const stepStride = Math.max(
      1,
      Math.ceil(steps.length / stepLabelBudget),
    );
    for (let s = 0; s < steps.length; s++) {
      if (s % stepStride !== 0 && s !== steps.length - 1) continue;
      const x = xPos[s];
      ctx.beginPath();
      ctx.moveTo(x, yBottom);
      ctx.lineTo(x, yBottom + TICK_CONFIG.TICK_LENGTH);
      ctx.stroke();
      // Right-align the LAST tick so its text ends at xRight rather
      // than overhanging to the right — the X axis-title overlay
      // ("step") sits in the rightMargin gutter past xRight, and a
      // centered last tick collides with it. All other ticks stay
      // centered.
      const isLast = s === steps.length - 1;
      ctx.textAlign = isLast ? "right" : "center";
      ctx.fillText(
        formatNumber(steps[s].step, true),
        x,
        yBottom + TICK_CONFIG.TICK_LENGTH + 2,
      );
    }
    ctx.textAlign = "center";

    // Y axis: numeric value ticks. Re-use the same generateNiceNumbers
    // helper the non-transposed X axis uses, applied to the value
    // range (xMin/xMax — `globalXDomain`).
    const valueRange = xMax - xMin;
    if (valueRange > 0) {
      const yTicks = generateNiceNumbers(xMin, xMax, HEATMAP_LAYOUT.xTicks);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const tick of yTicks) {
        if (tick < xMin || tick > xMax) continue;
        // Same flipped mapping the cell drawing uses — low at bottom,
        // high at top.
        const y = yBottom - ((tick - xMin) / valueRange) * usableHeight;
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
  } else {
    const xTicks = generateNiceNumbers(xMin, xMax, HEATMAP_LAYOUT.xTicks);
    for (const tick of xTicks) {
      if (tick < xMin || tick > xMax) continue;
      const x = toCanvasX(tick);
      ctx.beginPath();
      ctx.moveTo(x, yBottom);
      ctx.lineTo(x, yBottom + TICK_CONFIG.TICK_LENGTH);
      ctx.stroke();
      ctx.fillText(
        formatNumber(tick),
        x,
        yBottom + TICK_CONFIG.TICK_LENGTH + 2,
      );
    }

    const labelStride = pickStepLabelStride(
      steps.length,
      usableHeight,
      HEATMAP_LAYOUT.minStepLabelSpacingPx,
    );
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i < steps.length; i++) {
      if (i % labelStride !== 0 && i !== steps.length - 1) continue;
      const yCenter = yTop + (i + 0.5) * cellHeight;
      ctx.beginPath();
      ctx.moveTo(xLeft - TICK_CONFIG.TICK_LENGTH, yCenter);
      ctx.lineTo(xLeft, yCenter);
      ctx.stroke();
      ctx.fillText(
        formatNumber(steps[i].step, true),
        xLeft - TICK_CONFIG.TICK_LENGTH - 2,
        yCenter,
      );
    }
  }
}

// Draw a 1.5px outline around the hovered (stepIdx, binIdx) cell on top
// of an already-rendered heatmap. Mirrors drawCategoricalHighlight for
// {bars} so the numeric and categorical heatmap hover affordances feel
// the same: white outline in dark mode, black in light. Cell geometry
// matches drawHeatmap exactly (per-step bins.min/max/num) so the
// outline lands on the same rect the renderer drew the fill into.
export function drawHeatmapHighlight(args: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  steps: HistogramStep[];
  globalXDomain: [number, number];
  hoverStepIdx: number;
  hoverBinIdx: number;
  theme: "light" | "dark";
  stepsOnX?: boolean;
}): void {
  const { ctx, width, height, steps, globalXDomain, hoverStepIdx, hoverBinIdx, theme, stepsOnX } = args;
  if (steps.length === 0) return;
  if (hoverStepIdx < 0 || hoverStepIdx >= steps.length) return;
  const step = steps[hoverStepIdx];
  const { bins } = step.histogramData;
  if (bins.num <= 0 || hoverBinIdx < 0 || hoverBinIdx >= bins.num) return;

  const { leftMargin, rightMargin, topMargin, bottomMargin } = HEATMAP_LAYOUT;
  const xLeft = leftMargin;
  const xRight = width - rightMargin;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  const usableWidth = xRight - xLeft;
  const usableHeight = yBottom - yTop;
  if (usableWidth <= 0 || usableHeight <= 0) return;

  const [xMin, xMax] = globalXDomain;
  const xRange = xMax - xMin;
  if (xRange <= 0) return;

  const strokeColor =
    theme === "dark" ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.75)";
  const binWidth = (bins.max - bins.min) / bins.num;
  const binStartV = bins.min + hoverBinIdx * binWidth;
  const binEndV = binStartV + binWidth;

  if (stepsOnX) {
    // Transposed: steps run along X mapped by STEP VALUE (matches the
    // drawer's xPos), bin VALUES run along Y (low at bottom). Cell `s`
    // spans [xPos[s], xPos[s+1]) (or xRight for last); reuse the same
    // helper as the drawer / hit-test so the outline overlays the
    // painted cell exactly.
    const transposedLeft = leftMargin;
    const transposedRight = width - 44;
    const xPos = computeHeatmapTransposedXPositions(
      steps,
      transposedLeft,
      transposedRight,
    );
    const xCell = xPos[hoverStepIdx];
    const xNext =
      hoverStepIdx < steps.length - 1 ? xPos[hoverStepIdx + 1] : transposedRight;
    const cellWidth = xNext - xCell;
    if (cellWidth <= 0) return;
    const valueRange = xRange;
    const toCanvasY = (value: number): number =>
      yBottom - ((value - xMin) / valueRange) * usableHeight;
    const yLow = toCanvasY(binStartV);
    const yHigh = toCanvasY(binEndV);
    const cellH = yLow - yHigh;
    if (cellH <= 0) return;
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      xCell + 0.75,
      yHigh + 0.75,
      cellWidth - 1.5,
      cellH - 1.5,
    );
    ctx.restore();
    return;
  }

  const cellHeight = usableHeight / steps.length;
  const xStartRaw = xLeft + ((binStartV - xMin) / xRange) * usableWidth;
  const xEndRaw = xLeft + ((binEndV - xMin) / xRange) * usableWidth;
  // Clip to plot area so an extreme bin straddling the clamp doesn't
  // paint into the right margin.
  const x0 = Math.max(xLeft, xStartRaw);
  const x1 = Math.min(xRight, xEndRaw);
  if (x1 - x0 <= 0) return;
  const yCell = yTop + hoverStepIdx * cellHeight;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    x0 + 0.75,
    yCell + 0.75,
    x1 - x0 - 1.5,
    cellHeight - 1.5,
  );
  ctx.restore();
}
