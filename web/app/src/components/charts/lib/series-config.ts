import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { applyAlpha } from "@/lib/math/color-alpha";
import { formatAxisLabel } from "./format";

// ============================
// Series Configuration — Builder + Emphasis Logic
// ============================

// Min/Max are NOT shown in the FS sidebar legend — they live only in the
// tooltip popover where the user can opt them in. The legend stays compact
// (value, optionally raw) so run names always have room.

export interface SeriesConfigRefs {
  /** Last locally-focused series index (from Y-distance detection) */
  lastFocusedSeriesRef: { current: number | null };
  /** Cross-chart highlighted run ID (from another chart's hovered series) */
  crossChartRunIdRef: { current: string | null };
  /** Table-driven highlighted series ID (from runs table hover) */
  tableHighlightRef: { current: string | null };
  /** Experiment run ID lookup: runId → all runIds in same experiment. Null when not in experiments mode. */
  experimentRunIdsMapRef?: { current: Map<string, string[]> | null };
}

// ============================
// Series Config Builder
// ============================

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
  options?: { spanGaps?: boolean; theme?: "light" | "dark"; xLegendValue?: (u: uPlot, val: number | null) => string },
): uPlot.Series[] {
  const spanGaps = options?.spanGaps ?? true;
  const isDark = options?.theme === "dark";

  // For each visible main series, locate its smoothing-companion data
  // index (the (original) raw line). Envelope min/max are intentionally
  // NOT consulted by the legend formatter — they live only in the
  // tooltip popover.
  // uPlot data index = processedLines index + 1 (data[0] is the x-axis).
  const companionRawIdx = new Map<number, number>();
  for (let i = 0; i < processedLines.length; i++) {
    const main = processedLines[i];
    if (main.hideFromLegend) continue;
    for (let j = i + 1; j < processedLines.length; j++) {
      const cand = processedLines[j];
      if (!cand.hideFromLegend) break; // hit the next main; companions are contiguous
      if (cand.label === main.label + " (original)") {
        companionRawIdx.set(i, j + 1);
      }
    }
  }

  return [
    {
      // X axis — format legend value to match the axis type
      label: xlabel || "x",
      ...(options?.xLegendValue ? { value: options.xLegendValue } : {}),
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
          spanGaps,
          value: () => "",
        };
      }

      // Check if this series has only a single point - need to show as dot since lines need 2+ points
      const isSinglePoint = line.x.length === 1;
      const baseColor = line.color || `hsl(${(i * 137) % 360}, 70%, 50%)`;

      return {
        label: line.runId || line.runName || line.label,
        _seriesId: line.seriesId ?? line.label,
        // Tag for the FS sidebar header: signals whether this series has a
        // smoothing companion so the header can include "Raw Value".
        _hasOriginal: companionRawIdx.has(i),
        // Use a function for stroke that checks both local and cross-chart focus
        // and applies per-series opacity (used by smoothing to dim raw data)
        stroke: (u: uPlot, seriesIdx: number) => {
          // Read from refs (updated by React effects) with fallback to chart instance
          // (updated synchronously by the imperative cross-chart path in chart-sync-context)
          const localFocusIdx = (u as any)._lastFocusedSeriesIdx !== undefined
            ? (u as any)._lastFocusedSeriesIdx
            : refs.lastFocusedSeriesRef.current;
          const crossChartRunId = refs.crossChartRunIdRef.current ?? (u as any)._crossHighlightRunId ?? null;
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
            // In experiments mode, highlight all series in the same experiment
            const localExpMap: Map<string, string[]> | null = refs.experimentRunIdsMapRef?.current ?? null;
            if (localExpMap) {
              const focusedSid = (u.series[localFocusIdx] as any)?._seriesId;
              const focusedRunId = focusedSid?.split(':')[0];
              const expIds = focusedRunId ? (localExpMap.get(focusedRunId) ?? null) : null;
              if (expIds) {
                isHighlighted = expIds.some((rid: string) =>
                  thisSeriesId === rid || (!!thisSeriesId && thisSeriesId.startsWith(rid + ':'))
                );
              } else {
                isHighlighted = seriesIdx === localFocusIdx;
              }
            } else {
              isHighlighted = seriesIdx === localFocusIdx;
            }
            highlightedLabel = typeof u.series[localFocusIdx]?.label === "string"
              ? (u.series[localFocusIdx].label as string) : null;
          } else if (crossChartRunId !== null) {
            // Cross-chart highlight (another chart is being hovered)
            // In experiments mode, _crossHighlightRunIds contains all run IDs for the experiment
            const crossRunIds: string[] = (u as any)._crossHighlightRunIds ?? [crossChartRunId];
            isHighlighted = crossRunIds.some((rid: string) =>
              thisSeriesId === rid || (!!thisSeriesId && thisSeriesId.startsWith(rid + ':'))
            );
            // Multiple series can match — don't set highlightedLabel (raw companions get standard dim)
            highlightedLabel = null;
          } else if (tableId !== null) {
            // Table row hover highlight - match by runId prefix to handle composite "runId:metric" seriesIds
            // In experiments mode, _tableHighlightRunIds contains all run IDs for the experiment
            const tableRunIds: string[] = (u as any)._tableHighlightRunIds ?? [tableId];
            isHighlighted = tableRunIds.some((id: string) =>
              thisSeriesId === id || (!!thisSeriesId && thisSeriesId.startsWith(id + ':'))
            );
          }

          const isFocusActive =
            localFocusIdx !== null || crossChartRunId !== null || tableId !== null;

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
          // Dim unfocused series so the highlighted curve pops clearly.
          const dimAlpha = isDark ? 0.25 : 0.2;
          return applyAlpha(baseColor, lineOpacity * dimAlpha);
        },
        // Differentiate line widths:
        // - Dashed series: slightly thicker for dash visibility
        // - Smoothed series with companion: thicker for emphasis over raw cloud
        // - Raw companion: thinner to reduce visual noise
        ...(() => {
          const w = line.hideFromLegend
            ? chartLineWidth * 0.5
            : !!line.dash
              ? Math.max(chartLineWidth * 1.3, 1.8)
              : companionRawIdx.has(i)
                ? chartLineWidth * 1.5
                : chartLineWidth;
          return { width: w, _baseWidth: w };
        })(),
        // Canvas setLineDash() with round caps. Round caps extend each dash
        // by lineWidth/2 per end, so compensate the pattern values to keep
        // the visual dash/gap sizes constant regardless of line width:
        //   on-segments:  shrink by lineWidth (round caps add it back)
        //   off-segments: grow by lineWidth (round caps eat into gaps)
        // At thin widths the compensation is small; at thick widths, dots
        // become circles (natural for thicker lines) and gaps stay constant.
        ...(() => {
          if (!line.dash) return {};
          const actualW = line.hideFromLegend
            ? chartLineWidth * 0.5
            : Math.max(chartLineWidth * 1.3, 1.8);
          const compensated = line.dash.map((v, idx) =>
            idx % 2 === 0
              ? Math.max(0.1, v - actualW)   // on: shrink (caps restore it)
              : v + actualW                    // off: grow (caps eat into gap)
          );
          return { dash: compensated, cap: "round" as const };
        })(),
        spanGaps,
        points: {
          // Show points for single-point series since lines need 2+ points to be visible
          show: isSinglePoint,
          size: isSinglePoint ? 10 : 6,
          fill: (line.opacity ?? 1) < 1
            ? applyAlpha(baseColor, line.opacity!)
            : baseColor,
        },
        // Legend value formatter:
        //   smoothing on  → "<smoothed> (<raw>)"  e.g. "0.7392 (0.7866)"
        //   smoothing off → "<value>"
        // Matches the FS sidebar column-header strip ("Value (Raw)" / "Value").
        // Min/Max never appear here — they're tooltip-only.
        value: (u: uPlot, val: number | null, _si: number, idx: number | null) => {
          if (val == null || idx == null) return "--";
          const valStr = formatAxisLabel(val);
          const rawIdx = companionRawIdx.get(i);
          if (rawIdx !== undefined) {
            const rawVal = u.data[rawIdx]?.[idx] as number | null;
            return `${valStr} (${rawVal != null ? formatAxisLabel(rawVal) : "—"})`;
          }
          return valStr;
        },
      };
    }),
  ];
}
