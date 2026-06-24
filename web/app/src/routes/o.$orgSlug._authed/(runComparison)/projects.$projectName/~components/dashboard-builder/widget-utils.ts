import type {
  Widget,
  ChartWidgetConfig,
  DistributionsWidgetConfig,
} from "../../~types/dashboard-types";
import { isGlobValue, getGlobPattern, isRegexValue, getRegexPattern } from "./glob-utils";

/** Get a display title for a widget based on its type and config. */
export function getWidgetTitle(widget: Widget): string {
  switch (widget.type) {
    case "chart": {
      const config = widget.config as ChartWidgetConfig;
      const labels = (config.metrics ?? []).map((m) =>
        isGlobValue(m) ? getGlobPattern(m) : isRegexValue(m) ? getRegexPattern(m) : m,
      );
      if (labels.length === 0) return "Chart";
      if (labels.length === 1) return labels[0];
      if (labels.length <= 3) return labels.join(", ");
      return `${labels.length} metrics`;
    }
    case "distributions": {
      const config = widget.config as DistributionsWidgetConfig;
      const entries = config.entries ?? [];
      if (entries.length === 0) return "Distributions";
      // 1-3 entries → show the joined labels so users see exactly
      // what they picked. 4+ → switch to a kind breakdown (e.g.
      // "2 bars · 2 histograms") instead of the generic "4 entries"
      // since the kinds are mixed-meaning in this widget type.
      // Bars title format: `<prefix>/*` (e.g. `training/dataset/*`).
      // Replaces the older `<prefix>{bars}` form — the `{bars}` token is
      // an internal encoding for the picker dropdown / dynamic-section
      // pattern matcher and shouldn't surface in user-facing titles.
      const labels = entries.map((e) =>
        e.kind === "bars"
          ? `${e.prefix.replace(/\/$/, "")}/*`
          : e.metric,
      );
      if (entries.length === 1) return labels[0];
      if (entries.length <= 3) return labels.join(", ");
      const bars = entries.filter((e) => e.kind === "bars").length;
      const histograms = entries.length - bars;
      const parts: string[] = [];
      if (bars > 0) parts.push(`${bars} bar chart${bars === 1 ? "" : "s"}`);
      if (histograms > 0)
        parts.push(`${histograms} histogram${histograms === 1 ? "" : "s"}`);
      return parts.join(" · ");
    }
    case "scatter": {
      const config = widget.config as { xMetric?: string; yMetric?: string };
      if (config.xMetric && config.yMetric) {
        return `${config.xMetric} vs ${config.yMetric}`;
      }
      return "Scatter Plot";
    }
    case "single-value": {
      const config = widget.config as { metric?: string };
      return config.metric || "Single Value";
    }
    case "histogram": {
      const config = widget.config as { metric?: string };
      return config.metric ? `Histogram: ${config.metric}` : "Histogram";
    }
    case "logs":
      return "Logs";
    case "file-group": {
      const config = widget.config as { files?: string[] };
      if (config.files && config.files.length > 0) {
        const displayNames = config.files.map((f) =>
          isGlobValue(f) ? getGlobPattern(f) : isRegexValue(f) ? getRegexPattern(f) : f
        );
        if (displayNames.length === 1) {
          return displayNames[0];
        }
        if (displayNames.length <= 3) {
          return displayNames.join(", ");
        }
        return `${displayNames.length} files`;
      }
      return "Files";
    }
    case "file-series":
      return "File Series";
    default:
      return "Widget";
  }
}

/** Check if a widget uses glob or regex patterns (i.e., is "dynamic"). */
export function hasWidgetPatterns(widget: Widget): boolean {
  if (widget.type === "chart") {
    const config = widget.config as { metrics?: string[] };
    return config.metrics?.some((m) => isGlobValue(m) || isRegexValue(m)) ?? false;
  }
  if (widget.type === "file-group") {
    const config = widget.config as { files?: string[] };
    return config.files?.some((f) => isGlobValue(f) || isRegexValue(f)) ?? false;
  }
  return false;
}
