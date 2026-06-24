// Vertical color-scale legend for the distributions canvases. Shown
// on Ridgeline + Heatmap modes (Step mode doesn't encode anything in
// color). Renders as an HTML overlay inside the canvas-container's
// right gutter — same pattern as AxisOverlayLabels so it survives
// resize and is easy to tweak.
//
// Two kinds:
//   • "ridgeline" — color encodes ROW POSITION (oldest → newest step
//     for non-transposed; oldest → newest step also for transposed
//     since the row index threads through the same hue ramp). Labels
//     are the first / last step numbers in the rendered window.
//   • "heatmap" — color encodes CELL DENSITY (freq / globalMaxFreq).
//     Labels are 0 and globalMaxFreq.
//
// The gradient is sampled from the same formulas the canvas uses:
//   ridgeline → hue/lightness ramp from `ridgeColor`
//   heatmap   → lightness ramp from `densityColor`
// so the legend always matches what's painted regardless of theme or
// base color.

import { useMemo } from "react";

interface RidgelineLegendProps {
  kind: "ridgeline";
  baseColor: string;
  theme: "light" | "dark";
  firstStep: number;
  lastStep: number;
}

interface HeatmapLegendProps {
  kind: "heatmap";
  baseColor: string;
  theme: "light" | "dark";
  maxFreq: number;
  /** Optional axis-title for the colorbar (e.g. "Frequency" for the
   *  numeric histogram heatmap, "Value" for the categorical bars
   *  heatmap). Painted above the top numeric label. */
  title?: string;
}

type ColorLegendOverlayProps = RidgelineLegendProps | HeatmapLegendProps;

export function ColorLegendOverlay(props: ColorLegendOverlayProps) {
  const { gradient, topLabel, bottomLabel } = useMemo(
    () => buildLegendStops(props),
    [props],
  );
  const title = props.kind === "heatmap" ? props.title : undefined;
  return (
    <div
      data-testid={`color-legend-${props.kind}`}
      className="pointer-events-none absolute right-1.5 top-7 flex select-none flex-col items-end gap-1"
      style={{ height: "calc(100% - 64px)" }}
    >
      {title && (
        <span
          data-testid="color-legend-title"
          className="font-mono text-[10px] font-semibold leading-none text-muted-foreground"
        >
          {title}
        </span>
      )}
      <span className="font-mono text-[10px] font-medium leading-none text-muted-foreground">
        {topLabel}
      </span>
      <div
        className="min-h-0 flex-1"
        style={{
          width: 10,
          // `linear-gradient in srgb` pins CSS to RGB interpolation
          // explicitly so the bottom stop renders as a true black/white
          // instead of bleeding to a vivid edge pixel (Chrome's default
          // OKLab interpolation surfaces an artifact at the last stop
          // when the gradient terminates at pure black).
          background: gradient,
        }}
      />
      <span className="font-mono text-[10px] font-medium leading-none text-muted-foreground">
        {bottomLabel}
      </span>
    </div>
  );
}

// ─── Color sampling ────────────────────────────────────────────────

interface LegendBuild {
  gradient: string;
  topLabel: string;
  bottomLabel: string;
}

