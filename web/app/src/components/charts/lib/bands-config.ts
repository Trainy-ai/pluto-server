import uPlot from "uplot";
import { applyAlpha } from "@/lib/math/color-alpha";
import type { LineData } from "./types";

/**
 * Build uPlot bands configuration for min/max envelope rendering.
 *
 * Detects envelope companion series and creates fill between min/max pairs.
 * Dashed series get a more prominent envelope fill (Neptune-style: the
 * auto-smoothed trend line sits on top of a visible data-range band).
 *
 * Band fill is dynamic: dims bands for non-highlighted runs during emphasis.
 */
export function buildBandsConfig(
  processedLines: LineData[],
  lastFocusedSeriesRef: React.RefObject<number | null>,
  crossChartRunIdRef: React.RefObject<string | null>,
  tableHighlightRef: React.RefObject<string | null>,
): uPlot.Band[] {
  const bands: uPlot.Band[] = [];
  const envelopePairs = new Map<string, { minIdx?: number; maxIdx?: number; color?: string; parentLabel?: string }>();

  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i];
    if (line.envelopeOf && line.envelopeBound) {
      const key = line.envelopeOf;
      if (!envelopePairs.has(key)) {
        envelopePairs.set(key, { parentLabel: key });
      }
      const pair = envelopePairs.get(key)!;
      // uPlot series index = line index + 1 (index 0 is x-axis)
      if (line.envelopeBound === "min") {
        pair.minIdx = i + 1;
      } else {
        pair.maxIdx = i + 1;
      }
      pair.color = line.color;
    }
  }

  for (const [, pair] of envelopePairs) {
    if (pair.minIdx != null && pair.maxIdx != null) {
      // Check if the parent series is dashed — use higher fill opacity
      // so the data range band is clearly visible behind the smooth trend line
      const parentLine = processedLines.find(
        (l) => l.label === pair.parentLabel && !l.envelopeOf,
      );
      const isDashedParent = !!parentLine?.dash;
      const baseAlpha = isDashedParent ? 0.22 : 0.15;
      // Use the parent line's color for the band fill so it matches the curve
      const bandColor = parentLine?.color || pair.color || "#888";
      // Get the parent series' seriesId and run ID for emphasis matching
      const envSeriesId = processedLines[pair.minIdx - 1]?.seriesId;
      const envRunId = envSeriesId ? envSeriesId.split(':')[0] : null;
      const parentSeriesId = parentLine?.seriesId ?? null;

      bands.push({
        series: [pair.maxIdx, pair.minIdx],
        // Dynamic fill: dim bands for non-highlighted runs during emphasis
        fill: (u: uPlot) => {
          const localFocus = (u as any)._lastFocusedSeriesIdx !== undefined
            ? (u as any)._lastFocusedSeriesIdx
            : lastFocusedSeriesRef.current;
          const crossId = crossChartRunIdRef.current ?? (u as any)._crossHighlightRunId ?? null;
          const tableId = tableHighlightRef.current;
          const activeId = crossId ?? tableId;

          // No emphasis active — show bands at default alpha
          if (localFocus === null && activeId === null) {
            return applyAlpha(bandColor, baseAlpha);
          }

          // For local focus, match the specific series (not just run) so that
          // hovering one metric only highlights that metric's envelope band,
          // not all envelopes from the same run.
          if (localFocus !== null) {
            const focusedId = (u.series[localFocus] as any)?._seriesId;
            if (focusedId === parentSeriesId) {
              return applyAlpha(bandColor, baseAlpha);
            }
            return applyAlpha(bandColor, baseAlpha * 0.15);
          }

          // For cross-chart / table emphasis, match by run ID (highlight all
          // metrics from the hovered run since the user is selecting a run)
          if (activeId === envRunId) {
            return applyAlpha(bandColor, baseAlpha);
          }
          return applyAlpha(bandColor, baseAlpha * 0.15);
        },
      });
    }
  }

  return bands;
}
