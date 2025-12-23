import { useCallback } from "react";

// --------------------- Type Definitions ---------------------
export interface HistogramData {
  freq: number[];
  bins: {
    min: number;
    max: number;
    num: number;
  };
  maxFreq: number;
}

export interface HistogramStep {
  step: number;
  histogramData: HistogramData;
}

export interface SingleRunHistogramProps {
  canvas: HTMLCanvasElement;
  data: HistogramStep;
  xAxisRange: {
    min: number;
    max: number;
    globalMin?: number;
    globalMax?: number;
  };
  theme: string;
  globalMaxFreq: number;
  isSingleRun?: boolean;
}

export interface MultiRunHistogramProps {
  canvas: HTMLCanvasElement;
  normalizedData: Array<{
    runName: string;
    color: string;
    data: HistogramStep[];
  }>;
  currentStep: number; // This is the actual step value
  xAxisRange: { min: number; max: number };
  theme: string;
  globalMaxFreq: number;
  isSingleRun?: boolean;
}

// --------------------- Constants ---------------------
export const TICK_CONFIG = {
  X_AXIS_TICKS: 10,
  Y_AXIS_TICKS: 5,
  TICK_LENGTH: 5,
  MAX_TEXT_WIDTH: 60, // Maximum width for axis labels
  CHART_SPACING: 40, // Minimum spacing between charts
  LABEL_PADDING: 15, // Padding for axis labels
};

// --------------------- Utility Functions ---------------------
export function formatNumber(value: number, isInteger = false): string {
  if (value === 0) return "0";
  if (isInteger) return value.toFixed(0);

  const absValue = Math.abs(value);
  if (absValue >= 1e6 || absValue < 0.001) {
    return value.toExponential(2);
  }
  // For very small numbers, show more decimal places
  if (absValue < 0.01) {
    return value.toFixed(4);
  }
  // For numbers between 0.01 and 1, use fixed notation with appropriate precision
  if (absValue < 1) {
    return value.toFixed(3);
  }
  // For numbers between 1 and 1000, show 2 decimal places
  if (absValue < 1000) {
    return value.toFixed(2);
  }
  // For larger numbers, show 1 decimal place
  return value.toFixed(1);
}

export function generateNiceNumbers(
  min: number,
  max: number,
  numberOfTicks: number,
): number[] {
  const range = max - min;
  const unroundedTickSize = range / (numberOfTicks - 1);
  const exponent = Math.ceil(Math.log10(unroundedTickSize) - 1);
  const pow10 = Math.pow(10, exponent);
  const roundedTickSize = Math.ceil(unroundedTickSize / pow10) * pow10;

  const niceMin = Math.floor(min / roundedTickSize) * roundedTickSize;
  const niceMax = Math.ceil(max / roundedTickSize) * roundedTickSize;

  const ticks: number[] = [];
  for (let tick = niceMin; tick <= niceMax; tick += roundedTickSize) {
    ticks.push(Number(tick.toFixed(10)));
  }

  return ticks;
}

// --------------------- Drawing Functions ---------------------
function drawAxes(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  leftPadding: number,
  bottomPadding: number,
  theme: string,
) {
  ctx.beginPath();
  ctx.strokeStyle = theme === "dark" ? "#94a3b8" : "#666";
  ctx.lineWidth = 1.5;

  // Y-axis
  ctx.moveTo(leftPadding, bottomPadding);
  ctx.lineTo(leftPadding, canvasHeight - bottomPadding);

  // X-axis
  ctx.moveTo(leftPadding, canvasHeight - bottomPadding);
  ctx.lineTo(canvasWidth - bottomPadding, canvasHeight - bottomPadding);

  ctx.stroke();
}

