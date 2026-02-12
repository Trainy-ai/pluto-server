import GIF from "gif.js";
import {
  ANIMATION_CONFIG,
  CANVAS_PADDING,
  drawAxes,
  drawXTicks,
  drawYTicks,
  drawHistogramBars,
  drawStepAnnotation,
  type HistogramStep,
  type XAxisRange,
} from "./histogram-canvas-utils";

export async function createHistogramGif(
  canvas: HTMLCanvasElement,
  steps: HistogramStep[],
  theme: string,
  globalMaxFreq: number,
  xAxisRange: XAxisRange,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: canvas.width,
        height: canvas.height,
        workerScript: "/gif.worker.js",
        background: theme === "dark" ? "#000000" : "#ffffff",
        debug: true,
      });

      let processedFrames = 0;
      const totalFrames = steps.length;

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx)
        throw new Error("Failed to create temporary canvas context");

      gif.on("progress", (p: number) => onProgress(p));

      steps.forEach((step) => {
        try {
          tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
          const width = tempCanvas.width - CANVAS_PADDING * 2;
          const height = tempCanvas.height - CANVAS_PADDING * 2;

          // Draw axes and ticks on temp canvas
          drawAxes(
            tempCtx,
            tempCanvas,
            theme,
            CANVAS_PADDING,
          );
          drawXTicks(tempCtx, tempCanvas, theme, xAxisRange, width, CANVAS_PADDING);
          drawYTicks(
            tempCtx,
            tempCanvas,
            theme,
            globalMaxFreq,
            height,
            CANVAS_PADDING,
          );

          // Draw histogram bars on temp canvas
          drawHistogramBars(
            tempCtx,
            tempCanvas,
            step,
            xAxisRange,
            globalMaxFreq,
            CANVAS_PADDING,
            width,
            height,
          );

          // Render step annotation
          drawStepAnnotation(tempCtx, tempCanvas, theme, step.step, CANVAS_PADDING);

          gif.addFrame(tempCanvas, {
            delay: ANIMATION_CONFIG.GIF_FRAME_DELAY,
            copy: true,
            dispose: 2,
          });
          processedFrames++;
          if (processedFrames === totalFrames) gif.render();
        } catch (frameError) {
          console.error("Error processing frame:", frameError);
          throw frameError;
        }
      });

      gif.on("finished", (blob: Blob) => resolve(blob));
      gif.on("error", (error: Error) => reject(error));
    } catch (error) {
      reject(error);
    }
  });
}
