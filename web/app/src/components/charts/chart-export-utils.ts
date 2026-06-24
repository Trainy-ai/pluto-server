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
  /** Line-dash pattern in CSS-pixel units. Solid line if empty/undefined. */
  dash?: number[];
  /** Metric name for grouping in multi-metric exports. When present and >1
   *  distinct values appear across entries, the legend renders a section
   *  header per metric instead of suffixing every label. */
  metricName?: string;
}

/**
 * Caption rendered between the chart and the legend. Used to show the current
 * step + the list of runs being displayed on widgets that have no uPlot
 * legend of their own (histogram, bars) and on image widgets.
 */
export interface ExportCaption {
  /** e.g. "step 3960" or "step 3960 / 4000" */
  step?: string;
  /** Colored run chips. When >1 they're laid out inline with color dots. */
  runs?: RunChip[];
}

export interface RunChip {
  name: string;
  color: string;
}

/** Extract the chart title text from the container DOM */
function extractChartTitle(container: HTMLElement): string | null {
  const titleEl = container.querySelector<HTMLElement>(
    '[data-testid="chart-title"]'
  );
  return titleEl?.textContent?.trim() ?? null;
}

/**
 * Pull the run/step caption out of the widget DOM. Widget bodies stamp
 * `data-export-step` (a display string like "step 3960") and a JSON array
 * of `{name, color}` on `data-export-runs` so this helper can read them
 * at export time. Returns null when neither is present.
 */
export function extractCaptionFromDOM(
  container: HTMLElement,
): ExportCaption | null {
  // The stamping element might be the container itself (e.g. histogram
  // fullscreen where the ref points at the widget body directly) or a
  // descendant (e.g. dashboard widget-card where the ref is the wrapper).
  // querySelector only searches descendants, so check the container too.
  const stepEl = container.matches("[data-export-step]")
    ? container
    : container.querySelector("[data-export-step]");
  const step = stepEl?.getAttribute("data-export-step")?.trim() || undefined;

  let runs: RunChip[] | undefined;
  const runsEl = container.matches("[data-export-runs]")
    ? container
    : container.querySelector("[data-export-runs]");
  if (runsEl) {
    const raw = runsEl.getAttribute("data-export-runs");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          runs = parsed
            .filter(
              (r): r is RunChip =>
                !!r &&
                typeof r === "object" &&
                typeof (r as RunChip).name === "string" &&
                typeof (r as RunChip).color === "string",
            )
            .filter((r) => r.name.length > 0);
          if (runs.length === 0) runs = undefined;
        }
      } catch {
        // ignore malformed JSON
      }
    }
  }

  if (!step && !runs) return null;
  return { step, runs };
}

/**
 * Parse a dash pattern from a `data-dash="5,5"` attribute (comma-separated
 * positive numbers). Returns undefined for null / empty / all-invalid input
 * so the legend renderer falls back to a solid pill marker.
 */
export function parseDashAttr(attr: string | null): number[] | undefined {
  if (!attr) return undefined;
  const parts = attr
    .split(",")
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length > 0 ? parts : undefined;
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
      // Multi-metric line charts stamp data-dash + data-metric-name on the
      // row so the export can render visually-grouped sections per metric.
      // The inline legend keeps the compact "UPD-47" label; the export
      // groups entries by metricName and renders a section header before
      // each group rather than suffixing every label.
      const dash = parseDashAttr(row.getAttribute("data-dash"));
      const metricName = row.getAttribute("data-metric-name") || undefined;
      if (text) {
        entries.push({ label: text, color, dash, metricName });
      }
    }
  }

  return entries;
}

/**
 * Capture the chart as a PNG Blob, including the title, optional caption,
 * and legend. Layout is title → chart → caption → legend, top to bottom.
 *
 * The caption is rendered as a single inline strip showing the current step
 * (left-aligned) and a colored chip per run (continuing on the same row,
 * wrapping when needed). Used for widgets with custom canvases that don't
 * expose a uPlot legend — histograms, bars, and images.
 */