function drawXTicks(
  ctx: CanvasRenderingContext2D,
  xTicks: number[],
  xAxisRange: { min: number; max: number },
  canvasWidth: number,
  canvasHeight: number,
  leftPadding: number,
  bottomPadding: number,
  availableWidth: number,
  theme: string,
  baseFontSize: number,
) {
  // Pre-calculate label widths and positions
  const labelInfo = xTicks
    .map((tickValue) => {
      const normalizedX =
        (tickValue - xAxisRange.min) / (xAxisRange.max - xAxisRange.min);
      const x = leftPadding + normalizedX * availableWidth;
      const formattedValue = formatNumber(tickValue);
      const width = ctx.measureText(formattedValue).width + 10;
      return { x, tickValue, width, formattedValue };
    })
    .filter(
      (info) => info.x >= leftPadding && info.x <= canvasWidth - bottomPadding,
    );

  // Calculate optimal number of labels based on available width
  const avgLabelWidth =
    labelInfo.length > 0
      ? labelInfo.reduce((sum, info) => sum + info.width, 0) / labelInfo.length
      : 0;
  const minSpaceBetweenLabels = Math.max(60, avgLabelWidth * 1.5); // Ensure enough space for scientific notation
  const maxLabels = Math.floor(availableWidth / minSpaceBetweenLabels) + 1;
  const numLabels = Math.min(maxLabels, 7); // Cap at 7 labels for readability

  // Select evenly spaced labels
  const visibleLabels = [];
  if (labelInfo.length > 0) {
    // Always include first and last labels
    visibleLabels.push(labelInfo[0]);

    if (labelInfo.length > 2) {
      // Add evenly spaced labels in between
      const step = (labelInfo.length - 1) / (numLabels - 1);
      for (let i = 1; i < numLabels - 1; i++) {
        const index = Math.round(i * step);
        if (index < labelInfo.length - 1) {
          visibleLabels.push(labelInfo[index]);
        }
      }
    }

    // Add last label if not already added
    if (labelInfo.length > 1) {
      visibleLabels.push(labelInfo[labelInfo.length - 1]);
    }
  }

  // Draw all ticks first
  xTicks.forEach((tickValue) => {
    const normalizedX =
      (tickValue - xAxisRange.min) / (xAxisRange.max - xAxisRange.min);
    const x = leftPadding + normalizedX * availableWidth;

    if (x >= leftPadding && x <= canvasWidth - bottomPadding) {
      ctx.beginPath();
      ctx.moveTo(x, canvasHeight - bottomPadding);
      ctx.lineTo(x, canvasHeight - bottomPadding + TICK_CONFIG.TICK_LENGTH);
      ctx.stroke();
    }
  });

  // Draw the labels for selected ticks
  visibleLabels.forEach((info) => {
    ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
    ctx.font = `${baseFontSize}px sans-serif`;

    // Adjust text alignment and position based on position
    if (info.x <= leftPadding + info.width / 2) {
      ctx.textAlign = "left";
      ctx.fillText(
        info.formattedValue,
        leftPadding + 2,
        canvasHeight - bottomPadding + baseFontSize + 5,
      );
    } else if (info.x >= canvasWidth - bottomPadding - info.width / 2) {
      ctx.textAlign = "right";
      ctx.fillText(
        info.formattedValue,
        canvasWidth - bottomPadding - 2,
        canvasHeight - bottomPadding + baseFontSize + 5,
      );
    } else {
      ctx.textAlign = "center";
      ctx.fillText(
        info.formattedValue,
        info.x,
        canvasHeight - bottomPadding + baseFontSize + 5,
      );
    }
  });
}

