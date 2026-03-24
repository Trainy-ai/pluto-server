import uPlot from "uplot";
import { formatAxisLabels, formatRelativeTimeValues, smartDateFormatter } from "./format";

interface AxesConfigParams {
  showXAxis: boolean;
  showYAxis: boolean;
  axisColor: string;
  gridColor: string;
  isDateTime: boolean;
  isRelativeTime: boolean;
  logXAxis: boolean;
  logYAxis: boolean;
  xlabel: string | undefined;
  ylabel: string | undefined;
  timeRange: number;
}

/**
 * Build uPlot axes configuration for X and Y axes.
 * Handles datetime, relative time, and numeric axis formatting.
 */
export function buildAxesConfig({
  showXAxis,
  showYAxis,
  axisColor,
  gridColor,
  isDateTime,
  isRelativeTime,
  logXAxis,
  logYAxis,
  xlabel,
  ylabel,
  timeRange,
}: AxesConfigParams): uPlot.Axis[] {
  return [
    {
      // X axis
      show: showXAxis !== false,
      stroke: axisColor,
      grid: { stroke: gridColor, dash: [2, 2] },
      ticks: { stroke: gridColor, size: 3 },
      values: isDateTime
        ? (u, vals) => vals.map((v) => smartDateFormatter(v, timeRange))
        : isRelativeTime
          ? (u, vals) => formatRelativeTimeValues(vals)
          : (u, vals) => formatAxisLabels(vals, logXAxis),
      label: xlabel,
      labelSize: xlabel ? 14 : 0,
      labelFont: "10px ui-monospace, monospace",
      font: "9px ui-monospace, monospace",
      size: xlabel ? 32 : 24, // Compact height for x-axis
      gap: 2,
    },
    {
      // Y axis
      show: showYAxis !== false,
      stroke: axisColor,
      grid: { stroke: gridColor, dash: [2, 2] },
      ticks: { stroke: gridColor, size: 3 },
      values: (u, vals) => formatAxisLabels(vals, logYAxis),
      label: ylabel,
      labelSize: ylabel ? 14 : 0,
      labelFont: "10px ui-monospace, monospace",
      font: "9px ui-monospace, monospace",
      size: ylabel ? 50 : 40, // Compact width for y-axis
      gap: 2,
    },
  ];
}
