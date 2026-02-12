// Canvas drawing utilities for histogram visualization.
// Extracted from histogram-view.tsx to separate pure drawing logic from component state.

export const ANIMATION_CONFIG = {
  MIN_SPEED: 1,
  MAX_SPEED: 1000,
  SPEED_STEP: 10,
  DEFAULT_SPEED: 10,
  GIF_FRAME_DELAY: 100, // in ms
} as const;

export const TICK_CONFIG = {
  X_AXIS_TICKS: 10,
  Y_AXIS_TICKS: 5,
  TICK_LENGTH: 5,
} as const;

export const CANVAS_PADDING = 60;

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

export interface XAxisRange {
  min: number;
  max: number;
  globalMin: number;
  globalMax: number;
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

export function formatNumber(value: number, isInteger = false): string {
  if (value === 0) return "0";
  if (isInteger) return value.toFixed(0);
  const absValue = Math.abs(value);
  if (absValue < 0.0001 || absValue >= 1000000) return value.toExponential(2);
  if (absValue < 0.1) return value.toFixed(4);
  if (absValue < 1000) return value.toFixed(2);
  return value.toFixed(1);
}

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  padding: number,
) {
  ctx.beginPath();
  ctx.strokeStyle = theme === "dark" ? "#94a3b8" : "#666";
  ctx.lineWidth = 1.5;

  // Y-axis
  ctx.moveTo(padding, 0);
  ctx.lineTo(padding, canvas.height - padding);
  // X-axis
  ctx.moveTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();
}

export function drawXTicks(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  xAxisRange: XAxisRange,
  width: number,
  padding: number,
) {
  const xTicks = generateNiceNumbers(
    xAxisRange.min,
    xAxisRange.max,
    TICK_CONFIG.X_AXIS_TICKS,
  );
  xTicks.forEach((tickValue) => {
    const normalizedX =
      (tickValue - xAxisRange.min) / (xAxisRange.max - xAxisRange.min);
    const x = padding + normalizedX * width;

    // Only draw ticks if they are within the plot area (after y-axis)
    if (x >= padding && x <= canvas.width - padding) {
      ctx.beginPath();
      ctx.moveTo(x, canvas.height - padding);
      ctx.lineTo(x, canvas.height - padding + TICK_CONFIG.TICK_LENGTH);
      ctx.stroke();
      ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        formatNumber(tickValue),
        x,
        canvas.height - padding + TICK_CONFIG.TICK_LENGTH + 2,
      );
    }
  });
}

export function drawYTicks(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  globalMaxFreq: number,
  height: number,
  padding: number,
) {
  const yTicks = generateNiceNumbers(
    0,
    globalMaxFreq,
    TICK_CONFIG.Y_AXIS_TICKS,
  );
  yTicks.forEach((tickValue) => {
    const normalizedY = tickValue / globalMaxFreq;
    const y = canvas.height - padding - normalizedY * height;
    ctx.beginPath();
    ctx.moveTo(padding - TICK_CONFIG.TICK_LENGTH, y);
    ctx.lineTo(padding, y);
    ctx.stroke();
    ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(
      formatNumber(tickValue, true),
      padding - TICK_CONFIG.TICK_LENGTH - 4,
      y,
    );
  });
}

export function drawHistogramBars(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  data: HistogramStep,
  xAxisRange: XAxisRange,
  globalMaxFreq: number,
  padding: number,
  width: number,
  height: number,
) {
  const { freq, bins } = data.histogramData;
  const dataBinWidth = (bins.max - bins.min) / bins.num;
  const visibleStartBin = Math.max(
    0,
    Math.floor((xAxisRange.min - bins.min) / dataBinWidth),
  );
  const visibleEndBin = Math.min(
    bins.num - 1,
    Math.ceil((xAxisRange.max - bins.min) / dataBinWidth),
  );

  for (let i = visibleStartBin; i <= visibleEndBin; i++) {
    const frequency = freq[i];
    if (frequency === undefined) continue;

    const binStart = bins.min + i * dataBinWidth;
    const binEnd = binStart + dataBinWidth;
    const xStart =
      padding +
      ((binStart - xAxisRange.min) / (xAxisRange.max - xAxisRange.min)) *
        width;
    const xEnd =
      padding +
      ((binEnd - xAxisRange.min) / (xAxisRange.max - xAxisRange.min)) * width;
    const barWidth = xEnd - xStart;
    const barHeight = (frequency / globalMaxFreq) * height;
    const y = canvas.height - padding - barHeight;

    const gradient = ctx.createLinearGradient(
      xStart,
      y,
      xStart,
      canvas.height - padding,
    );
    gradient.addColorStop(0, "rgba(59, 130, 246, 0.8)");
    gradient.addColorStop(1, "rgba(59, 130, 246, 0.2)");
    ctx.fillStyle = gradient;
    ctx.fillRect(xStart, y, barWidth, barHeight);
  }
}

export function drawStepAnnotation(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: string,
  step: number,
  padding: number,
) {
  ctx.fillStyle = theme === "dark" ? "#94a3b8" : "#666";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(
    `Step: ${formatNumber(step, true)}`,
    canvas.width - padding,
    padding - 10,
  );
}
