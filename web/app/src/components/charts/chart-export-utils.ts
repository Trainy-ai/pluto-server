/**
 * Utility functions for exporting uPlot chart canvases as PNG images.
 * No external dependencies — uses the browser Canvas API directly.
 */

/** Find the first <canvas> element inside a container */
function findChartCanvas(container: HTMLElement): HTMLCanvasElement | null {
  return container.querySelector("canvas");
}

/** Walk up the DOM to find the first ancestor with a non-transparent background */
function resolveOpaqueBackground(el: HTMLElement): string {
  let current: HTMLElement | null = el;
  while (current) {
    const bg = getComputedStyle(current).backgroundColor;
    // Skip transparent / rgba(0,0,0,0)
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      return bg;
    }
    current = current.parentElement;
  }
  return "#ffffff";
}

/**
 * Capture the chart canvas as a PNG Blob.
 * Creates a temporary canvas with an opaque background, composites the chart onto it.
 */
export async function captureChartAsBlob(
  container: HTMLElement
): Promise<Blob> {
  const canvas = findChartCanvas(container);
  if (!canvas) {
    throw new Error("No chart canvas found");
  }

  const w = canvas.width;
  const h = canvas.height;

  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext("2d")!;

  // Fill with opaque background (respects dark/light theme)
  ctx.fillStyle = resolveOpaqueBackground(container);
  ctx.fillRect(0, 0, w, h);

  // Draw the chart on top
  ctx.drawImage(canvas, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    offscreen.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to create image blob"));
      }
    }, "image/png");
  });
}

/** Copy the chart image to the system clipboard */
export async function copyChartToClipboard(container: HTMLElement): Promise<void> {
  const blob = await captureChartAsBlob(container);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
}

/** Download the chart image as a PNG file */
export async function downloadChartAsPng(
  container: HTMLElement,
  fileName: string
): Promise<void> {
  const blob = await captureChartAsBlob(container);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
