import { LocalCache, useLocalStorage } from "@/lib/db/local-cache";
import type { TooltipInterpolation } from "@/lib/math/interpolation";

export type DisplayLogName =
  | "Step"
  | "Absolute Time"
  | "Relative Time"
  | (string & {});

export type SmoothingAlgorithm = "twema" | "gaussian" | "running" | "ema";

/** Y-axis scaling mode. "auto" = full data range (default), "outlier-aware" = IQR-based outlier detection */
export type YAxisScaleMode = "auto" | "outlier-aware";

export interface LineChartSettings {
  selectedLog: DisplayLogName;
  xAxisLogScale: boolean;
  yAxisLogScale: boolean;
  yAxisScaleMode: YAxisScaleMode;
  smoothing: {
    enabled: boolean;
    algorithm: SmoothingAlgorithm;
    parameter: number;
    showOriginalData: boolean;
  };
  /** Maximum points to draw per series (client-side only). 0 = draw all points. Does not affect data loading. */
  maxPointsPerSeries: number;
  /** Tooltip interpolation mode for series with missing values at the hovered step.
   *  "none" = only show exact matches, "linear" = linear interpolation, "last" = forward-fill */
  tooltipInterpolation: TooltipInterpolation;
}

export const DEFAULT_SETTINGS: LineChartSettings = {
  selectedLog: "Step",
  xAxisLogScale: false,
  yAxisLogScale: false,
  yAxisScaleMode: "auto",
  smoothing: {
    enabled: true,
    algorithm: "gaussian",
    parameter: 2,
    showOriginalData: true,
  },
  // Default 2000: good balance of performance and visual fidelity.
  // Min/max envelopes preserve anomalies even with aggressive downsampling.
  // Set to 0 to disable downsampling (may be slow for 100k+ points).
  maxPointsPerSeries: 2000,
  tooltipInterpolation: "linear",
};

const lineSettingsDb = new LocalCache<LineChartSettings>(
  "run-settings",
  "line-chart-settings",
  1000,
);

export interface UseLineSettingsResult {
  settings: LineChartSettings;
  updateSettings: <K extends keyof LineChartSettings>(
    key: K,
    value: LineChartSettings[K],
  ) => void;
  updateSmoothingSettings: <K extends keyof LineChartSettings["smoothing"]>(
    key: K,
    value: LineChartSettings["smoothing"][K],
  ) => void;
  resetSettings: () => void;
  getSmoothingConfig: () => {
    min: number;
    max: number;
    step: number;
    defaultValue: number;
  };
  getSmoothingInfo: () => {
    title: string;
    description: string;
    paramTitle: string;
    paramDescription: string;
    link?: {
      url: string;
      label: string;
    };
  };
}

export function useLineSettings(
  organizationId: string,
  projectName: string,
  runId: string | undefined,
): UseLineSettingsResult {
  const globalKey = `${organizationId}-${projectName}-${runId}`;

  const [settings, setSettings] = useLocalStorage<LineChartSettings>(
    lineSettingsDb,
    globalKey,
    DEFAULT_SETTINGS,
  );

  const updateSettings = <K extends keyof LineChartSettings>(
    key: K,
    value: LineChartSettings[K],
  ) => {
    setSettings({ ...settings, [key]: value });
  };

  const updateSmoothingSettings = <
    K extends keyof LineChartSettings["smoothing"],
  >(
    key: K,
    value: LineChartSettings["smoothing"][K],
  ) => {
    setSettings({
      ...settings,
      smoothing: { ...settings.smoothing, [key]: value },
    });
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  // Get the appropriate smoothing parameter range and step based on algorithm
  const getSmoothingConfig = () => {
    switch (settings.smoothing.algorithm) {
      case "twema":
      case "ema":
        return { min: 0, max: 0.999, step: 0.001, defaultValue: 0.6 };
      case "gaussian":
        return { min: 0.1, max: 100, step: 0.1, defaultValue: 2 };
      case "running":
        return { min: 1, max: 100, step: 1, defaultValue: 10 };
      default:
        return { min: 0, max: 1, step: 0.01, defaultValue: 0.6 };
    }
  };

  // Get appropriate info for current smoothing algorithm
  const getSmoothingInfo = () => {
    switch (settings.smoothing.algorithm) {
      case "twema":
        return {
          title: "Time Weighted EMA",
          description:
            "The Time Weighted Exponential Moving Average smoothing algorithm exponentially decays the weight of previous points, taking point density into account for consistent smoothing across multiple lines.",
          paramTitle: "Weight",
          paramDescription:
            "Controls the amount of smoothing (0-0.999). Higher values give more weight to past points, resulting in smoother curves.",
          link: {
            url: "https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average",
            label: "Learn more about Exponential Smoothing",
          },
        };
      case "gaussian":
        return {
          title: "Gaussian Smoothing",
          description:
            "Gaussian smoothing computes a weighted average where weights follow a gaussian distribution. This method considers both past and future points for each x value.",
          paramTitle: "Standard Deviation",
          paramDescription:
            "Controls the width of the gaussian kernel. Higher values include more distant points in the average, creating smoother curves.",
          link: {
            url: "https://en.wikipedia.org/wiki/Gaussian_filter",
            label: "Learn more about Gaussian Filters",
          },
        };
      case "running":
        return {
          title: "Running Average",
          description:
            "Also known as a 'boxcar filter', this algorithm replaces each point with the average of surrounding points within a fixed window size.",
          paramTitle: "Window Size",
          paramDescription:
            "The number of points to include in the moving average. Larger windows create smoother curves but may lose more detail.",
          link: {
            url: "https://en.wikipedia.org/wiki/Moving_average#Simple_moving_average",
            label: "Learn more about Moving Averages",
          },
        };
      case "ema":
        return {
          title: "Exponential Moving Average",
          description:
            "A technique that applies a weighting factor which decreases exponentially for older data points. Includes a de-bias term to prevent early values from being biased toward zero.",
          paramTitle: "Weight",
          paramDescription:
            "Controls the amount of smoothing (0-0.999). Higher values give more weight to past points, resulting in smoother curves.",
          link: {
            url: "https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average",
            label: "Learn more about Exponential Smoothing",
          },
        };
      default:
        return {
          title: "Smoothing Parameter",
          description: "Controls the intensity of the smoothing effect.",
          paramTitle: "Parameter",
          paramDescription: "Adjust to change smoothing intensity.",
        };
    }
  };

  return {
    settings,
    updateSettings,
    updateSmoothingSettings,
    resetSettings,
    getSmoothingConfig,
    getSmoothingInfo,
  };
}
