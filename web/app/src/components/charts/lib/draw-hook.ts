import uPlot from "uplot";
import type { LineData } from "./types";

/**
 * Build a uPlot draw hook that re-strokes highlighted series on top
 * so they aren't obscured by later-indexed series.
 *
 * uPlot draws series in array order; this hook fires after ALL series are drawn.
 * It reads from both refs and chart instance (imperative path sets instance values first).
 */
export function buildDrawHook(
  processedLinesRef: React.RefObject<LineData[]>,
  lastFocusedSeriesRef: React.RefObject<number | null>,
  crossChartRunIdRef: React.RefObject<string | null>,
  tableHighlightRef: React.RefObject<string | null>,
  chartLineWidthRef: React.RefObject<number>,
  theme: string | undefined,
): (u: uPlot) => void {
  return (u: uPlot) => {
    const localFocusIdx = (u as any)._lastFocusedSeriesIdx !== undefined
      ? (u as any)._lastFocusedSeriesIdx
      : lastFocusedSeriesRef.current;
    const crossChartRunId = crossChartRunIdRef.current ?? (u as any)._crossHighlightRunId ?? null;
    const tableId = tableHighlightRef.current;

    if (localFocusIdx === null && crossChartRunId === null && tableId === null) return;

    // Collect highlighted series indices — only primary visible curves
    // (skip envelope boundaries and raw/original companions)
    const highlightedIndices: number[] = [];
    for (let si = 1; si < u.series.length; si++) {
      if (!u.series[si].show) continue;
      const lineData = processedLinesRef.current[si - 1];
      if (lineData?.envelopeOf || lineData?.hideFromLegend) continue;
      if (localFocusIdx !== null) {
        if (si === localFocusIdx) highlightedIndices.push(si);
      } else {
        const seriesId = (u.series[si] as any)?._seriesId;
        const matchId = crossChartRunId ?? tableId;
        if (seriesId === matchId || (seriesId && seriesId.startsWith(matchId + ':'))) {
          highlightedIndices.push(si);
        }
      }
    }
    if (highlightedIndices.length === 0) return;

    const ctx = u.ctx;
    const { left, top, width: bboxW, height: bboxH } = u.bbox;

    // Unified outline for all emphasis types (local, cross-chart, table hover)
    // Outline width scales with the user's line width setting
    const outlineColor = theme === "dark" ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.45)";
    const lw = chartLineWidthRef.current;
    const outlineExtra = Math.max(2, lw * 1.5) * devicePixelRatio;

    for (const si of highlightedIndices) {
      const s = u.series[si];
      const paths = (s as any)._paths;
      if (!paths?.stroke) continue;

      const lineWidth = Math.round((s.width ?? 1.5) * devicePixelRatio * 1000) / 1000;
      const outlineWidth = lineWidth + outlineExtra;
      const offset = (lineWidth % 2) / 2;

      // --- Pass 1: Dark outline (wider, behind) ---
      ctx.save();
      const outClip = new Path2D();
      outClip.rect(left - outlineWidth / 2, top - outlineWidth / 2, bboxW + outlineWidth, bboxH + outlineWidth);
      ctx.clip(outClip);
      if (paths.clip) ctx.clip(paths.clip);
      if (offset > 0) ctx.translate(offset, offset);
      ctx.lineWidth = outlineWidth;
      ctx.strokeStyle = outlineColor;
      ctx.lineJoin = 'round';
      ctx.lineCap = ((s as any).cap ?? 'butt') as CanvasLineCap;
      if (s.dash) ctx.setLineDash(s.dash.map((v: number) => v * devicePixelRatio));
      ctx.stroke(paths.stroke);
      if (offset > 0) ctx.translate(-offset, -offset);
      ctx.restore();

      // --- Pass 2: Colored stroke on top ---
      ctx.save();
      const boundsClip = new Path2D();
      boundsClip.rect(left - lineWidth / 2, top - lineWidth / 2, bboxW + lineWidth, bboxH + lineWidth);
      ctx.clip(boundsClip);
      if (paths.clip) ctx.clip(paths.clip);
      if (offset > 0) ctx.translate(offset, offset);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = typeof s.stroke === 'function' ? s.stroke(u, si) : (s.stroke as string);
      ctx.lineJoin = 'round';
      ctx.lineCap = ((s as any).cap ?? 'butt') as CanvasLineCap;
      if (s.dash) ctx.setLineDash(s.dash.map((v: number) => v * devicePixelRatio));
      ctx.stroke(paths.stroke);
      if (offset > 0) ctx.translate(-offset, -offset);
      ctx.restore();
    }
  };
}
