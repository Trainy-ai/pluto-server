import type uPlot from "uplot";
import type { LineData } from "../line-uplot";

// ============================
// Non-Finite Markers Draw Plugin
// ============================
//
// Draws visual markers on the chart for non-finite values:
//   △ Red upward triangle at chart top    — +Infinity
//   ▽ Green downward triangle at chart bottom — -Infinity
//   ⊗ Gold circle-cross on the line       — NaN in aggregation bucket

export interface NonFiniteMarkersOpts {
  /** All chart series including envelopes/hidden */
  lines: LineData[];
  theme: string;
}

/** Size of the triangle/circle markers in CSS pixels */
const MARKER_SIZE = 14;
/** Vertical offset from chart edge for Inf markers */
const EDGE_OFFSET = 20;

/**
 * Draw an upward-pointing triangle (△) at the given canvas coords.
 */
function drawUpTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  strokeColor: string,
) {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);          // top
  ctx.lineTo(cx + half, cy + half);   // bottom-right
  ctx.lineTo(cx - half, cy + half);   // bottom-left
  ctx.closePath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = strokeColor;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

/**
 * Draw a downward-pointing triangle (▽) at the given canvas coords.
 */
function drawDownTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  strokeColor: string,
) {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + half);          // bottom
  ctx.lineTo(cx + half, cy - half);   // top-right
  ctx.lineTo(cx - half, cy - half);   // top-left
  ctx.closePath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = strokeColor;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

/**
 * Draw a circle-cross (⊗) at the given canvas coords.
 */
function drawCircleCross(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  strokeColor: string,
) {
  const r = size / 2;
  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = strokeColor;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  // Cross (×)
  const d = r * 0.7; // cross arm length
  ctx.beginPath();
  ctx.moveTo(cx - d, cy - d);
  ctx.lineTo(cx + d, cy + d);
  ctx.moveTo(cx + d, cy - d);
  ctx.lineTo(cx - d, cy + d);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.0;
  ctx.stroke();
}

/**
 * uPlot plugin that draws non-finite value markers on the chart.
 *
 * For each visible (non-hidden) series that has `nonFiniteMarkers` or `valueFlags`:
 *   - +Inf: red △ pinned near the top of the chart
 *   - -Inf: green ▽ pinned near the bottom of the chart
 *   - NaN:  gold ⊗ on the line at the bucket's x position
 *
 * The markers use the series' color for better visual association.
 */
export function nonFiniteMarkersPlugin(opts: NonFiniteMarkersOpts): uPlot.Plugin {
  const { lines } = opts;

  function draw(u: uPlot) {
    const ctx = u.ctx;
    const { left, top, width, height } = u.bbox;

    // Device pixel ratio for crisp rendering
    const dpr = devicePixelRatio || 1;
    const markerSize = MARKER_SIZE * dpr;
    const edgeOffset = EDGE_OFFSET * dpr;

    ctx.save();

    // Clip to plot area
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    const xData = u.data[0] as number[];

    for (let si = 1; si < u.series.length; si++) {
      const series = u.series[si];
      if (series.show === false) continue;

      const lineData = lines[si - 1];
      if (!lineData || lineData.hideFromLegend) continue;

      // Determine color: use series color, fallback to default
      const seriesColor = lineData.color || "#888";

      // Colors for different marker types — use series color for Inf markers
      const infColor = seriesColor;
      const negInfColor = seriesColor;
      const nanColor = "#d4a017"; // gold for NaN

      // --- Handle bucketed non-finite markers ---
      if (lineData.nonFiniteMarkers && lineData.nonFiniteMarkers.size > 0) {
        for (const [xVal, flags] of lineData.nonFiniteMarkers) {
          const xIdx = xData.indexOf(xVal);
          if (xIdx < 0) continue;

          const cx = Math.round(u.valToPos(xVal, "x", true));
          // Skip if outside visible area
          if (cx < left || cx > left + width) continue;

          if (flags.has("Inf")) {
            drawUpTriangle(ctx, cx, top + edgeOffset, markerSize, infColor);
          }
          if (flags.has("-Inf")) {
            drawDownTriangle(ctx, cx, top + height - edgeOffset, markerSize, negInfColor);
          }
          if (flags.has("NaN")) {
            // Pin NaN markers near the bottom to avoid visual noise on the curve
            drawCircleCross(ctx, cx, top + height - edgeOffset, markerSize, nanColor);
          }
        }
      }

      // --- Handle raw (non-bucketed) value flags ---
      if (lineData.valueFlags && lineData.valueFlags.size > 0) {
        for (const [xVal, flag] of lineData.valueFlags) {
          const cx = Math.round(u.valToPos(xVal, "x", true));
          if (cx < left || cx > left + width) continue;

          if (flag === "Inf") {
            drawUpTriangle(ctx, cx, top + edgeOffset, markerSize, infColor);
          } else if (flag === "-Inf") {
            drawDownTriangle(ctx, cx, top + height - edgeOffset, markerSize, negInfColor);
          } else if (flag === "NaN") {
            // Pin NaN markers near the bottom to avoid visual noise on the curve
            drawCircleCross(ctx, cx, top + height - edgeOffset, markerSize, nanColor);
          }
        }
      }
    }

    ctx.restore();
  }

  return {
    hooks: {
      draw,
    },
  };
}
