import type uPlot from "uplot";

// ============================
// Fork Step Annotation Plugin
// ============================
//
// Draws a vertical dashed line at each fork step position on the chart.
// Used to visually indicate where inherited metrics end and the run's own
// data begins when viewing forked runs with inherited metrics enabled.

export interface ForkStepPluginOpts {
  /** Map of runId → forkStep for each forked run visible in the chart */
  forkSteps: Map<string, number>;
  theme: string;
}

export function forkStepPlugin(opts: ForkStepPluginOpts): uPlot.Plugin {
  const { forkSteps, theme } = opts;

  function draw(u: uPlot) {
    if (forkSteps.size === 0) return;

    const ctx = u.ctx;
    const { left, top, width, height } = u.bbox;
    const dpr = devicePixelRatio || 1;

    ctx.save();

    // Clip to plot area
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    // Collect unique fork step values
    const uniqueSteps = new Set(forkSteps.values());

    for (const step of uniqueSteps) {
      const xPos = Math.round(u.valToPos(step, "x", true));
      if (xPos < left || xPos > left + width) continue;

      // Vertical dashed line
      ctx.beginPath();
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.moveTo(xPos, top);
      ctx.lineTo(xPos, top + height);
      ctx.strokeStyle =
        theme === "dark" ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  return { hooks: { draw } };
}