function buildLegendStops(props: ColorLegendOverlayProps): LegendBuild {
  if (props.kind === "ridgeline") {
    // Sample N stops along the ridge-color hue/lightness ramp. The
    // canvas paints the ridge at stepIdx=0 with the dark/cool end and
    // at the last step with the bright/warm end — invert so the
    // gradient reads top=newest, bottom=oldest, matching the legend's
    // top label = lastStep convention.
    const N = 6;
    const stops: string[] = [];
    for (let i = 0; i < N; i++) {
      // i=0 is the TOP of the gradient → lastStep (warm end).
      const stepIdx = N - 1 - i;
      stops.push(sampleRidgeFill(props.baseColor, stepIdx, N));
    }
    return {
      gradient: `linear-gradient(to bottom, ${stops.join(", ")})`,
      topLabel: formatStep(props.lastStep),
      bottomLabel: formatStep(props.firstStep),
    };
  }
  // Heatmap: gradient from high-density at top to low-density at
  // bottom. Sample directly from densityColor's lightness ramp.
  // Explicit percentage stops + `in srgb` interpolation hint pins each
  // band to a fixed slice and prevents the browser's default OKLab
  // gradient interpolation from surfacing a bright artifact pixel at
  // the t=0 end.
  const N = 6;
  const stops: string[] = [];
  for (let i = 0; i < N; i++) {
    const t = 1 - i / (N - 1);
    const pct = (i / (N - 1)) * 100;
    stops.push(
      `${sampleHeatmapColor(props.baseColor, t, props.theme)} ${pct.toFixed(2)}%`,
    );
  }
  return {
    gradient: `linear-gradient(in srgb to bottom, ${stops.join(", ")})`,
    topLabel: formatFreq(props.maxFreq),
    bottomLabel: "0",
  };
}

// Inlined to avoid importing canvas-only helpers (parseBaseColor etc).
// Mirrors the math in ridgeColor — keep in sync if that changes.
function sampleRidgeFill(
  baseColor: string,
  stepIdx: number,
  totalSteps: number,
): string {
  const { h, s, l } = parseHsl(baseColor);
  const denom = totalSteps > 1 ? totalSteps - 1 : 1;
  const t = totalSteps > 1 ? stepIdx / denom : 0;
  const fillH = h + 8 - 38 * t;
  const fillS = Math.min(100, s + 14);
  const fillL = clamp(l - 38 + t * 33, 6, 92);
  return `hsl(${fillH.toFixed(2)}, ${fillS.toFixed(2)}%, ${fillL.toFixed(2)}%)`;
}

// Theme-aware interpolation matching the heatmap canvases. Done in
// linear RGB so the gradient endpoints are EXACT black/white and the
// gradient doesn't surface a near-zero HSL artifact at the low stop:
//   • dark theme: lerp(black, baseColor)  → low=(0,0,0), high=baseColor
//   • light theme: lerp(white, baseColor) → low=(255,255,255), high=baseColor
function sampleHeatmapColor(
  baseColor: string,
  t: number,
  theme: "dark" | "light",
): string {
  const rgb = parseToRgb(baseColor);
  if (theme === "dark") {
    const r = Math.round(rgb.r * t);
    const g = Math.round(rgb.g * t);
    const b = Math.round(rgb.b * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const r = Math.round(255 - (255 - rgb.r) * t);
  const g = Math.round(255 - (255 - rgb.g) * t);
  const b = Math.round(255 - (255 - rgb.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// HSL → RGB shim built on the existing parseHsl helper. Converts any
// color string we expect (hex, rgb, hsl) to {r, g, b} ∈ [0, 255].
function parseToRgb(color: string): { r: number; g: number; b: number } {
  // Hex passes through hsl path via parseHsl → hslToRgb below.
  const { h, s, l } = parseHsl(color);
  return hslToRgb(h, s, l);
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sat = s / 100;
  const lit = l / 100;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = lit - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

// Quick base-color → HSL parser. Handles hsl(), hex (#rgb / #rrggbb),
// and rgb(). Falls back to a neutral grey on parse failure so we never
// throw for an unexpected base color.
function parseHsl(color: string): { h: number; s: number; l: number } {
  const m = color.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?/i);
  if (m) return { h: +m[1], s: +m[2], l: +m[3] };
  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16) / 255;
      const g = parseInt(h.slice(2, 4), 16) / 255;
      const b = parseInt(h.slice(4, 6), 16) / 255;
      return rgbToHsl(r, g, b);
    }
  }
  const rgb = color.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i,
  );
  if (rgb) {
    return rgbToHsl(+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255);
  }
  return { h: 220, s: 30, l: 50 };
}

function rgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function formatStep(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return v.toFixed(0);
}

function formatFreq(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v < 10) return v.toFixed(1);
  if (v < 1000) return v.toFixed(0);
  return v.toExponential(1);
}
