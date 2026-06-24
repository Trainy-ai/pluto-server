// Always-on axis-title overlay for the distributions canvases (numeric
// histogram + categorical bars × Step / Ridgeline / Heatmap modes).
// Renders two absolutely-positioned spans inside the canvas-container —
// Y title at top-left above where the topmost tick number sits, X title
// centered along the bottom edge under the X tick row. The canvas-
// container is `relative` and pointer-events on the labels are off so
// hover / drag behaviour is unaffected.
//
// Anchored to widget pixels (not canvas pixels), so it doesn't depend
// on the inner drawer's layout constants — survives any later margin
// tweaks. Tradeoff: not rasterized into the PNG export (canvas-only).
// Follow-up if export coverage is needed: thread strings through the
// drawer signatures and paint via canvas fillText.

interface AxisOverlayLabelsProps {
  xLabel: string;
  yLabel: string;
}

export function AxisOverlayLabels({ xLabel, yLabel }: AxisOverlayLabelsProps) {
  return (
    <>
      <span
        data-testid="axis-y-label"
        className="pointer-events-none absolute left-1.5 top-0.5 select-none font-mono text-[10px] font-semibold leading-none text-muted-foreground"
      >
        {yLabel}
      </span>
      <span
        data-testid="axis-x-label"
        className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 select-none font-mono text-[10px] font-semibold leading-none text-muted-foreground"
      >
        {xLabel}
      </span>
    </>
  );
}