function drawYTicks(
  ctx: CanvasRenderingContext2D,
  yTicks: number[],
  globalMaxFreq: number,
  canvasHeight: number,
  leftPadding: number,
  bottomPadding: number,
  yEnd: number,
  histogramHeight: number,
  theme: string,
  baseFontSize: number,
) {
  yTicks.forEach((tickValue) => {
    const normalizedY = tickValue / globalMaxFreq;
    const y = yEnd - normalizedY * histogramHeight;

    ctx.beginPath();
    ctx.moveTo(leftPadding - TICK_CONFIG.TICK_LENGTH, y);
    ctx.lineTo(leftPadding, y);
    ctx.stroke();

    ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
    ctx.font = `${baseFontSize}px sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const formattedValue = formatNumber(tickValue, true);
    ctx.fillText(formattedValue, leftPadding - 8, y);
  });
}

function drawHistogramBars(
  ctx: CanvasRenderingContext2D,
  freq: number[],
  bins: { min: number; max: number; num: number },
  xAxisRange: { min: number; max: number },
  globalMaxFreq: number,
  leftPadding: number,
  bottomPadding: number,
  canvasWidth: number,
  availableWidth: number,
  yEnd: number,
  histogramHeight: number,
  color?: string,
  useSolidColor = false,
) {
  const dataBinWidth = (bins.max - bins.min) / bins.num;

  for (let i = 0; i < freq.length; i++) {
    const frequency = freq[i];
    if (frequency <= 0) continue;

    // Calculate bar position and dimensions
    const binStart = bins.min + i * dataBinWidth;
    const binEnd = binStart + dataBinWidth;

    // Normalize x coordinates to available width
    const normalizedStart =
      (binStart - xAxisRange.min) / (xAxisRange.max - xAxisRange.min);
    const normalizedEnd =
      (binEnd - xAxisRange.min) / (xAxisRange.max - xAxisRange.min);

    // Calculate actual x positions within the chart area
    const xStart = leftPadding + normalizedStart * availableWidth;
    const xEnd = leftPadding + normalizedEnd * availableWidth;

    // Ensure bar width is at least 1 pixel but doesn't exceed chart bounds
    const barWidth = Math.max(1, Math.min(xEnd - xStart, availableWidth));

    // Calculate bar height using globalMaxFreq for consistent scaling
    const normalizedHeight = frequency / globalMaxFreq;
    const barHeight = normalizedHeight * histogramHeight;
    const y = yEnd - barHeight;

    // Only draw if the bar is within the chart bounds
    if (xStart <= canvasWidth - bottomPadding && xEnd >= leftPadding) {
      const clippedStart = Math.max(xStart, leftPadding);
      const clippedEnd = Math.min(xEnd, canvasWidth - bottomPadding);
      const clippedWidth = clippedEnd - clippedStart;

      if (clippedWidth > 0) {
        if (useSolidColor || !color) {
          // Solid color (multi-run view)
          ctx.fillStyle = color || "rgba(59, 130, 246, 0.8)";
          ctx.fillRect(clippedStart, y, clippedWidth, barHeight);
        } else {
          // Gradient (single-run view)
          const gradient = ctx.createLinearGradient(
            clippedStart,
            y,
            clippedStart,
            yEnd,
          );
          gradient.addColorStop(0, color || "rgba(59, 130, 246, 0.8)");
          gradient.addColorStop(
            1,
            color?.replace("0.8", "0.2") || "rgba(59, 130, 246, 0.2)",
          );
          ctx.fillStyle = gradient;
          ctx.fillRect(clippedStart, y, clippedWidth, barHeight);
        }
      }
    }
  }
}

// --------------------- Hooks ---------------------
export const useHistogramCanvas = () => {
  // Single run histogram drawing
  const drawSingleHistogram = useCallback(
    ({
      canvas,
      data,
      xAxisRange,
      theme,
      globalMaxFreq,
    }: SingleRunHistogramProps) => {
      if (!canvas || !data) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      ctx.scale(dpr, dpr);

      const minDimension = Math.min(displayWidth, displayHeight);
      const padding = Math.max(40, Math.min(60, minDimension * 0.1));

      // Calculate available space
      const availableWidth = displayWidth - padding * 2;
      const availableHeight = displayHeight - padding * 2;

      ctx.clearRect(0, 0, displayWidth, displayHeight);

      // Draw axes
      drawAxes(ctx, displayWidth, displayHeight, padding, padding, theme);

      // Generate and draw ticks
      const xTicks = generateNiceNumbers(
        xAxisRange.min,
        xAxisRange.max,
        TICK_CONFIG.X_AXIS_TICKS,
      );

      const yTicks = generateNiceNumbers(
        0,
        globalMaxFreq,
        TICK_CONFIG.Y_AXIS_TICKS,
      );

      const baseFontSize = Math.max(10, Math.min(14, minDimension * 0.025));
      const titleFontSize = Math.max(12, Math.min(16, minDimension * 0.03));

      drawXTicks(
        ctx,
        xTicks,
        xAxisRange,
        displayWidth,
        displayHeight,
        padding,
        padding,
        availableWidth,
        theme,
        baseFontSize,
      );

      drawYTicks(
        ctx,
        yTicks,
        globalMaxFreq,
        displayHeight,
        padding,
        padding,
        displayHeight - padding,
        availableHeight,
        theme,
        baseFontSize,
      );

      // Draw histogram bars
      const { freq, bins } = data.histogramData;

      drawHistogramBars(
        ctx,
        freq,
        bins,
        xAxisRange,
        globalMaxFreq,
        padding,
        padding,
        displayWidth,
        availableWidth,
        displayHeight - padding,
        availableHeight,
        "rgba(59, 130, 246, 0.8)",
        false,
      );

      // Draw step counter
      ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
      ctx.font = `${titleFontSize}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(
        `Step: ${formatNumber(data.step, true)}`,
        displayWidth - padding,
        padding - titleFontSize - 5,
      );
    },
    [],
  );

  // Multi-run histogram drawing
  const drawMultiHistogram = useCallback(
    ({
      canvas,
      normalizedData,
      currentStep,
      xAxisRange,
      theme,
      globalMaxFreq,
    }: MultiRunHistogramProps) => {
      if (!canvas || normalizedData.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Find the data for the current step value in each run
      const findStepData = (run: any) => {
        return run.data.find((d: any) => d.step === currentStep);
      };

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      ctx.scale(dpr, dpr);

      const minDimension = Math.min(displayWidth, displayHeight);
      const padding = Math.max(20, Math.min(40, minDimension * 0.08));
      const legendHeight = Math.max(20, Math.min(30, minDimension * 0.06));

      // Calculate available height for all charts
      const totalSpacing =
        (normalizedData.length - 1) * TICK_CONFIG.CHART_SPACING;
      const availableHeight =
        displayHeight - (padding * 2 + legendHeight + totalSpacing);
      const histogramHeight = Math.max(
        30,
        availableHeight / normalizedData.length,
      );

      ctx.clearRect(0, 0, displayWidth, displayHeight);

      const baseFontSize = Math.max(10, Math.min(14, minDimension * 0.02));
      const titleFontSize = Math.max(12, Math.min(16, minDimension * 0.025));

      // Calculate maximum text width for y-axis labels across all runs
      ctx.font = `${baseFontSize}px sans-serif`;
      let maxYLabelWidth = 0;
      normalizedData.forEach((run) => {
        const stepData = findStepData(run);
        if (!stepData) return;
        const yTicks = generateNiceNumbers(
          0,
          stepData.histogramData.maxFreq,
          TICK_CONFIG.Y_AXIS_TICKS,
        );
        const runMaxWidth = Math.max(
          ...yTicks.map(
            (tick) => ctx.measureText(formatNumber(tick, true)).width,
          ),
        );
        maxYLabelWidth = Math.max(maxYLabelWidth, runMaxWidth);
      });

      const leftPadding = Math.max(
        padding,
        maxYLabelWidth + TICK_CONFIG.LABEL_PADDING,
      );

      // Calculate actual available width for the chart area
      const availableWidth = displayWidth - (leftPadding + padding);

      // Draw shared x-axis at the bottom
      const xTicks = generateNiceNumbers(
        xAxisRange.min,
        xAxisRange.max,
        TICK_CONFIG.X_AXIS_TICKS,
      );

      // Draw bottom x-axis
      ctx.strokeStyle = theme === "dark" ? "#94a3b8" : "#666";
      ctx.lineWidth = Math.max(1, minDimension * 0.001);
      ctx.beginPath();
      ctx.moveTo(leftPadding, displayHeight - padding);
      ctx.lineTo(displayWidth - padding, displayHeight - padding);
      ctx.stroke();

      // Draw x ticks and labels
      drawXTicks(
        ctx,
        xTicks,
        xAxisRange,
        displayWidth,
        displayHeight,
        leftPadding,
        padding,
        availableWidth,
        theme,
        baseFontSize,
      );

      // Calculate positions for each chart
      const chartPositions = normalizedData.map((_, index) => {
        const yStart =
          padding +
          legendHeight +
          index * (histogramHeight + TICK_CONFIG.CHART_SPACING);
        return {
          yStart,
          yEnd: yStart + histogramHeight,
        };
      });

      // Draw each histogram
      normalizedData.forEach((run, runIndex) => {
        const stepData = findStepData(run);
        if (!stepData) return;

        const { freq, bins, maxFreq } = stepData.histogramData;
        const { yStart, yEnd } = chartPositions[runIndex];

        // Draw y-axis line for this run
        ctx.beginPath();
        ctx.moveTo(leftPadding, yStart);
        ctx.lineTo(leftPadding, yEnd);
        ctx.stroke();

        // Draw run name
        ctx.fillStyle = run.color;
        ctx.font = `${baseFontSize}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";

        const runName = run.runName;
        const maxRunNameWidth = availableWidth - 10;
        if (ctx.measureText(runName).width > maxRunNameWidth) {
          let truncatedName = runName;
          while (
            ctx.measureText(truncatedName + "...").width > maxRunNameWidth
          ) {
            truncatedName = truncatedName.slice(0, -1);
          }
          ctx.fillText(truncatedName + "...", leftPadding, yStart - 5);
        } else {
          ctx.fillText(runName, leftPadding, yStart - 5);
        }

        // Draw histogram bars for this run
        drawHistogramBars(
          ctx,
          freq,
          bins,
          xAxisRange,
          globalMaxFreq,
          leftPadding,
          padding,
          displayWidth,
          availableWidth,
          yEnd,
          histogramHeight,
          run.color,
          true, // Use solid color for multi-run view
        );

        // Generate y-axis ticks using globalMaxFreq instead of run-specific maxFreq
        const yTicks = generateNiceNumbers(
          0,
          globalMaxFreq,
          TICK_CONFIG.Y_AXIS_TICKS,
        );

        // Draw y-axis ticks for this run
        drawYTicks(
          ctx,
          yTicks,
          globalMaxFreq,
          displayHeight,
          leftPadding,
          padding,
          yEnd,
          histogramHeight,
          theme,
          baseFontSize,
        );
      });

      // Draw step counter at the top
      ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
      ctx.font = `${titleFontSize}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(
        `Step: ${formatNumber(currentStep, true)}`,
        displayWidth - padding,
        padding - 5,
      );
    },
    [],
  );

  // Generic histogram drawing function that routes to the appropriate implementation
  const drawHistogram = useCallback(
    (props: SingleRunHistogramProps | MultiRunHistogramProps) => {
      if ("data" in props) {
        // Single run case
        drawSingleHistogram(props);
      } else if ("normalizedData" in props) {
        // Multi-run case
        drawMultiHistogram(props);
      }
    },
    [drawSingleHistogram, drawMultiHistogram],
  );

  return {
    drawHistogram,
    drawSingleHistogram,
    drawMultiHistogram,
    // Export helper functions for external use if needed
    formatNumber,
    generateNiceNumbers,
  };
};