export async function captureChartAsBlob(
  container: HTMLElement,
  caption?: ExportCaption,
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
  // Wide marker so dash patterns repeat at least 2-3 times — at 14px wide
  // a [5,5] dash only shows ONE on/off cycle and a [1,3] dotted only shows
  // a single dot, which is misleading.
  const markerW = Math.round(34 * dpr);
  const markerH = Math.round(4 * dpr);
  const markerGap = Math.round(6 * dpr);
  const itemGap = Math.round(20 * dpr);
  // Section header (metric name) per multi-metric group + the gap between
  // a section and the next one. The header sits on its own row above the
  // entries; the gap is added BEFORE every group after the first so the
  // sections read as visually distinct blocks rather than one continuous
  // wrap of entries.
  const sectionHeaderFontSize = Math.round(12 * dpr);
  const sectionHeaderH = Math.round(22 * dpr);
  const sectionGap = Math.round(10 * dpr);

  // --- Caption metrics (step + run chips between chart and legend) ---
  const captionFontSize = Math.round(11 * dpr);
  const captionItemH = Math.round(18 * dpr);
  const captionDotSize = Math.round(8 * dpr);
  const captionDotGap = Math.round(6 * dpr);
  const captionStepGap = Math.round(16 * dpr);
  const captionChipGap = Math.round(14 * dpr);

  // --- Caption layout (single-pass measurement) ---
  interface CaptionItem {
    kind: "step" | "chip";
    text: string;
    color?: string;
    x: number;
    y: number;
    /** measured pixel width of the text portion only (no marker) */
    textW: number;
  }
  const captionItems: CaptionItem[] = [];
  let captionRows = 0;
  let captionH = 0;

  const hasCaption =
    !!caption && (!!caption.step || (caption.runs && caption.runs.length > 0));

  if (hasCaption) {
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d")!;
    measureCtx.font = `${captionFontSize}px ui-monospace, SFMono-Regular, monospace`;

    let x = legendPadX;
    captionRows = 1;
    const captionTop = titleH + chartH + legendPadY;

    if (caption!.step) {
      const text = caption!.step;
      const textW = measureCtx.measureText(text).width;
      const itemW = textW + captionStepGap;
      const y = captionTop + (captionRows - 1) * captionItemH + captionItemH / 2;
      captionItems.push({ kind: "step", text, x, y, textW });
      x += itemW;
    }

    if (caption!.runs) {
      for (const run of caption!.runs) {
        const text = run.name;
        const textW = measureCtx.measureText(text).width;
        const itemW = captionDotSize + captionDotGap + textW + captionChipGap;
        if (x + itemW > chartW - legendPadX && x > legendPadX) {
          captionRows++;
          x = legendPadX;
        }
        const y = captionTop + (captionRows - 1) * captionItemH + captionItemH / 2;
        captionItems.push({ kind: "chip", text, color: run.color, x, y, textW });
        x += itemW;
      }
    }

    captionH = legendPadY * 2 + captionRows * captionItemH;
  }

  // --- Legend layout (single-pass measurement) ---
  // The legend renders as either:
  //   - a flat horizontal wrap (single-metric / no metric attribution), or
  //   - a sequence of metric-grouped sections, each prefixed with a small
  //     metric-name header, when ≥2 distinct metricName values appear.
  // Each section flows its entries left-to-right and wraps to a new row
  // when the row width is exhausted. The next section begins on a fresh
  // row with extra `sectionGap` vertical space above its header.
  const legendLayouts: { entry: LegendEntry; x: number; y: number }[] = [];
  const sectionHeaderLayouts: { label: string; x: number; y: number }[] = [];
  let legendH = 0;

  if (legendEntries.length > 0) {
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d")!;

    // Group entries by metricName. Preserve first-appearance order so the
    // export mirrors the on-screen legend's series order.
    const distinctMetrics = new Set<string>();
    for (const e of legendEntries) {
      if (e.metricName) distinctMetrics.add(e.metricName);
    }
    const groupByMetric = distinctMetrics.size > 1;
    const groups: { metricName: string | undefined; entries: LegendEntry[] }[] = [];
    if (groupByMetric) {
      const seen = new Map<string, LegendEntry[]>();
      for (const e of legendEntries) {
        const key = e.metricName ?? "";
        if (!seen.has(key)) {
          seen.set(key, []);
          groups.push({ metricName: e.metricName, entries: seen.get(key)! });
        }
        seen.get(key)!.push(e);
      }
    } else {
      groups.push({ metricName: undefined, entries: legendEntries });
    }

    const legendTop = titleH + chartH + captionH + legendPadY;
    let yCursor = legendTop;
    let firstGroup = true;

    for (const group of groups) {
      if (!firstGroup) yCursor += sectionGap;
      firstGroup = false;

      // Section header (only when grouped)
      if (groupByMetric && group.metricName) {
        sectionHeaderLayouts.push({
          label: group.metricName,
          x: legendPadX,
          y: yCursor + sectionHeaderH / 2,
        });
        yCursor += sectionHeaderH;
      }

      // Wrap-flow this group's entries
      measureCtx.font = `${legendFontSize}px ui-monospace, SFMono-Regular, monospace`;
      let x = legendPadX;
      let groupRows = 1;
      for (const entry of group.entries) {
        const itemW =
          markerW +
          markerGap +
          measureCtx.measureText(entry.label).width +
          itemGap;
        if (x + itemW > chartW - legendPadX && x > legendPadX) {
          groupRows++;
          x = legendPadX;
        }
        const y = yCursor + (groupRows - 1) * legendItemH + legendItemH / 2;
        legendLayouts.push({ entry, x, y });
        x += itemW;
      }
      yCursor += groupRows * legendItemH;
    }

    legendH = (yCursor - legendTop) + legendPadY;
  }

  // --- Compose final image ---
  const totalW = chartW;
  const totalH = titleH + chartH + captionH + legendH;

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

  // Caption (step + run chips)
  if (captionItems.length > 0) {
    ctx.font = `${captionFontSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (const item of captionItems) {
      if (item.kind === "step") {
        ctx.fillStyle = textColor;
        ctx.fillText(item.text, item.x, item.y);
      } else {
        // Color dot
        ctx.fillStyle = item.color || textColor;
        ctx.beginPath();
        ctx.arc(
          item.x + captionDotSize / 2,
          item.y,
          captionDotSize / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        // Run name
        ctx.fillStyle = textColor;
        ctx.fillText(item.text, item.x + captionDotSize + captionDotGap, item.y);
      }
    }
  }

  // Section headers (metric names) — drawn first so they sit behind any
  // marker/text overlap (there shouldn't be any, but order-of-paint is the
  // safer default). Bolder + slightly larger than the entry font so groups
  // read as distinct blocks at a glance.
  if (sectionHeaderLayouts.length > 0) {
    ctx.font = `600 ${sectionHeaderFontSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.fillStyle = textColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const h of sectionHeaderLayouts) {
      ctx.fillText(h.label, h.x, h.y);
    }
  }

  // Legend (render from pre-computed layout)
  if (legendLayouts.length > 0) {
    ctx.font = `${legendFontSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (const { entry, x, y } of legendLayouts) {
      // Colored marker. For dashed series, draw a stroked line with
      // setLineDash so the marker visually matches the curve in the chart.
      // For solid series, keep the original rounded-pill fill.
      if (entry.dash && entry.dash.length > 0) {
        ctx.strokeStyle = entry.color;
        ctx.lineWidth = Math.max(markerH, Math.round(1.5 * dpr));
        // Compress the dash pattern so the marker shows ~2-3 cycles of any
        // pattern (otherwise long patterns like [16,6,4,6,4,6] only fit a
        // single barely-complete cycle in a ~34px-wide marker and become
        // visually indistinguishable from shorter patterns like [16,6,4,6]).
        // Mirrors the tooltip-plugin's `scaleDash(..., 0.4)` approach.
        const dashScale = 0.5;
        ctx.setLineDash(
          entry.dash.map((d) => Math.max(1, Math.round(d * dpr * dashScale))),
        );
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + markerW, y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = entry.color;
        const markerY = Math.round(y - markerH / 2);
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, markerY, markerW, markerH, markerH / 2);
        } else {
          ctx.rect(x, markerY, markerW, markerH);
        }
        ctx.fill();
      }

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
  container: HTMLElement,
  caption?: ExportCaption,
): Promise<void> {
  const blob = await captureChartAsBlob(container, caption);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
}

/** Download the chart image as a PNG file */
export async function downloadChartAsPng(
  container: HTMLElement,
  fileName: string,
  caption?: ExportCaption,
): Promise<void> {
  const blob = await captureChartAsBlob(container, caption);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Capture an image URL as a PNG with a run + step caption underneath.
 * Used by the image-widget download action — image widgets don't have a
 * canvas, so we paint the fetched image onto an offscreen canvas and
 * append the same caption strip as `captureChartAsBlob`. Single-image
 * only by design — image widgets export one image at a time.
 */
export async function downloadImageWithCaption(
  url: string,
  fileName: string,
  caption?: ExportCaption,
  container?: HTMLElement | null,
): Promise<void> {
  // Load the source image. Use crossOrigin so we can read the pixels
  // back into a canvas (object-store URLs need CORS-friendly fetch).
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });

  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  if (imgW === 0 || imgH === 0) {
    throw new Error("Image has zero dimensions");
  }

  // Caption metrics — match captureChartAsBlob so the visual look is
  // consistent across widget types. dpr=1 here since the source image
  // already has its pixel dimensions; we don't scale it for display.
  const dpr = 1;
  const padX = Math.round(16 * dpr);
  const padY = Math.round(8 * dpr);
  const captionFontSize = Math.round(11 * dpr);
  const captionItemH = Math.round(18 * dpr);
  const captionDotSize = Math.round(8 * dpr);
  const captionDotGap = Math.round(6 * dpr);
  const captionStepGap = Math.round(16 * dpr);
  const captionChipGap = Math.round(14 * dpr);

  const hasCaption =
    !!caption && (!!caption.step || (caption.runs && caption.runs.length > 0));

  // Background derived from the parent page so the caption strip blends in
  // with what the user saw on screen. Mirrors `captureChartAsBlob` (chart
  // PNG export) — without this match, a light-theme image download would
  // get a black caption band under a bright image. Fall back to
  // `document.body` when no container is passed (the inline download
  // button's lightbox-container ref is null until the modal is opened),
  // and finally to near-black when there's no DOM at all (test envs).
  const themeAnchor =
    container ?? (typeof document !== "undefined" ? document.body : null);
  const bgColor = themeAnchor ? resolveOpaqueBackground(themeAnchor) : "#0a0a0a";
  const textColor = isColorDark(bgColor) ? "#e0e0e0" : "#1a1a1a";

  // First measure the un-wrapped caption width so we can grow the output
  // canvas when the image itself is narrower than the text needs. Then run
  // the same layout pass with the chosen width for wrapping decisions.
  let captionMinW = imgW;
  if (hasCaption) {
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d")!;
    measureCtx.font = `${captionFontSize}px ui-monospace, SFMono-Regular, monospace`;
    let needed = padX * 2;
    if (caption!.step) {
      needed += measureCtx.measureText(caption!.step).width + captionStepGap;
    }
    if (caption!.runs) {
      for (const run of caption!.runs) {
        needed +=
          captionDotSize +
          captionDotGap +
          measureCtx.measureText(run.name).width +
          captionChipGap;
      }
    }
    captionMinW = Math.max(imgW, Math.ceil(needed));
  }
  const outputW = captionMinW;

  // Caption layout (single row + wrap when items overflow the output width)
  interface CaptionItem {
    kind: "step" | "chip";
    text: string;
    color?: string;
    x: number;
    y: number;
  }
  const captionItems: CaptionItem[] = [];
  let captionRows = 0;
  let captionH = 0;

  if (hasCaption) {
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d")!;
    measureCtx.font = `${captionFontSize}px ui-monospace, SFMono-Regular, monospace`;

    let x = padX;
    captionRows = 1;

    if (caption!.step) {
      const text = caption!.step;
      const textW = measureCtx.measureText(text).width;
      const y = (captionRows - 1) * captionItemH + captionItemH / 2;
      captionItems.push({ kind: "step", text, x, y });
      x += textW + captionStepGap;
    }

    if (caption!.runs) {
      for (const run of caption!.runs) {
        const text = run.name;
        const textW = measureCtx.measureText(text).width;
        const itemW = captionDotSize + captionDotGap + textW + captionChipGap;
        if (x + itemW > outputW - padX && x > padX) {
          captionRows++;
          x = padX;
        }
        const y = (captionRows - 1) * captionItemH + captionItemH / 2;
        captionItems.push({ kind: "chip", text, color: run.color, x, y });
        x += itemW;
      }
    }

    captionH = padY * 2 + captionRows * captionItemH;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = outputW;
  offscreen.height = imgH + captionH;
  const ctx = offscreen.getContext("2d")!;

  // Background fill for the caption strip below the image
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);

  // Center the image when the caption-driven canvas is wider than it
  const imgX = Math.max(0, Math.floor((outputW - imgW) / 2));
  ctx.drawImage(img, imgX, 0);

  if (captionItems.length > 0) {
    ctx.font = `${captionFontSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const captionTop = imgH + padY;
    for (const item of captionItems) {
      const drawY = captionTop + item.y;
      if (item.kind === "step") {
        ctx.fillStyle = textColor;
        ctx.fillText(item.text, item.x, drawY);
      } else {
        ctx.fillStyle = item.color || textColor;
        ctx.beginPath();
        ctx.arc(
          item.x + captionDotSize / 2,
          drawY,
          captionDotSize / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.fillText(item.text, item.x + captionDotSize + captionDotGap, drawY);
      }
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    offscreen.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Failed to encode image blob"));
    }, "image/png");
  });

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
