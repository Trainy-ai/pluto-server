/**
 * Utility functions for exporting uPlot chart canvases as PNG images.
 * Includes chart title and legend entries in the exported image.
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

/** Determine if a CSS color string is dark (for choosing contrasting text) */
function isColorDark(color: string): boolean {
  // Use a 1x1 canvas to let the browser parse any valid CSS color string
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return false;
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
}

interface LegendEntry {
  label: string;
  color: string;
}

/** Extract the chart title text from the container DOM */
function extractChartTitle(container: HTMLElement): string | null {
  const titleEl = container.querySelector<HTMLElement>(
    '[data-testid="chart-title"]'
  );
  return titleEl?.textContent?.trim() ?? null;
}

/** Extract visible legend entries (label + color) from the uPlot legend DOM */
function extractLegendEntries(container: HTMLElement): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const legendTable = container.querySelector(".u-legend");
  if (!legendTable) {
    return entries;
  }

  const rows = legendTable.querySelectorAll("tr.u-series");
  // Row 0 is the X-axis; data series start at index 1
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as HTMLElement;
    if (row.style.display === "none") {
      continue;
    }

    const marker = row.querySelector(".u-marker") as HTMLElement | null;
    const label = row.querySelector(".u-label") as HTMLElement | null;
    if (marker && label) {
      // uPlot sets border-color on the marker to the series stroke color
      const style = getComputedStyle(marker);
      const color =
        style.borderColor || style.backgroundColor || "rgb(136,136,136)";
      const text = label.textContent?.trim() || "";
      if (text) {
        entries.push({ label: text, color });
      }
    }
  }

  return entries;
}

/**
 * Capture the chart as a PNG Blob, including the title and legend.
 * Creates a temporary canvas with an opaque background, draws the title
 * at the top, the chart canvas in the middle, and legend entries at the bottom.
 */
export async function captureChartAsBlob(
  container: HTMLElement
): Promise<Blob> {
  const canvas = findChartCanvas(container);
  if (!canvas) {
    throw new Error("No chart canvas found");
  }

  const bgColor = resolveOpaqueBackground(container);
  const textColor = isColorDark(bgColor) ? "#e0e0e0" : "#1a1a1a";

  // Determine pixel ratio (canvas pixel size vs CSS layout size)
  const cssWidth = canvas.getBoundingClientRect().width;
  const dpr = cssWidth > 0 ? canvas.width / cssWidth : 1;

  // Extract metadata from DOM
  const title = extractChartTitle(container);
  const legendEntries = extractLegendEntries(container);

  const chartW = canvas.width;
  const chartH = canvas.height;

  // --- Title metrics ---
  const titleFontSize = Math.round(13 * dpr);
  const titlePadY = Math.round(8 * dpr);
  const titleH = title ? titleFontSize + titlePadY * 2 : 0;

  // --- Legend metrics ---
  const legendFontSize = Math.round(11 * dpr);
  const legendItemH = Math.round(18 * dpr);
  const legendPadX = Math.round(16 * dpr);
  const legendPadY = Math.round(8 * dpr);
  const markerW = Math.round(14 * dpr);
  const markerH = Math.round(4 * dpr);
  const markerGap = Math.round(6 * dpr);
  const itemGap = Math.round(20 * dpr);

  // --- Legend layout (single-pass measurement) ---
  const legendLayouts: { entry: LegendEntry; x: number; y: number }[] = [];
  let legendRows = 0;
  let legendH = 0;

  if (legendEntries.length > 0) {
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d")!;
    measureCtx.font = `${legendFontSize}px ui-monospace, SFMono-Regular, monospace`;

    let x = legendPadX;
    legendRows = 1;
    const legendTop = titleH + chartH + legendPadY;

    for (const entry of legendEntries) {
      const itemW =
        markerW +
        markerGap +
        measureCtx.measureText(entry.label).width +
        itemGap;

      if (x + itemW > chartW - legendPadX && x > legendPadX) {
        legendRows++;
        x = legendPadX;
      }

      const y = legendTop + (legendRows - 1) * legendItemH + legendItemH / 2;
      legendLayouts.push({ entry, x, y });
      x += itemW;
    }
    legendH = legendPadY * 2 + legendRows * legendItemH;
  }

  // --- Compose final image ---
  const totalW = chartW;
  const totalH = titleH + chartH + legendH;

  const offscreen = document.createElement("canvas");
  offscreen.width = totalW;
  offscreen.height = totalH;
  const ctx = offscreen.getContext("2d")!;

  // Opaque background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, totalW, totalH);

  // Title
  if (title) {
    ctx.fillStyle = textColor;
    ctx.font = `600 ${titleFontSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, totalW / 2, titleH / 2, totalW - legendPadX * 2);
  }

  // Chart canvas
  ctx.drawImage(canvas, 0, titleH);

  // Legend (render from pre-computed layout)
  if (legendLayouts.length > 0) {
    ctx.font = `${legendFontSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (const { entry, x, y } of legendLayouts) {
      // Colored line marker (rounded pill shape like uPlot's legend)
      ctx.fillStyle = entry.color;
      const markerY = Math.round(y - markerH / 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, markerY, markerW, markerH, markerH / 2);
      } else {
        ctx.rect(x, markerY, markerW, markerH);
      }
      ctx.fill();

      // Label text
      ctx.fillStyle = textColor;
      ctx.fillText(entry.label, x + markerW + markerGap, y);
    }
  }

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
export async function copyChartToClipboard(
  container: HTMLElement
): Promise<void> {
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
