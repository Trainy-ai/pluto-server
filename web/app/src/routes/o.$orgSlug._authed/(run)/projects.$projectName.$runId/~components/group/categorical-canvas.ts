// Step / Ridgeline / Heatmap canvas for the `{bars}` widget — the
// categorical bar-chart family rendered from a prefix rollup of N
// scalar metrics. Mirrors the structure of ridgeline-canvas.ts +
// heatmap-canvas.ts (which draw numeric histograms) but operates on
// labeled bars instead of numeric (min, max, num) bins.
//
// The shared `type: "Histogram"` discriminator is a wire-format
// inheritance from the numeric histogram payload — not a claim that
// `{bars}` is a histogram. See barsDataSchema in histogram.schema.ts.

import {
  parseBaseColor,
  ridgeColor,
  computeRidgelineLayout,
  slotBaselineY,
  RIDGELINE_LAYOUT,
} from "./ridgeline-canvas";
import { formatNumber, generateNiceNumbers, TICK_CONFIG } from "./histogram-canvas-utils";

export interface CategoricalBars {
  freq: number[];
  labels: string[];
  maxFreq: number;
  shape: "categorical";
  type: "Histogram";
}

export interface CategoricalStep {
  step: number;
  bars: CategoricalBars;
}

export const CATEGORICAL_LAYOUT = {
  // Rotate X-axis tick labels when bin count exceeds this threshold. Below
  // it, labels fit horizontally; above, they go diagonal to avoid overlap.
  rotationThreshold: 8,
  rotationAngleDeg: 35,
  // When the bar density gets too high, draw only every Nth label. The
  // chart axis spacing target.
  minLabelSpacingPx: 36,
  // Maximum label characters before truncating with an ellipsis. Long
  // subdataset names can blow up axis height otherwise.
  maxLabelChars: 18,
  // Bottom margin reserved for rotated X-axis labels. The default
  // RIDGELINE_LAYOUT.bottomMargin (24px) is the right number for
  // horizontal numeric ticks like "1.0", "2.0", but a 35°-rotated
  // string like "commoncrawl" projects ~40px below its anchor and gets
  // clipped at the canvas edge. We override locally without touching
  // the shared layout used by the numeric ridgeline.
  bottomMarginRotated: 64,
  // Ridgeline: cap the number of stacked ridges so the per-slot height
  // stays visible. 30 was the right number for the numeric ridgeline and
  // visually proves out here too — at 200px usable height, each ridge
  // gets ~7px of baseline space which lets peaks be tall enough to read.
  maxRidges: 30,
  // Heatmap: row density cap. Higher than ridgeline because cells are 1
  // row tall (no stacking with overlap), so we can show more.
  maxHeatmapRows: 200,
} as const;

