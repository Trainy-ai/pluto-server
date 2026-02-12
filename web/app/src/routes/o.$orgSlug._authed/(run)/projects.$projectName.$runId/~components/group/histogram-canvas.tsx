import React, { useEffect, useRef, useCallback } from "react";
import {
  drawAxes,
  drawXTicks,
  drawYTicks,
  drawHistogramBars,
  drawStepAnnotation,
  CANVAS_PADDING,
  type HistogramStep,
  type XAxisRange,
} from "./histogram-canvas-utils";

interface HistogramCanvasProps {
  data: HistogramStep;
  theme: string;
  globalMaxFreq: number;
  xAxisRange: XAxisRange;
}

export const HistogramCanvas = React.forwardRef<
  HTMLCanvasElement,
  HistogramCanvasProps
>(({ data, theme, globalMaxFreq, xAxisRange }, forwardedRef) => {
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef =
    (forwardedRef as React.RefObject<HTMLCanvasElement>) || internalCanvasRef;

  const drawHistogram = useCallback(() => {
    if (!canvasRef.current || !data) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width - CANVAS_PADDING * 2;
    const height = canvas.height - CANVAS_PADDING * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAxes(ctx, canvas, theme, CANVAS_PADDING);
    drawXTicks(ctx, canvas, theme, xAxisRange, width, CANVAS_PADDING);
    drawYTicks(ctx, canvas, theme, globalMaxFreq, height, CANVAS_PADDING);
    drawHistogramBars(
      ctx,
      canvas,
      data,
      xAxisRange,
      globalMaxFreq,
      CANVAS_PADDING,
      width,
      height,
    );
    drawStepAnnotation(ctx, canvas, theme, data.step, CANVAS_PADDING);
  }, [data, theme, globalMaxFreq, xAxisRange, canvasRef]);

  useEffect(() => {
    const frameId = requestAnimationFrame(drawHistogram);
    return () => cancelAnimationFrame(frameId);
  }, [drawHistogram]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={400}
      className="w-full rounded-lg bg-background"
    />
  );
});
HistogramCanvas.displayName = "HistogramCanvas";
