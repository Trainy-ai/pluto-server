import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { applyAlpha } from "@/lib/math/color-alpha";
import { formatAxisLabel } from "./format";

// ============================
// Series Configuration — Builder + Emphasis Logic
// ============================

export interface SeriesConfigRefs {
  /** Last locally-focused series index (from Y-distance detection) */
  lastFocusedSeriesRef: { current: number | null };
  /** Cross-chart highlighted series label (from another chart) */
  crossChartHighlightRef: { current: string | null };
  /** Table-driven highlighted series ID (from runs table hover) */
  tableHighlightRef: { current: string | null };
}

/**
 * Build uPlot series configuration array from processedLines.
 * Each series gets a dynamic stroke function that handles 3-tier emphasis:
 *   local chart hover > cross-chart hover > table row hover
 */
export function buildSeriesConfig(
  processedLines: LineData[],
  xlabel: string | undefined,
  chartLineWidth: number,
  refs: SeriesConfigRefs,
): uPlot.Series[] {
  // Build a mapping from smoothed series to their "(original)" companion
  // so the legend can show combined values like the tooltip: "value (rawValue)"
  const companionDataIdx = new Map<number, number>();
  for (let i = 0; i < processedLines.length; i++) {
    if (!processedLines[i].hideFromLegend && processedLines[i + 1]?.hideFromLegend) {
      // i+2 because uPlot data index 0 is x-axis, so line index i maps to data index i+1
      companionDataIdx.set(i, i + 2);
    }
  }

  return [
    {
      // X axis
      label: xlabel || "x",
    },
    ...processedLines.map((line, i) => {
      // Envelope boundary series — invisible lines, only used for band fill
      if (line.envelopeOf) {
        return {
          label: line.label,
          _seriesId: line.seriesId ?? line.label,
          stroke: "transparent",
          width: 0,
          points: { show: false },
          spanGaps: true,
          value: () => "",
        };
      }

      // Check if this series has only a single point - need to show as dot since lines need 2+ points
      const isSinglePoint = line.x.length === 1;
      const baseColor = line.color || `hsl(${(i * 137) % 360}, 70%, 50%)`;

      return {
        label: line.label,
        _seriesId: line.seriesId ?? line.label,
        // Use a function for stroke that checks both local and cross-chart focus
        // and applies per-series opacity (used by smoothing to dim raw data)
        stroke: (u: uPlot, seriesIdx: number) => {
          const localFocusIdx = refs.lastFocusedSeriesRef.current;
          const crossChartLabel = refs.crossChartHighlightRef.current;
          const tableId = refs.tableHighlightRef.current;
          const thisSeriesLabel = u.series[seriesIdx]?.label;
          const thisSeriesId = (u.series[seriesIdx] as any)?._seriesId;
          const lineOpacity = line.opacity ?? 1;

          // Determine if this series should be highlighted
          // Priority: local chart hover > cross-chart hover > table row hover
          let isHighlighted = false;
          let highlightedLabel: string | null = null;

          if (localFocusIdx !== null) {
            // Local focus takes priority (this chart is being hovered)
            isHighlighted = seriesIdx === localFocusIdx;
            highlightedLabel = typeof u.series[localFocusIdx]?.label === "string"
              ? (u.series[localFocusIdx].label as string) : null;
          } else if (crossChartLabel !== null) {
            // Cross-chart highlight (another chart is being hovered)
            isHighlighted = thisSeriesLabel === crossChartLabel;
            highlightedLabel = crossChartLabel;
          } else if (tableId !== null) {
            // Table row hover highlight - match by runId prefix to handle composite "runId:metric" seriesIds
            isHighlighted = thisSeriesId === tableId || (!!thisSeriesId && thisSeriesId.startsWith(tableId + ':'));
          }

          const isFocusActive =
            localFocusIdx !== null || crossChartLabel !== null || tableId !== null;

          // Check if this is the raw/original companion of the highlighted series
          const isRawOfHighlighted = isFocusActive && !isHighlighted &&
            line.hideFromLegend &&
            typeof thisSeriesLabel === "string" &&
            thisSeriesLabel.endsWith(" (original)") &&
            highlightedLabel !== null &&
            thisSeriesLabel === highlightedLabel + " (original)";

          if (!isFocusActive || isHighlighted) {
            return lineOpacity < 1
              ? applyAlpha(baseColor, lineOpacity)
              : baseColor;
          }
          // Slightly boost raw companion of emphasized series
          if (isRawOfHighlighted) {
            return applyAlpha(baseColor, Math.min(lineOpacity * 2.5, 0.35));
          }
          // Dim unfocused series: combine line opacity with focus dimming
          return applyAlpha(baseColor, lineOpacity * 0.05);
        },
        width: chartLineWidth,
        dash: line.dash,
        spanGaps: true,
        points: {
          // Show points for single-point series since lines need 2+ points to be visible
          show: isSinglePoint,
          size: isSinglePoint ? 10 : 6,
          fill: (line.opacity ?? 1) < 1
            ? applyAlpha(baseColor, line.opacity!)
            : baseColor,
        },
        // Legend value formatter: combine smoothed + original values like the tooltip
        value: companionDataIdx.has(i)
          ? (u: uPlot, val: number | null, _si: number, idx: number | null) => {
              if (val == null || idx == null) return "--";
              const rawVal = u.data[companionDataIdx.get(i)!]?.[idx] as number | null;
              if (rawVal != null) {
                return `${formatAxisLabel(val)} (${formatAxisLabel(rawVal)})`;
              }
              return formatAxisLabel(val);
            }
          : ((_u: uPlot, val: number | null) => {
              return val == null ? "--" : formatAxisLabel(val);
            }),
      };
    }),
  ];
}