// Stride-sample steps down to `maxOut`. Always keeps the first and last
// step so the user sees the full training range. Matches the convention
// used by sampleStepsForRidgeline in ridgeline-canvas.ts.
export function sampleCategoricalSteps(
  steps: CategoricalStep[],
  maxOut: number,
): CategoricalStep[] {
  if (steps.length <= maxOut) return steps;
  const stride = Math.ceil(steps.length / maxOut);
  const result: CategoricalStep[] = [];
  for (let i = 0; i < steps.length; i += stride) result.push(steps[i]);
  const last = steps[steps.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

/**
 * Stride-sampling helper that also surfaces the ORIGINAL indices it picked.
 * Callers that need to keep per-row metadata (colors, labels, swatches) in
 * lockstep with the sampled steps use the returned indices to re-stride
 * those parallel arrays the same way. Without this, indexing per-row
 * metadata by the post-sample index lands the wrong color/label on
 * sampled rows whenever sampling actually trims (>30 ridges / >200 heatmap
 * rows).
 */
export function sampleCategoricalStepsWithIndices(
  steps: CategoricalStep[],
  maxOut: number,
): { sampled: CategoricalStep[]; originalIndices: number[] } {
  if (steps.length <= maxOut) {
    return { sampled: steps, originalIndices: steps.map((_, i) => i) };
  }
  const stride = Math.ceil(steps.length / maxOut);
  const sampled: CategoricalStep[] = [];
  const originalIndices: number[] = [];
  for (let i = 0; i < steps.length; i += stride) {
    sampled.push(steps[i]);
    originalIndices.push(i);
  }
  const lastIdx = steps.length - 1;
  if (sampled[sampled.length - 1] !== steps[lastIdx]) {
    sampled.push(steps[lastIdx]);
    originalIndices.push(lastIdx);
  }
  return { sampled, originalIndices };
}

export function truncateLabel(label: string, maxChars: number = CATEGORICAL_LAYOUT.maxLabelChars): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, maxChars - 1)}…`;
}

// Right padding needed for the rightmost rotated X-axis tick.
// At 35° rotation a label of width `w` extends `w·cos(35°)` to the
// right of its anchor (the last bin's center). Without reserving that
// space the canvas clips the tail of "pluto.in_progress" et al.
// `labels` is the FULL label set; we measure the longest (truncated)
// to the maxLabelChars cap. When labels won't rotate (numBins <=
// rotationThreshold) or aren't shown at all (numBins > X_AXIS_LABEL_LIMIT),
// returns 0 — the caller should still pass `labels` so this check fires.
export function rotatedLabelRightBuffer(labels: readonly string[]): number {
  const n = labels.length;
  if (
    n === 0 ||
    n <= CATEGORICAL_LAYOUT.rotationThreshold ||
    n > X_AXIS_LABEL_LIMIT
  ) {
    return 0;
  }
  let maxLen = 0;
  for (const l of labels) {
    const trimmed = Math.min(l.length, CATEGORICAL_LAYOUT.maxLabelChars);
    if (trimmed > maxLen) maxLen = trimmed;
  }
  // 10px sans-serif averages ~6.5 px/char for the kind of identifiers
  // we deal with here. cos(35°) ≈ 0.819. Add 4px breathing room so
  // antialiasing on the last glyph isn't flush against the edge.
  const rad = (CATEGORICAL_LAYOUT.rotationAngleDeg * Math.PI) / 180;
  return Math.ceil(maxLen * 6.5 * Math.cos(rad)) + 4;
}

// Index → x-position helper. Bins are evenly spaced across [xLeft, xRight].
// We use bin CENTERS (i + 0.5) so the leftmost and rightmost bars don't
// hug the y-axis or right gutter.
export function categoricalBinCenterX(
  index: number,
  numBins: number,
  xLeft: number,
  xRight: number,
): number {
  if (numBins <= 0) return xLeft;
  const usable = xRight - xLeft;
  return xLeft + ((index + 0.5) / numBins) * usable;
}

// Compute how many labels to skip for axis rendering. With 100 labels in
// 400px, drawing every label would overlap badly; we render every Nth.
export function categoricalLabelStride(
  numBins: number,
  usableWidth: number,
  minSpacing: number = CATEGORICAL_LAYOUT.minLabelSpacingPx,
): number {
  if (numBins <= 1) return 1;
  const slotWidth = usableWidth / numBins;
  if (slotWidth >= minSpacing) return 1;
  return Math.max(1, Math.ceil(minSpacing / Math.max(slotWidth, 0.0001)));
}

// Hit-test a cursor (x, y) against a categorical Step-mode bar chart.
// Returns the label index under the cursor, or null if outside the plot.
export function hitTestCategoricalBar(
  cursorX: number,
  cursorY: number,
  numBins: number,
  xLeft: number,
  xRight: number,
  topMargin: number,
  bottomMargin: number,
  height: number,
): number | null {
  if (numBins <= 0) return null;
  if (cursorX < xLeft || cursorX >= xRight) return null;
  if (cursorY < topMargin || cursorY >= height - bottomMargin) return null;
  const usable = xRight - xLeft;
  if (usable <= 0) return null;
  const slotWidth = usable / numBins;
  const idx = Math.floor((cursorX - xLeft) / slotWidth);
  if (idx < 0 || idx >= numBins) return null;
  return idx;
}

// Layout geometry needed by hover hit-testers. Exposed so the view
// component can compute (row, col) from a cursor (x, y) without
// duplicating the inline layout math from each draw function.
export interface CategoricalLayoutGeometry {
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
  slotWidth: number;        // x-axis: per-bin
  slotHeight?: number;      // ridgeline only — per-row baseline spacing
  topBaseline?: number;     // ridgeline only — first row baseline Y
  ridgeHeight?: number;     // ridgeline only — vertical extent each ridge
                            // covers above its baseline (= K*slotHeight).
                            // Hit-test needs it because ridges OVERLAP in
                            // Y; the visually-topmost ridge under the
                            // cursor is the one we should attribute the
                            // hover to.
  cellH?: number;           // heatmap only — per-row cell height
}

export function computeCategoricalGeometry(args: {
  width: number;
  height: number;
  numBins: number;
  numRows: number;
  hasRowLabels: boolean;
  willRotate: boolean;
  mode: "step" | "ridgeline" | "heatmap";
  /** Full label set for the chart. Used to size the rotated-X-label
   *  right buffer so the rightmost tick doesn't clip. Omit only in
   *  pre-data renders (loading/empty) — the buffer falls back to 0. */
  labels?: readonly string[];
  /** Transpose: when true, the layout is rotated so that steps run
   *  along the X axis and bins stack along Y. slotWidth then describes
   *  per-step width (numRows columns); cellH/slotHeight per-bin height
   *  (numBins rows). Bottom-axis labels become short step numbers, and
   *  the left gutter widens because bin names go there (typically
   *  long). Only meaningful for Ridgeline/Heatmap modes — Step mode
   *  ignores stepsOnX. */
  stepsOnX?: boolean;
}): CategoricalLayoutGeometry {
  const { width, height, numBins, numRows, hasRowLabels, mode, labels } = args;
  const stepsOnX = args.stepsOnX === true && mode !== "step";
  const { leftMargin, rightMargin, topMargin, rightGutter } = RIDGELINE_LAYOUT;
  // bottomMargin: non-transposed mode reads it from numBins (rotated
  // bin labels need ~64px). Transposed mode shows short step-number
  // ticks at the bottom — always the slim default.
  const bottomMargin = stepsOnX
    ? RIDGELINE_LAYOUT.bottomMargin
    : categoricalBottomMargin(numBins);
  // Left-gutter width:
  //   Step mode: full leftMargin for signed Y ticks.
  //   Transposed: 120 — bin labels (subdataset names) truncated to
  //     fit. Tighter than depth=run because chart-widget pads the
  //     sibling line chart by the same amount.
  //   Non-transposed + row labels: 150 for run names (longer text).
  //   Non-transposed + step-number labels: slim rightGutter.
  const xLeft =
    mode === "step"
      ? leftMargin
      : stepsOnX
        ? Math.max(leftMargin, 120)
        : hasRowLabels
          ? Math.max(leftMargin, 150)
          : rightGutter;
  // Reserve right padding for the rightmost rotated X tick. Only applies
  // when bin labels render on the bottom — which is the non-transposed
  // case. Transposed steps-on-X uses short step-number ticks (no
  // rotation, no rightward projection), but we still need extra right
  // space so the bars panel's xRight matches uPlot's typical right
  // padding (~15-20px reserved for the last X tick's label overflow)
  // and the two panels' plot ends line up. Constant mirrored in
  // chart-widget.tsx as BARS_TRANSPOSED_RIGHT_MARGIN.
  const stepsOnXRightMargin = 44;
  const xLabelRightBuffer = stepsOnX
    ? stepsOnXRightMargin - rightMargin
    : labels
      ? // Halve the rotated-label overflow estimate when category
        // labels go diagonal. The rightmost rotated label ends up
        // extending PAST xRight by the un-reserved half, into the
        // legend's right gutter — that's fine because the legend
        // bar sits in the TOP half of the right side and rotated
        // labels descend DOWN-right, so they don't visually collide.
        // Without halving, the 9-cat case (and every higher-cat
        // count) had ~2× the right padding the 8-cat horizontal
        // case did, shrinking the chart noticeably.
        Math.floor(rotatedLabelRightBuffer(labels) / 2)
      : 0;
  const xRight = width - rightMargin - xLabelRightBuffer;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  // slotWidth divides the X span by however many COLUMNS the layout has.
  // In transposed mode, columns are steps (numRows); otherwise they're
  // bins (numBins).
  const xColumns = stepsOnX ? numRows : numBins;
  const slotWidth = xColumns > 0 ? (xRight - xLeft) / xColumns : 0;

  if (mode === "ridgeline") {
    // Number of stacked ridges along Y. Transposed mode stacks bins
    // (one ridge per bin); non-transposed stacks steps (one per step).
    const yRows = stepsOnX ? numBins : numRows;
    const usable = Math.max(0, yBottom - yTop);
    const useCustom = yRows <= 10;
    let slotHeight: number;
    let topBaseline: number;
    let ridgeHeight: number;
    if (useCustom) {
      const K = 2.4;
      const denom = yRows > 1 ? yRows - 1 + K : K;
      slotHeight = usable / denom;
      topBaseline = yTop + K * slotHeight;
      ridgeHeight = K * slotHeight;
    } else {
      const r = computeRidgelineLayout(yRows, height, topMargin, bottomMargin);
      slotHeight = r.slotHeight;
      topBaseline = r.topBaseline;
      ridgeHeight = r.ridgeHeight;
    }
    return {
      xLeft, xRight, yTop, yBottom, slotWidth, slotHeight, topBaseline, ridgeHeight,
    };
  }
  if (mode === "heatmap") {
    // Same swap: transposed has numBins ROWS on Y, non-transposed has
    // numRows (steps/runs) rows.
    const yRows = stepsOnX ? numBins : numRows;
    const cellH = yRows > 0 ? (yBottom - yTop) / yRows : 0;
    return { xLeft, xRight, yTop, yBottom, slotWidth, cellH };
  }
  return { xLeft, xRight, yTop, yBottom, slotWidth };
}

// Polygon-Y at X helper. Reconstructs the same piecewise-linear
// polygon used by computeCategoricalRidgePolygon (left anchor at
// baseline, peaks at bin centers, right anchor at baseline), and
// returns the polygon's Y at the cursor's X coordinate. This is the
// boundary between "above the ridge" (cursorY < polyY) and "inside
// the ridge body" (cursorY >= polyY AND <= baselineY).
function polygonYAtX(
  cursorX: number,
  freq: number[],
  baselineY: number,
  ridgeHeight: number,
  xLeft: number,
  xRight: number,
  safeMax: number,
): number {
  const numBins = freq.length;
  if (numBins === 0) return baselineY;
  const peakY = (i: number) =>
    baselineY - (freq[i] / safeMax) * ridgeHeight;
  const centerX = (i: number) =>
    categoricalBinCenterX(i, numBins, xLeft, xRight);
  // Left tail: segment from (xLeft, baseline) to (centerX(0), peakY(0)).
  if (cursorX <= centerX(0)) {
    const x0 = xLeft;
    const y0 = baselineY;
    const x1 = centerX(0);
    const y1 = peakY(0);
    if (x1 - x0 < 0.0001) return y1;
    const t = (cursorX - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  }
  // Right tail: segment from (centerX(N-1), peakY(N-1)) to (xRight, baseline).
  if (cursorX >= centerX(numBins - 1)) {
    const x0 = centerX(numBins - 1);
    const y0 = peakY(numBins - 1);
    const x1 = xRight;
    const y1 = baselineY;
    if (x1 - x0 < 0.0001) return y0;
    const t = (cursorX - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  }
  // Interior: find the segment k whose [centerX(k), centerX(k+1)]
  // spans cursorX, then linearly interpolate between its peaks.
  // Bin spacing is uniform so we can solve directly instead of binary-
  // searching: centerX(k) = xLeft + (k + 0.5) * usable / numBins, so
  // k = (cursorX - xLeft)/usable * numBins - 0.5.
  const usable = xRight - xLeft;
  const k = Math.floor((cursorX - xLeft) / usable * numBins - 0.5);
  const kClamped = Math.max(0, Math.min(numBins - 2, k));
  const x0 = centerX(kClamped);
  const y0 = peakY(kClamped);
  const x1 = centerX(kClamped + 1);
  const y1 = peakY(kClamped + 1);
  if (x1 - x0 < 0.0001) return y0;
  const t = (cursorX - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

// Polygon-containment hit-test for ridgeline mode. For each ridge i
// from N-1 down to 0 (i.e. topmost-z-order first, since the drawer
// paints i=0 first and i=N-1 last), compute the polygon's Y at the
// cursor X and check if cursorY is between that polyY and the ridge's
// baseline. Returns the first ridge that contains the cursor, or null
// if the cursor sits in dead space (above all peaks at this X / below
// the bottom ridge's baseline).
//
// This supersedes the geometric ridgeline branch in
// hitTestCategoricalGrid which approximated each ridge as a rectangle
// [baseline - ridgeHeight, baseline] regardless of actual freq values.
// That approximation failed whenever a ridge's polygon at the cursor
// X dipped well below its peak (low bin) — the rectangle still claimed
// the cursor was "inside" while visually the next ridge below was the
// one being hovered. Now we use the same polygon shape the renderer
// draws, so what you hover is what you see.
export function hitTestCategoricalRidgelinePolygons(
  cursorX: number,
  cursorY: number,
  steps: CategoricalStep[],
  geom: CategoricalLayoutGeometry,
  globalMaxFreq: number,
  // Optional transpose. When true, ridges are stacked along X (one
  // per step) — the topmost-z-order walk runs over the step axis, and
  // each "ridge" plots per-bin frequency along Y. Return {row=step,
  // col=bin} preserves caller semantics.
  options?: { stepsOnX?: boolean },
): { row: number; col: number } | null {
  if (steps.length === 0) return null;
  if (cursorX < geom.xLeft || cursorX >= geom.xRight) return null;
  if (cursorY < geom.yTop || cursorY > geom.yBottom) return null;
  const labels = steps[0]?.bars.labels ?? [];
  const numBins = labels.length;
  if (numBins === 0) return null;
  const stepsOnX = options?.stepsOnX === true;
  if (stepsOnX) {
    // Transposed ridgeline: numBins ridges stacked vertically, each
    // walking every step left-to-right. The hit-test must match what
    // the renderer draws — polygon containment, topmost-z-order first
    // — not a uniform grid floor-divide. (That was the bug: the grid
    // approximation treated overlapping ridges as adjacent rectangles,
    // so the cursor latched onto whichever bin row it sat in by
    // y-coordinate regardless of which polygon was actually painted
    // there. Heatmap is exempt because heatmap cells genuinely are
    // uniform.)
    const slotHeight = geom.slotHeight ?? 0;
    const topBaseline = geom.topBaseline ?? 0;
    const ridgeHeight = geom.ridgeHeight ?? slotHeight;
    const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
    // Step column: which step's slot does the cursor X fall into?
    // Clamp to a valid step — we still want a hit on the X tails so
    // hovering anywhere over a ridge returns a step. The dead-space
    // fallback below handles Y-axis tails.
    const rawStep = Math.floor(
      (cursorX - geom.xLeft) / Math.max(geom.slotWidth, 0.0001),
    );
    const stepCol = Math.max(0, Math.min(steps.length - 1, rawStep));
    // Two-pass walk. Pass 1 — topmost-z-first polygon containment.
    // Pass 2 — if no polygon contains the cursor, snap to the polygon
    // whose visible edge at this X is nearest by Y distance. That
    // matches the user spec: "if the mouse is inside a shape, highlight
    // that shape; if it's in black space above a shape, highlight the
    // nearest shape." `polyY` is the top edge of each ridge at the
    // cursor X; `baselineY` is its bottom. Distance to the polygon =
    // 0 inside, otherwise gap to whichever edge is closer in Y.
    let nearestBin = 0;
    let nearestDist = Infinity;
    for (let i = numBins - 1; i >= 0; i--) {
      const baselineY = topBaseline + i * slotHeight;
      // Per-bin freq series across all steps — same shape the
      // transposed drawer feeds into its polygon at row i.
      const binFreq = new Array<number>(steps.length);
      for (let s = 0; s < steps.length; s++) {
        binFreq[s] = steps[s].bars.freq[i] ?? 0;
      }
      const polyY = polygonYAtX(
        cursorX,
        binFreq,
        baselineY,
        ridgeHeight,
        geom.xLeft,
        geom.xRight,
        safeMax,
      );
      if (cursorY >= polyY && cursorY <= baselineY) {
        return { row: stepCol, col: i };
      }
      // Track the closest polygon edge for the dead-space snap. Use
      // the nearer of the two edges (polyY = top, baselineY = bottom)
      // so we behave well both above and below the ridge.
      const distAbove = polyY - cursorY; // > 0 when cursor above polygon
      const distBelow = cursorY - baselineY; // > 0 when cursor below baseline
      const dist = Math.max(distAbove, distBelow, 0);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestBin = i;
      }
    }
    return { row: stepCol, col: nearestBin };
  }
  const col = Math.floor(
    (cursorX - geom.xLeft) / Math.max(geom.slotWidth, 0.0001),
  );
  if (col < 0 || col >= numBins) return null;
  const slotHeight = geom.slotHeight ?? 0;
  const topBaseline = geom.topBaseline ?? 0;
  const ridgeHeight = geom.ridgeHeight ?? slotHeight;
  const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
  // Walk ridges from topmost (last-painted, highest i) to bottom.
  // First polygon containing the cursor wins — that's what's visible
  // at the cursor position.
  for (let i = steps.length - 1; i >= 0; i--) {
    const baselineY = topBaseline + i * slotHeight;
    const freq = steps[i].bars.freq;
    const polyY = polygonYAtX(
      cursorX,
      freq,
      baselineY,
      ridgeHeight,
      geom.xLeft,
      geom.xRight,
      safeMax,
    );
    if (cursorY >= polyY && cursorY <= baselineY) {
      return { row: i, col };
    }
  }
  // Fallback for "dead space" — cursor lies in the band BELOW one
  // ridge's polygon and ABOVE the next ridge's baseline, but no
  // polygon actually covers it (the lower ridge happens to be flat
  // here). Without this, those columns would have no hover at all,
  // and the user can't read the flat ridge's value.
  //
  // Territorial rule: cursor Y belongs to the ridge whose baseline is
  // the FIRST one at-or-below the cursor — i.e. smallest i where
  // baselineY(i) >= cursorY. That's ceil((cursorY - topBaseline) /
  // slotHeight), clamped to [0, N-1]. Polygon containment still wins
  // first, so a low ridge with a tall peak at this X correctly keeps
  // "stealing" cursors from the run above when its polygon reaches up
  // into the dead-space band.
  const rel = (cursorY - topBaseline) / Math.max(slotHeight, 0.0001);
  // `| 0` after the ceil normalizes the JS `-0` result that Math.ceil
  // produces for small negative inputs (e.g. ceil(-0.06) === -0). Without
  // it Object.is(-0, 0) is false, which breaks strict equality checks
  // downstream and confuses test assertions even though the value is
  // visually zero.
  let row = Math.ceil(rel) | 0;
  if (row < 0) row = 0;
  if (row >= steps.length) row = steps.length - 1;
  return { row, col };
}

// Heatmap-only grid hit-test. Cells are uniform [i, i+1) bands so a
// simple floor on cellH is correct. Ridgeline has its own polygon-
// containment hit-test (hitTestCategoricalRidgelinePolygons) because
// ridges overlap vertically; the geometric "which slot owns this Y"
// question doesn't have a single answer there.
export function hitTestCategoricalGrid(
  cursorX: number,
  cursorY: number,
  numBins: number,
  numRows: number,
  geom: CategoricalLayoutGeometry,
  mode: "heatmap",
  // Optional transpose flag. When true, the screen X axis encodes
  // step-index (numRows columns) and Y encodes bin-index (numBins rows).
  // The return value preserves the {row=step-index, col=bin-index}
  // semantics so callers don't need to special-case stepsOnX.
  options?: { stepsOnX?: boolean },
): { row: number; col: number } | null {
  if (numBins <= 0 || numRows <= 0) return null;
  if (cursorX < geom.xLeft || cursorX >= geom.xRight) return null;
  if (cursorY < geom.yTop || cursorY >= geom.yBottom) return null;
  void mode;
  const stepsOnX = options?.stepsOnX === true;
  const screenCol = Math.floor((cursorX - geom.xLeft) / Math.max(geom.slotWidth, 0.0001));
  const cellH = geom.cellH ?? 0;
  const screenRow = Math.floor((cursorY - geom.yTop) / Math.max(cellH, 0.0001));
  if (stepsOnX) {
    // Transposed: screen column = step-index (row in our semantics),
    // screen row = bin-index (col in our semantics).
    if (screenCol < 0 || screenCol >= numRows) return null;
    if (screenRow < 0 || screenRow >= numBins) return null;
    return { row: screenCol, col: screenRow };
  }
  if (screenCol < 0 || screenCol >= numBins) return null;
  if (screenRow < 0 || screenRow >= numRows) return null;
  return { row: screenRow, col: screenCol };
}

// Compute polygon points for one categorical ridge (used by ridgeline mode).
// Bin CENTERS are placed at evenly-spaced positions; baseline endpoints
// anchor to the leftmost and rightmost bin slots so the ridge sits inside
// the axis bounds.
export function computeCategoricalRidgePolygon(
  step: CategoricalStep,
  opts: {
    globalMaxFreq: number;
    slotBaselineY: number;
    ridgeHeight: number;
    xLeft: number;
    xRight: number;
  },
): Array<{ x: number; y: number }> {
  const { freq, labels } = step.bars;
  const { globalMaxFreq, slotBaselineY, ridgeHeight, xLeft, xRight } = opts;
  const numBins = labels.length;
  if (numBins === 0) return [];

  const safeGlobalMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
  const points: Array<{ x: number; y: number }> = [];

  // Baseline anchor at the leftmost slot's left edge.
  points.push({ x: xLeft, y: slotBaselineY });

  for (let i = 0; i < numBins; i++) {
    // Clamp negative freq to 0 so the polygon never dips below the
    // baseline (negative peaks would intrude into the next ridge's
    // visual zone). Step mode handles signed values explicitly with
    // a zero-baseline scale; ridgeline doesn't make geometric sense
    // for bipolar data, so we surface negatives as "no peak here"
    // rather than mangle the layout.
    const f = Math.max(0, freq[i] ?? 0);
    const yTop = slotBaselineY - (f / safeGlobalMax) * ridgeHeight;
    const cx = categoricalBinCenterX(i, numBins, xLeft, xRight);
    points.push({ x: cx, y: yTop });
  }

  // Baseline anchor at the rightmost slot's right edge.
  points.push({ x: xRight, y: slotBaselineY });
  return points;
}

export function computeCategoricalGlobalMaxFreq(steps: CategoricalStep[]): number {
  let m = 0;
  for (const s of steps) {
    if (s.bars.maxFreq > m) m = s.bars.maxFreq;
  }
  return m;
}

// Threshold at/below which we draw EVERY bin label. Above this, no
// labels at all — users get info via the hover tooltip + the
// highlighted column outline. (Picked at 30 because at typical widget
// widths a 30-bin chart gives each bin ~30px of slot, enough for the
// projected rotated label width with truncation.)
export const X_AXIS_LABEL_LIMIT = 30;

// Decide bottom-margin based on whether labels will actually be drawn.
// At >LIMIT bins we draw none, so reserve the small (unrotated) margin.
// At ≤LIMIT with rotation threshold exceeded, reserve the rotated
// margin so diagonal labels don't get clipped at the canvas bottom.
export function categoricalBottomMargin(_numBins: number): number {
  // Always reserve the rotated-labels bottom margin so the chart's
  // bottom edge sits in the same place regardless of category count:
  // few cats (horizontal labels), many cats (rotated labels), or
  // too-many cats (no labels) all share the same 64px gutter. Without
  // this, the chart jumped vertically as the user widened the bin
  // range, and the `category` axis-title overlay sat directly on top
  // of the chart rectangle for the horizontal-labels case (no gap).
  return CATEGORICAL_LAYOUT.bottomMarginRotated;
}

// Draw an X-axis with categorical tick labels. Two modes:
//   - bins ≤ X_AXIS_LABEL_LIMIT: draw EVERY label, rotating diagonally
//     when bin count exceeds rotationThreshold so they don't overlap.
//   - bins > X_AXIS_LABEL_LIMIT: draw nothing. Labels at this density
//     are unreadable; users get the bin name via hover. The canvas
//     also draws a highlight outline on the hovered column so the
//     user can see exactly which one they're inspecting.

// Draw a 1.5px outline around the hovered column (step/ridgeline) or
// cell (heatmap). Called immediately after the main draw call inside
// each render-prop so the highlight sits on top of the bars
// without being blown away by clearRect. Compatible with both
// dark and light themes by picking a high-contrast stroke.
export function drawCategoricalHighlight(args: {
  ctx: CanvasRenderingContext2D;
  geom: CategoricalLayoutGeometry;
  mode: "step" | "ridgeline" | "heatmap";
  numBins: number;
  numRows: number;
  hoverCol: number | null;
  hoverRow: number | null;
  theme: "light" | "dark";
  /** Transposed (steps-on-X) mode. Highlights swap orientation: the
   *  "column" outline becomes a horizontal band across all step
   *  columns at the hovered bin row; the heatmap cell flips x↔y. */
  stepsOnX?: boolean;
}): void {
  const { ctx, geom, mode, numBins, numRows, hoverCol, hoverRow, theme } = args;
  const stepsOnX = args.stepsOnX === true && mode !== "step";
  if (hoverCol === null || hoverCol < 0 || hoverCol >= numBins) return;
  if (geom.slotWidth <= 0) return;
  const strokeColor =
    theme === "dark" ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.75)";
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  if (stepsOnX) {
    // hoverCol is bin-index (still our caller-facing semantic). In
    // transposed mode the bin maps to a horizontal ROW on screen.
    if (mode === "heatmap") {
      // Heatmap cell: the specific (step-col, bin-row) cell. Cells are
      // genuinely uniform so the strokeRect is informative.
      const rowH = geom.cellH ?? (geom.yBottom - geom.yTop) / Math.max(1, numBins);
      const y = geom.yTop + hoverCol * rowH;
      if (hoverRow !== null && hoverRow >= 0 && hoverRow < numRows) {
        const x = geom.xLeft + hoverRow * geom.slotWidth;
        ctx.strokeRect(
          x + 0.75,
          y + 0.75,
          geom.slotWidth - 1.5,
          rowH - 1.5,
        );
      }
    }
    // Ridgeline transposed: no rectangle. The polygon re-stroke from
    // drawCategoricalRidgelineHoverHighlight already outlines the
    // hovered shape; a row-band rectangle on top of that is redundant
    // and visually noisy. Drop it entirely. (Per-user spec.)
    ctx.restore();
    return;
  }
  const x = geom.xLeft + hoverCol * geom.slotWidth;
  if (mode === "heatmap" && hoverRow !== null && hoverRow >= 0 && hoverRow < numRows) {
    const cellH = geom.cellH ?? (geom.yBottom - geom.yTop) / Math.max(1, numRows);
    ctx.strokeRect(
      x + 0.75,
      geom.yTop + hoverRow * cellH + 0.75,
      geom.slotWidth - 1.5,
      cellH - 1.5,
    );
  } else {
    // Step + ridgeline: highlight the full column (all rows at this bin).
    ctx.strokeRect(
      x + 0.75,
      geom.yTop + 0.75,
      geom.slotWidth - 1.5,
      geom.yBottom - geom.yTop - 1.5,
    );
  }
  ctx.restore();
}

// Re-stroke the hovered row's polygon on top of the categorical
// ridgeline so the whole curve under the cursor pops out of the
// stack. Mirrors drawRidgelineHoverHighlight for the numeric case —
// uses computeCategoricalRidgePolygon so the path matches the drawn
// shape exactly. Sits OVER the rendered ridges but under the column-
// outline highlight, so the user gets both: the curve as a whole
// (this) plus the specific bin column they're hovering (drawCategorical-
// Highlight). Caller can skip this when row info isn't meaningful
// (Step + Heatmap modes already get the column outline alone).
export function drawCategoricalRidgelineHoverHighlight(args: {
  ctx: CanvasRenderingContext2D;
  steps: CategoricalStep[];
  geom: CategoricalLayoutGeometry;
  globalMaxFreq: number;
  hoverRow: number;
  theme: "light" | "dark";
  /** Transposed (steps-on-X) variant. In transposed ridgeline mode
   *  rows are bins, so hoverRow is interpreted as a STEP-INDEX (matches
   *  the caller's row=step semantic) — but the polygon we outline is
   *  the BIN whose row contains the cursor. Callers pass hoverBinCol
   *  to identify which bin row to stroke. */
  stepsOnX?: boolean;
  hoverBinCol?: number;
}): void {
  const { ctx, steps, geom, globalMaxFreq, hoverRow, theme } = args;
  const stepsOnX = args.stepsOnX === true;
  if (steps.length === 0) return;
  const { xLeft, xRight, yTop, yBottom, slotHeight, topBaseline, ridgeHeight } = geom;
  if (
    slotHeight === undefined ||
    topBaseline === undefined ||
    ridgeHeight === undefined
  ) {
    return;
  }
  if (xRight - xLeft <= 0 || yBottom - yTop <= 0) return;

  // Inverted vs. the normal ridge outlines (white-ish dark / black-ish
  // light). High contrast so the hovered ridge pops out of a dense
  // stack instead of melting into its neighbors.
  const strokeColor =
    theme === "dark" ? "rgba(0,0,0,0.95)" : "rgba(255,255,255,0.95)";

  if (stepsOnX) {
    const labels = steps[0]?.bars.labels ?? [];
    const numBins = labels.length;
    const binRow = args.hoverBinCol ?? -1;
    if (binRow < 0 || binRow >= numBins) return;
    const baselineY = topBaseline + binRow * slotHeight;
    const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
    const numSteps = steps.length;
    // Build the per-step polygon for the hovered bin row.
    const polygon: Array<{ x: number; y: number }> = [];
    polygon.push({ x: xLeft, y: baselineY });
    for (let s = 0; s < numSteps; s++) {
      const f = Math.max(0, steps[s].bars.freq[binRow] ?? 0);
      const cx = categoricalBinCenterX(s, numSteps, xLeft, xRight);
      const ty = baselineY - (f / safeMax) * ridgeHeight;
      polygon.push({ x: cx, y: ty });
    }
    polygon.push({ x: xRight, y: baselineY });

    ctx.save();
    ctx.beginPath();
    ctx.rect(xLeft, yTop, xRight - xLeft, yBottom - yTop);
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
    return;
  }

  if (hoverRow < 0 || hoverRow >= steps.length) return;
  const baselineY = topBaseline + hoverRow * slotHeight;
  const polygon = computeCategoricalRidgePolygon(steps[hoverRow], {
    globalMaxFreq,
    slotBaselineY: baselineY,
    ridgeHeight,
    xLeft,
    xRight,
  });
  if (polygon.length < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(xLeft, yTop, xRight - xLeft, yBottom - yTop);
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

function drawCategoricalAxisLabels(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  xLeft: number,
  xRight: number,
  axisY: number,
  axisColor: string,
): void {
  const numBins = labels.length;
  if (numBins === 0 || numBins > X_AXIS_LABEL_LIMIT) return;
  const rotate = numBins > CATEGORICAL_LAYOUT.rotationThreshold;
  const rad = (CATEGORICAL_LAYOUT.rotationAngleDeg * Math.PI) / 180;

  ctx.save();
  ctx.fillStyle = axisColor;
  ctx.font = "10px sans-serif";

  for (let i = 0; i < numBins; i++) {
    const cx = categoricalBinCenterX(i, numBins, xLeft, xRight);
    const text = truncateLabel(labels[i]);
    if (rotate) {
      ctx.save();
      ctx.translate(cx, axisY + TICK_CONFIG.TICK_LENGTH + 2);
      ctx.rotate(rad);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(text, cx, axisY + TICK_CONFIG.TICK_LENGTH + 2);
    }
  }
  ctx.restore();
}

export interface CategoricalRidgelineProps {
  steps: CategoricalStep[];
  width: number;
  height: number;
  baseColor: string;
  theme: "light" | "dark";
  // Optional shared max-freq for cross-card height comparability (multi-run).
  globalMaxFreq?: number;
  // Suppress the right-gutter step labels entirely. Used when the caller
  // wants no labels at all (rare).
  hideRowLabels?: boolean;
  // Optional explicit row labels (e.g. run names in depth=run mode).
  // When set, replaces the default per-step labels in the right gutter.
  // Renders the labels via canvas so they align exactly with each
  // ridge's baseline (HTML overlays misalign because the slot heights
  // are computed math, not CSS flex-distribution).
  rowLabels?: string[];
  // Optional color swatches drawn left of each rowLabel — preserves run
  // identity even when the cell color is faint at low counts.
  rowLabelSwatchColors?: string[];
  // Optional per-ridge base color overrides. When provided and depth=run
  // mode is active, each ridge uses its corresponding run's color
  // instead of the gradient derived from a single baseColor. Length
  // must equal steps.length when set.
  perRidgeColors?: string[];
  // Transpose: when true, rows are bins and columns are steps. Each
  // ridge then plots the freq of one bin as it varies over training
  // steps — a per-bin time-series stacked vertically. perRidgeColors /
  // rowLabels / rowLabelSwatchColors are ignored in transposed mode
  // (they were keyed to per-step or per-run identity).
  stepsOnX?: boolean;
}

export function drawCategoricalRidgeline(
  ctx: CanvasRenderingContext2D,
  props: CategoricalRidgelineProps,
): void {
  if (props.stepsOnX === true) {
    drawCategoricalRidgelineTransposed(ctx, props);
    return;
  }
  // Down-sample on entry so callers don't have to think about it. With
  // 10k training steps the un-sampled draw collapses to sub-pixel slots
  // and renders as a solid white block; capping to maxRidges keeps each
  // slot ~7px tall at 200px usable height. Track which original indices
  // we kept so per-row metadata (colors, labels, swatches) can be
  // re-strided into lockstep with the sampled steps.
  const { sampled: steps, originalIndices } = sampleCategoricalStepsWithIndices(
    props.steps,
    CATEGORICAL_LAYOUT.maxRidges,
  );
  const { width, height, baseColor, theme } = props;
  if (steps.length === 0) return;
  const { leftMargin, rightMargin, topMargin, rightGutter } = RIDGELINE_LAYOUT;
  // bottomMargin: large for rotated labels (≤X_AXIS_LABEL_LIMIT bins),
  // small when no labels are drawn (>X_AXIS_LABEL_LIMIT bins).
  const labelsAll = steps[0]?.bars.labels ?? [];
  const willRotate =
    labelsAll.length > CATEGORICAL_LAYOUT.rotationThreshold &&
    labelsAll.length <= X_AXIS_LABEL_LIMIT;
  const bottomMargin = categoricalBottomMargin(labelsAll.length);
  // Row labels now live in the LEFT gutter (standardized across all
  // bin-shaped views — bars + numeric histograms). 150px for long
  // run names (depth=run), the
  // shared rightGutter width (~36) for short step numbers, 0 when
  // labels are explicitly hidden. The chart area xLeft is then
  // max(leftMargin, leftLabelGutter) so the left-side breathing room
  // stays consistent regardless of which label mode is in play.
  // Slim gutter for short step-number labels; full leftMargin only
  // when run-name labels are present (long text) or labels are
  // hidden (no gutter needed at all). Matches computeCategoricalGeometry.
  ctx.clearRect(0, 0, width, height);
  const xLeft = props.hideRowLabels
    ? leftMargin
    : props.rowLabels
      ? Math.max(leftMargin, 150)
      : rightGutter;
  // Pad right edge for the rightmost rotated label, matching Step mode.
  // Halved so this stays in sync with `computeCategoricalGeometry` (also
  // halved) — both the drawer's painted geometry and the hover
  // hit-test's expected geometry need to agree.
  const xRight =
    width - rightMargin - Math.floor(rotatedLabelRightBuffer(labelsAll) / 2);
  if (xRight - xLeft <= 0 || height - topMargin - bottomMargin <= 0) return;

  const labels = labelsAll;
  const globalMaxFreq = props.globalMaxFreq ?? computeCategoricalGlobalMaxFreq(steps);
  // Custom layout: with few rows (e.g. 6 runs), the shared ×8
  // multiplier puts the first ridge's baseline 60% of the way down the
  // chart, leaving 40% of dead space at the top before ridges even
  // start. With ≤10 rows we use a smaller K so the entire stack fills
  // usable height. Solving K*slotHeight + (N-1)*slotHeight = usable
  // gives slotHeight = usable/(N-1+K) and ridgeHeight = K*slotHeight.
  const FEW_ROWS_THRESHOLD = 10;
  const usableHeight = Math.max(0, height - topMargin - bottomMargin);
  const useCustomLayout = steps.length <= FEW_ROWS_THRESHOLD;
  let slotHeight: number;
  let ridgeHeight: number;
  let topBaseline: number;
  if (useCustomLayout) {
    const K = 2.4;
    const denom = steps.length > 1 ? steps.length - 1 + K : K;
    slotHeight = usableHeight / denom;
    ridgeHeight = K * slotHeight;
    topBaseline = topMargin + ridgeHeight;
  } else {
    const shared = computeRidgelineLayout(
      steps.length,
      height,
      topMargin,
      bottomMargin,
    );
    slotHeight = shared.slotHeight;
    ridgeHeight = shared.ridgeHeight;
    topBaseline = shared.topBaseline;
  }

  // Helper: compute each ridge's baseline Y. With the custom layout we
  // use our own topBaseline+slotHeight; otherwise delegate to the
  // shared helper (which computes the same values internally).
  const baselineForRow = (i: number) =>
    useCustomLayout
      ? topBaseline + i * slotHeight
      : slotBaselineY(i, steps.length, height, topMargin, bottomMargin);

  // Back-to-front paint order (oldest at top).
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const baselineY = baselineForRow(i);
    const polygon = computeCategoricalRidgePolygon(step, {
      globalMaxFreq,
      slotBaselineY: baselineY,
      ridgeHeight,
      xLeft,
      xRight,
    });
    // Per-ridge color override: depth=run mode passes one color per
    // ridge so each run keeps its IDENTITY color verbatim — no
    // hue-shift, no lightness ramp. Using ridgeColor() here would
    // shift orange (h=45) toward red (h=15), making run-03's row
    // bright red even though its legend dot is orange.
    const stroke = theme === "dark" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
    // Index perRidgeColors by the ORIGINAL row index — the caller's array
    // is sized to the unsampled `props.steps`, so sampling out an entry
    // would otherwise shift every subsequent row's color one slot down.
    const origI = originalIndices[i] ?? i;
    const fill = props.perRidgeColors
      ? (props.perRidgeColors[origI] ?? baseColor)
      : ridgeColor(baseColor, i, steps.length, theme).fill;

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

  const axisColor = theme === "dark" ? "#94a3b8" : "#666";
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xLeft, height - bottomMargin);
  ctx.lineTo(xRight, height - bottomMargin);
  ctx.stroke();

  drawCategoricalAxisLabels(ctx, labels, xLeft, xRight, height - bottomMargin, axisColor);

  // Left-gutter labels. Three modes:
  //   1) hideRowLabels: render nothing.
  //   2) rowLabels provided: use those (e.g. run names in depth=run
  //      mode). Right-aligned to xLeft-4 so the label hugs the chart
  //      edge. Optional color swatch is positioned IMMEDIATELY to the
  //      LEFT of the text (computed via measureText) so the swatch
  //      stays adjacent to its label regardless of text length.
  //   3) Default: numeric step number per ridge, stride-thinned to
  //      avoid overlap, same right-aligned anchor.
  if (!props.hideRowLabels) {
    ctx.fillStyle = axisColor;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const minSpacing = RIDGELINE_LAYOUT.minStepLabelSpacingPx;
    const stride = Math.max(
      1,
      Math.ceil(minSpacing / Math.max(slotHeight, 0.0001)),
    );
    const drawEvery = props.rowLabels ? 1 : stride;
    const rowLabelMaxChars = props.rowLabels ? 30 : CATEGORICAL_LAYOUT.maxLabelChars;
    const textRightX = xLeft - 4;
    const swatchSize = 8;
    const swatchGap = 4;
    for (let i = 0; i < steps.length; i++) {
      if (i % drawEvery !== 0 && i !== steps.length - 1) continue;
      const y = baselineForRow(i);
      // Per-row metadata (rowLabels, rowLabelSwatchColors) is sized to
      // the unsampled input — index it by the ORIGINAL row index so
      // sampled rows still pick up the right label/swatch.
      const origI = originalIndices[i] ?? i;
      const text = props.rowLabels
        ? truncateLabel(props.rowLabels[origI] ?? "", rowLabelMaxChars)
        : formatNumber(steps[i].step, true);
      const swatch = props.rowLabelSwatchColors?.[origI];
      if (swatch) {
        const textW = ctx.measureText(text).width;
        const swatchX = textRightX - textW - swatchGap - swatchSize;
        ctx.fillStyle = swatch;
        ctx.fillRect(swatchX, y - swatchSize / 2, swatchSize, swatchSize);
        ctx.fillStyle = axisColor;
      }
      ctx.fillText(text, textRightX, y);
    }
  }
}

// Transposed (steps-on-X) categorical ridgeline. Each ridge is one
// BIN whose freq is tracked across step columns. Layout mirrors the
// transposed heatmap: bin labels go on the left gutter, step numbers
// on the bottom axis.
function drawCategoricalRidgelineTransposed(
  ctx: CanvasRenderingContext2D,
  props: CategoricalRidgelineProps,
): void {
  // Same sampling cap as the non-transposed path so wide step sets
  // don't blow up column count. Per-step columns can stay denser than
  // ridges (heatmap-rows is 200) but ridgeline shapes need a bit of
  // breathing room — we keep the same maxRidges (30) cap on STEP count
  // here so peaks remain visually readable.
  const { sampled: steps } = sampleCategoricalStepsWithIndices(
    props.steps,
    CATEGORICAL_LAYOUT.maxRidges,
  );
  const { width, height, baseColor, theme } = props;
  if (steps.length === 0) return;
  const { leftMargin, rightMargin, topMargin } = RIDGELINE_LAYOUT;
  const labels = steps[0]?.bars.labels ?? [];
  const numBins = labels.length;
  if (numBins === 0) return;

  // Bin labels go on the left (truncated to fit a 120px gutter), step
  // labels go on bottom (short → default 24px bottomMargin).
  const bottomMargin = RIDGELINE_LAYOUT.bottomMargin;
  ctx.clearRect(0, 0, width, height);
  const xLeft = props.hideRowLabels ? leftMargin : Math.max(leftMargin, 120);
  // Match the heatmap drawer: wider right pad so the plot end lines up
  // with a sibling line chart whose `extraRightPadding` is the same.
  const stepsOnXRightMargin = 44;
  const xRight = width - stepsOnXRightMargin;
  if (xRight - xLeft <= 0 || height - topMargin - bottomMargin <= 0) return;
  void rightMargin;

  const globalMaxFreq = props.globalMaxFreq ?? computeCategoricalGlobalMaxFreq(steps);
  const usableHeight = Math.max(0, height - topMargin - bottomMargin);

  // Mirror the non-transposed layout choice: with ≤10 ridges (bins),
  // use the K=2.4 custom layout so the stack fills usable height.
  const FEW_ROWS_THRESHOLD = 10;
  const useCustomLayout = numBins <= FEW_ROWS_THRESHOLD;
  let slotHeight: number;
  let ridgeHeight: number;
  let topBaseline: number;
  if (useCustomLayout) {
    const K = 2.4;
    const denom = numBins > 1 ? numBins - 1 + K : K;
    slotHeight = usableHeight / denom;
    ridgeHeight = K * slotHeight;
    topBaseline = topMargin + ridgeHeight;
  } else {
    const shared = computeRidgelineLayout(
      numBins,
      height,
      topMargin,
      bottomMargin,
    );
    slotHeight = shared.slotHeight;
    ridgeHeight = shared.ridgeHeight;
    topBaseline = shared.topBaseline;
  }

  const baselineForRow = (i: number) =>
    useCustomLayout
      ? topBaseline + i * slotHeight
      : slotBaselineY(i, numBins, height, topMargin, bottomMargin);

  const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
  const numSteps = steps.length;

  // Back-to-front paint order — bin 0 (top of stack) first so deeper
  // bins overdraw it. Matches the layered look of the non-transposed
  // ridgeline. Within each bin, polygon vertices visit every step
  // column in order, peak height = freq[binRow] at that step.
  for (let binRow = 0; binRow < numBins; binRow++) {
    const baselineY = baselineForRow(binRow);
    const polygon: Array<{ x: number; y: number }> = [];
    polygon.push({ x: xLeft, y: baselineY });
    for (let s = 0; s < numSteps; s++) {
      const f = Math.max(0, steps[s].bars.freq[binRow] ?? 0);
      const cx = categoricalBinCenterX(s, numSteps, xLeft, xRight);
      const ty = baselineY - (f / safeMax) * ridgeHeight;
      polygon.push({ x: cx, y: ty });
    }
    polygon.push({ x: xRight, y: baselineY });

    const stroke = theme === "dark" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
    const fill = ridgeColor(baseColor, binRow, numBins, theme).fill;

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

  // Bottom axis line.
  const axisColor = theme === "dark" ? "#94a3b8" : "#666";
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xLeft, height - bottomMargin);
  ctx.lineTo(xRight, height - bottomMargin);
  ctx.stroke();

  // Step ticks across the bottom — reused from the transposed-heatmap
  // helper. cellW here = per-step column width derived from the same
  // x span.
  const cellW = (xRight - xLeft) / numSteps;
  drawTransposedStepTicks(
    ctx,
    steps,
    xLeft,
    xRight,
    height - bottomMargin,
    cellW,
    axisColor,
  );

  // Left-gutter bin labels — hidden entirely when numBins exceeds
  // X_AXIS_LABEL_LIMIT (same rule the non-transposed bottom axis uses
  // for bin labels). At that density even stride-thinned labels overlap
  // and read as noise; the user identifies bins via hover instead.
  if (!props.hideRowLabels && numBins <= X_AXIS_LABEL_LIMIT) {
    ctx.fillStyle = axisColor;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const textRightX = xLeft - 4;
    // 18 chars fits the 120px transposed gutter (~6px/char in 10px
    // sans-serif). Drop to 16 if the cap needs more breathing room.
    const rowLabelMaxChars = 18;
    // Stride-thin if slotHeight gets cramped — keeps labels readable
    // when binRange has many entries and rows pack tight.
    const minSpacing = RIDGELINE_LAYOUT.minStepLabelSpacingPx;
    const stride = Math.max(
      1,
      Math.ceil(minSpacing / Math.max(slotHeight, 0.0001)),
    );
    for (let i = 0; i < numBins; i++) {
      if (i % stride !== 0 && i !== numBins - 1) continue;
      const y = baselineForRow(i);
      const text = truncateLabel(labels[i] ?? "", rowLabelMaxChars);
      ctx.fillText(text, textRightX, y);
    }
  }
}

// Step-mode bar chart for a single step's categorical payload.
export function drawCategoricalBars(
  ctx: CanvasRenderingContext2D,
  payload: CategoricalBars,
  width: number,
  height: number,
  baseColor: string,
  theme: "light" | "dark",
  yMaxOverride?: number,
): void {
  const { leftMargin, rightMargin, topMargin } = RIDGELINE_LAYOUT;
  const bottomMargin = categoricalBottomMargin(payload.labels.length);
  ctx.clearRect(0, 0, width, height);
  // Step mode chart bounds. Reserve right padding sized to the
  // longest (truncated) label so the rightmost rotated tick doesn't
  // clip. Helper returns 0 for "labels hidden" / "no rotation".
  // Halved so this matches `computeCategoricalGeometry`'s xRight (also
  // halved earlier) — without the match the drawer paints bars with
  // ~2× the right padding the hit-test expects, so the rightmost bar
  // visually shifts left of where the cursor lands and `hitTestCategoricalBar`
  // returns an off-by-one column.
  const xLabelRightBuffer = Math.floor(
    rotatedLabelRightBuffer(payload.labels) / 2,
  );
  const xLeft = leftMargin;
  const xRight = width - rightMargin - xLabelRightBuffer;
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  if (xRight - xLeft <= 0 || yBottom - yTop <= 0) return;

  const { freq, labels, maxFreq } = payload;
  const numBins = labels.length;
  if (numBins === 0) return;

  const usableWidth = xRight - xLeft;
  const usableHeight = yBottom - yTop;
  // Auto-detect signed data. If every freq is ≥ 0 we keep the
  // original [0, max] scale (so existing all-positive prefixes look
  // unchanged). If any freq is negative we switch to a signed scale
  // [min, max] anchored on zero — bars extend UP from the zero line
  // for positives, DOWN for negatives, and the zero line itself is
  // drawn explicitly so users can see where it sits.
  const finite = freq.filter((v): v is number => Number.isFinite(v));
  const hasNegative = finite.some((v) => v < 0);
  let yMin: number;
  let yMax: number;
  if (hasNegative) {
    yMin = Math.min(0, ...finite);
    yMax = Math.max(0, ...finite, 0.0001);
  } else {
    yMin = 0;
    yMax = yMaxOverride !== undefined && yMaxOverride > 0
      ? yMaxOverride
      : maxFreq > 0
        ? maxFreq
        : 1;
  }
  const yRange = yMax - yMin > 0 ? yMax - yMin : 1;
  const valueToY = (v: number) => yBottom - ((v - yMin) / yRange) * usableHeight;
  const zeroY = valueToY(0);
  const slotWidth = usableWidth / numBins;
  const barWidth = slotWidth * 0.75;
  const barInset = (slotWidth - barWidth) / 2;

  const { fill } = ridgeColor(baseColor, 0, 1, theme);
  ctx.fillStyle = fill;
  for (let i = 0; i < numBins; i++) {
    const f = freq[i] ?? 0;
    const valueY = valueToY(f);
    const x = xLeft + i * slotWidth + barInset;
    const barTop = Math.min(valueY, zeroY);
    const barH = Math.abs(valueY - zeroY);
    ctx.fillRect(x, barTop, barWidth, Math.max(0, barH));
  }

  const axisColor = theme === "dark" ? "#94a3b8" : "#666";
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xLeft, yBottom);
  ctx.lineTo(xRight, yBottom);
  ctx.stroke();

  // Zero-baseline line (only when the scale includes negatives — for
  // all-positive data the bottom axis already IS the zero line).
  if (hasNegative) {
    ctx.beginPath();
    ctx.strokeStyle = axisColor;
    ctx.setLineDash([2, 3]);
    ctx.moveTo(xLeft, zeroY);
    ctx.lineTo(xRight, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Y-axis ticks (5 evenly-spaced across [yMin, yMax]).
  ctx.fillStyle = axisColor;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let t = 0; t <= 4; t++) {
    const v = yMin + (yRange * t) / 4;
    const y = valueToY(v);
    ctx.fillText(formatNumber(v), xLeft - 4, y);
    ctx.beginPath();
    ctx.moveTo(xLeft - 2, y);
    ctx.lineTo(xLeft, y);
    ctx.stroke();
  }

  drawCategoricalAxisLabels(ctx, labels, xLeft, xRight, yBottom, axisColor);
}

// Heatmap: cells are (step or run, label) → freq. Rows-axis is provided
// externally (each row's label is drawn on the right gutter). Color uses
// a linear interpolation between two endpoints.
export interface CategoricalHeatmapProps {
  steps: CategoricalStep[]; // one row per entry (step or run)
  width: number;
  height: number;
  baseColor: string;
  theme: "light" | "dark";
  rowLabels?: string[]; // override step labels (used for ridge-per-run mode)
  globalMaxFreq?: number;
  // Optional per-row base colors. When provided, each row uses its own
  // color ramp (low → that row's color); the row-identity is preserved
  // in the visual (run X's row reads in run X's color). Without it,
  // all rows share `baseColor` as the high end of a single ramp.
  perRowColors?: string[];
  // Optional inline color swatches drawn to the LEFT of each row
  // label in the right gutter. Used for depth=run mode when row
  // colors are too subtle to identify the run by the cell hue alone.
  rowLabelSwatchColors?: string[];
  // Transpose: when true, steps run along the X axis and bins stack on
  // Y. Row labels then come from bin labels (not step numbers), and
  // bottom-axis labels show step numbers. Per-row colors are ignored
  // in transposed mode (no per-step identity color today).
  stepsOnX?: boolean;
}

export function drawCategoricalHeatmap(
  ctx: CanvasRenderingContext2D,
  props: CategoricalHeatmapProps,
): void {
  // Same as ridgeline: cap row count so cells don't drop below 1px tall.
  // 200 rows is comfortable at typical chart heights (~200-300px usable),
  // and the 1px-per-row banding that 10k rows produced becomes solid bars.
  // Track which original indices we kept so per-row metadata (labels,
  // swatch colors, per-row gradient colors) stays in lockstep with the
  // sampled rows. Previously `rowLabels` had its own re-stride loop using
  // `props.steps.findIndex(...)` while `perRowColors` and
  // `rowLabelSwatchColors` were indexed by the post-sample `row` —
  // misaligning them whenever sampling actually trimmed.
  const { sampled, originalIndices } = sampleCategoricalStepsWithIndices(
    props.steps,
    CATEGORICAL_LAYOUT.maxHeatmapRows,
  );
  const steps = sampled;
  const { width, height, baseColor, theme } = props;
  const stepsOnX = props.stepsOnX === true;
  if (steps.length === 0) return;
  const { leftMargin, rightMargin, topMargin, rightGutter } = RIDGELINE_LAYOUT;
  const labelsForRotation = steps[0]?.bars.labels ?? [];
  // Transposed: bottom-axis labels are short step numbers — slim margin.
  // Non-transposed: bin labels go on bottom, so use the rotation-aware sizer.
  const bottomMargin = stepsOnX
    ? RIDGELINE_LAYOUT.bottomMargin
    : categoricalBottomMargin(labelsForRotation.length);
  // Slim gutter for short step-number labels; full leftMargin only
  // when run-name labels are present. Matches drawCategoricalRidgeline
  // and computeCategoricalGeometry.
  ctx.clearRect(0, 0, width, height);

  // Left gutter: bin labels (transposed) get 120px; run-name rowLabels
  // get 150px (longer text); short step-number labels (non-transposed
  // default) use the slim rightGutter width.
  const xLeft = stepsOnX
    ? Math.max(leftMargin, 120)
    : props.rowLabels
      ? Math.max(leftMargin, 150)
      : rightGutter;
  // Right edge: in transposed mode we widen the right pad to ~16px so
  // it matches uPlot's typical label-overflow space and a sibling line
  // chart's plot end (when chart-widget threads the same value into
  // extraRightPadding). In non-transposed mode keep the slim default
  // and let `rotatedLabelRightBuffer` size for the rightmost rotated
  // bin label.
  const stepsOnXRightMargin = 44;
  // Halve the rotated-label overflow estimate when category labels go
  // diagonal — the rightmost label's bottom-right tail spills into the
  // ColorLegendOverlay's right gutter (legend sits in the TOP half, so
  // no visual collision with the descending labels). Without halving,
  // the chart visibly shrinks past the 8→9 category boundary.
  const xRight = stepsOnX
    ? width - stepsOnXRightMargin
    : width -
      rightMargin -
      Math.floor(rotatedLabelRightBuffer(labelsForRotation) / 2);
  const yTop = topMargin;
  const yBottom = height - bottomMargin;
  if (xRight - xLeft <= 0 || yBottom - yTop <= 0) return;

  const labels = steps[0]?.bars.labels ?? [];
  const numBins = labels.length;
  if (numBins === 0) return;

  const globalMaxFreq = props.globalMaxFreq ?? computeCategoricalGlobalMaxFreq(steps);
  const safeMax = globalMaxFreq > 0 ? globalMaxFreq : 1;
  // Swap dimensions when transposed: columns are steps, rows are bins.
  const cellW = stepsOnX
    ? (xRight - xLeft) / steps.length
    : (xRight - xLeft) / numBins;
  const cellH = stepsOnX
    ? (yBottom - yTop) / numBins
    : (yBottom - yTop) / steps.length;

  // High-end color = the run's IDENTITY baseColor verbatim. Was running
  // through ridgeColor() before, which applies a -30° hue shift designed
  // for the step-axis ramp — that pushed purple bases toward blue, so a
  // purple-dot run got a bluish heatmap.
  const highColor = baseColor;
  // Theme-keyed low end matches each theme's background so empty/low-
  // density cells blend in: black on dark, white on light.
  const lowColor = theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)";

  // Per-row high color: when provided (depth=run mode), each row uses
  // its own ramp keyed to that run's IDENTITY color verbatim. We don't
  // route through ridgeColor() here because that helper applies a hue
  // shift designed for the step-axis ramp — for an orange run it'd
  // push the high-end into bright red, breaking the identity mapping
  // (legend dot orange, row bright red — visually disconnected).
  const perRowHighColors = props.perRowColors ?? null;

  if (stepsOnX) {
    // Transposed loop: outer = bin row (Y), inner = step column (X).
    // perRowColors / rowLabelSwatchColors don't apply here — they were
    // keyed to per-step or per-run identity in the non-transposed view.
    for (let binRow = 0; binRow < numBins; binRow++) {
      for (let stepCol = 0; stepCol < steps.length; stepCol++) {
        const f = steps[stepCol].bars.freq[binRow] ?? 0;
        const t = Math.max(0, Math.min(1, f / safeMax));
        ctx.fillStyle = mixColors(lowColor, highColor, t);
        ctx.fillRect(
          xLeft + stepCol * cellW,
          yTop + binRow * cellH,
          cellW + 0.5,
          cellH + 0.5,
        );
      }
    }
  } else {
    for (let row = 0; row < steps.length; row++) {
      const { freq } = steps[row].bars;
      // Index per-row gradient color by the ORIGINAL row index — keeps the
      // run's identity color on its own row after sampling.
      const origRow = originalIndices[row] ?? row;
      const rowHighColor = perRowHighColors?.[origRow] ?? highColor;
      for (let col = 0; col < numBins; col++) {
        const f = freq[col] ?? 0;
        // Clamp t to [0, 1]: negative values render as the low color
        // (same as zero), since a single-color heatmap can't depict
        // a signed scale. Use Step mode for signed bin data.
        const t = Math.max(0, Math.min(1, f / safeMax));
        // No more special case for t=0 — letting it fall through the
        // gradient (which gives nearly-the-low-color) avoids the jarring
        // black/colored binary look. Sub-1% counts now read as "very
        // faint" instead of "missing", which is the correct read for
        // tail subdatasets that happen to draw 0 samples at some step.
        ctx.fillStyle = mixColors(lowColor, rowHighColor, t);
        ctx.fillRect(xLeft + col * cellW, yTop + row * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  const axisColor = theme === "dark" ? "#94a3b8" : "#666";
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xLeft, yBottom);
  ctx.lineTo(xRight, yBottom);
  ctx.stroke();

  if (stepsOnX) {
    // Transposed bottom-axis: numeric step ticks across the X span.
    // Sample stride-thinned so the labels don't overlap at 200 cols.
    drawTransposedStepTicks(
      ctx,
      steps,
      xLeft,
      xRight,
      yBottom,
      cellW,
      axisColor,
    );
  } else {
    drawCategoricalAxisLabels(ctx, labels, xLeft, xRight, yBottom, axisColor);
  }

  // Row labels (LEFT gutter).
  //   stepsOnX: ALL bin labels (the rows are bins now), stride-thinned
  //     when cellH gets small. SKIPPED entirely when numBins exceeds
  //     X_AXIS_LABEL_LIMIT — same rule the non-transposed bottom axis
  //     uses for bin labels. At that density even stride-thinned
  //     labels overlap, so the user identifies bins via hover.
  //   non-transposed: step number by default, or rowLabels[i].
  // Right-aligned to xLeft-4 so the labels hug the chart edge. Swatch
  // (when present) is positioned immediately left of its text via
  // measureText so adjacency holds across varying label widths.
  const skipLabels = stepsOnX && numBins > X_AXIS_LABEL_LIMIT;
  ctx.fillStyle = axisColor;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const minSpacing = RIDGELINE_LAYOUT.minStepLabelSpacingPx;
  const stride = Math.max(1, Math.ceil(minSpacing / Math.max(cellH, 0.0001)));
  const rowLabelMaxChars =
    stepsOnX
      ? 18
      : props.rowLabels
        ? 22
        : CATEGORICAL_LAYOUT.maxLabelChars;
  const textRightX = xLeft - 4;
  const swatchSize = 8;
  const swatchGap = 4;
  const numRowsForLabels = stepsOnX ? numBins : steps.length;
  for (let row = 0; row < numRowsForLabels && !skipLabels; row++) {
    if (row % stride !== 0 && row !== numRowsForLabels - 1) continue;
    const y = yTop + row * cellH + cellH / 2;
    if (stepsOnX) {
      const text = truncateLabel(labels[row] ?? "", rowLabelMaxChars);
      ctx.fillText(text, textRightX, y);
      continue;
    }
    // Index labels + swatches by the ORIGINAL row index so sampling
    // doesn't slide labels/colors off their rows. Falls back to the
    // sampled step's own .step value when no rowLabels override is
    // provided.
    const origRow = originalIndices[row] ?? row;
    const label = props.rowLabels?.[origRow] ?? formatNumber(steps[row].step, true);
    const text = truncateLabel(label, rowLabelMaxChars);
    const swatch = props.rowLabelSwatchColors?.[origRow];
    if (swatch) {
      const textW = ctx.measureText(text).width;
      const swatchX = textRightX - textW - swatchGap - swatchSize;
      ctx.fillStyle = swatch;
      ctx.fillRect(swatchX, y - swatchSize / 2, swatchSize, swatchSize);
      ctx.fillStyle = axisColor;
    }
    ctx.fillText(text, textRightX, y);
  }
}

// Draw step-number ticks on the bottom axis for transposed
// (steps-on-X) ridgeline + heatmap. Uses generateNiceNumbers (same
// helper uPlot-style numeric axes use elsewhere) so tick values land
// on round numbers like 0, 1k, 2k, 3k — matching the labels the line
// chart above renders. Each tick is positioned at the INTERPOLATED X
// pixel for its step value (not snapped to a sampled-column center),
// so the leftmost (minStep) and rightmost (maxStep) ticks land at
// xLeft and xRight respectively. That's what "ends line up" needs.
function drawTransposedStepTicks(
  ctx: CanvasRenderingContext2D,
  steps: CategoricalStep[],
  xLeft: number,
  xRight: number,
  axisY: number,
  _cellW: number,
  axisColor: string,
): void {
  const n = steps.length;
  if (n === 0) return;
  const minStep = steps[0].step;
  const maxStep = steps[n - 1].step;
  const range = maxStep - minStep;
  if (range <= 0) return;
  ctx.save();
  ctx.fillStyle = axisColor;
  ctx.strokeStyle = axisColor;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // Pick ~5 nice round step values across the range. Filter to ones
  // that fit inside [minStep, maxStep] so we don't get phantom ticks
  // floating past the data ends.
  const niceTicks = generateNiceNumbers(minStep, maxStep, 6).filter(
    (t) => t >= minStep && t <= maxStep,
  );
  // Always anchor the extremes so the ends visually line up with the
  // line chart's leftmost (step 0) and rightmost data points.
  const ticks = new Set<number>(niceTicks);
  ticks.add(minStep);
  ticks.add(maxStep);
  const sortedTicks = Array.from(ticks).sort((a, b) => a - b);
  for (const tick of sortedTicks) {
    const cx = xLeft + ((tick - minStep) / range) * (xRight - xLeft);
    ctx.beginPath();
    ctx.moveTo(cx, axisY);
    ctx.lineTo(cx, axisY + TICK_CONFIG.TICK_LENGTH);
    ctx.stroke();
    // Right-align the LAST tick so its text ends at xRight rather than
    // overhanging into the rightMargin gutter where the X axis-title
    // overlay ("step") sits. All other ticks stay centered.
    const isLast = tick === maxStep;
    ctx.textAlign = isLast ? "right" : "center";
    ctx.fillText(
      formatNumber(tick, true),
      cx,
      axisY + TICK_CONFIG.TICK_LENGTH + 2,
    );
  }
  ctx.textAlign = "center";
  ctx.restore();
}

// Parse any CSS color string we expect to see (hex, rgb/rgba, hsl/hsla)
// into normalized RGB components [0-255]. Returns null if the string
// doesn't match any known format. Reused by mixColors() so the heatmap
// can lerp between hex run colors and an rgba/black low color — the
// previous implementation only handled rgb+rgb or hex-less inputs, so
// hex run colors (`#fbbf24`) would fall through both branches and the
// function would return `high` unchanged → solid-color heatmap rows.
export function colorToRgb(input: string): [number, number, number] | null {
  const s = input.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) {
      h = h.split("").map((c) => c + c).join("");
    }
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return [r, g, b];
  }
  const rgbMatch = s.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((v) => parseFloat(v.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((v) => !Number.isNaN(v))) {
      return [Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2])];
    }
  }
  // Accept signed hue (the leading sign + optional decimals). ridgeColor
  // produces things like "hsl(-16.00, …)" when the run color's hue is
  // ≤ 29° (red/orange palette entries) and t=1, since it subtracts 30
  // from the base hue for the high end of the ramp. Without the `-?`
  // allowance, the regex previously failed → colorToRgb returned null →
  // mixColors silently fell back to `high` → every heatmap cell rendered
  // saturated (the visible bug for red/orange runs). Saturation and
  // lightness stay non-negative by construction so they don't need it.
  const hslMatch = s.match(/hsla?\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?/i);
  if (hslMatch) {
    const rawH = parseFloat(hslMatch[1]);
    const sat = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    if ([rawH, sat, l].some((v) => Number.isNaN(v))) return null;
    // Normalize hue to [0, 1) so wraparound works regardless of how
    // far negative or positive the input is. JS `%` keeps sign, so
    // we add 1 then mod again to land in the positive range.
    const h = (((rawH / 360) % 1) + 1) % 1;
    const hueToRgb = (p: number, q: number, t: number) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    let r: number, g: number, b: number;
    if (sat === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
      const p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  return null;
}

// Linear-interpolate between `low` and `high` colors. When either side
// can't be parsed (defensive — the parser now handles signed-hue HSL,
// hex, rgb, rgba), interpolate in canvas-CSS space instead of silently
// returning `high`: the old bail-out made bugs invisible (every cell
// looked like the saturated end), so callers couldn't tell the lerp
// was inactive. Falling through to t-based selection still produces a
// gradient effect, AND we log a one-time warning so future palette/
// helper additions that emit unparseable formats surface immediately.
const colorParseWarned = new Set<string>();
function warnUnparseableColor(s: string) {
  if (colorParseWarned.has(s)) return;
  colorParseWarned.add(s);
  console.warn(`[categorical-canvas] mixColors: unparseable color "${s}"`);
}

export function mixColors(low: string, high: string, t: number): string {
  const a = colorToRgb(low);
  const b = colorToRgb(high);
  if (a && b) {
    const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `rgba(${lerp(a[0], b[0])},${lerp(a[1], b[1])},${lerp(a[2], b[2])},1)`;
  }
  if (!a) warnUnparseableColor(low);
  if (!b) warnUnparseableColor(high);
  return t < 0.5 ? low : high;
}
