import type { Widget, ChartWidgetConfig } from "../../~types/dashboard-types";
import { isGlobValue, getGlobPattern, isRegexValue, getRegexPattern } from "./glob-utils";

/** Get a display title for a widget based on its type and config. */
export function getWidgetTitle(widget: Widget): string {
  switch (widget.type) {
    case "chart": {
      const config = widget.config as { metrics?: string[] };
      if (config.metrics && config.metrics.length > 0) {
        const displayNames = config.metrics.map((m) =>
          isGlobValue(m) ? getGlobPattern(m) : isRegexValue(m) ? getRegexPattern(m) : m
        );
        if (displayNames.length === 1) {
          return displayNames[0];
        }
        if (displayNames.length <= 3) {
          return displayNames.join(", ");
        }
        return `${displayNames.length} metrics`;
      }
      return "Chart";
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
