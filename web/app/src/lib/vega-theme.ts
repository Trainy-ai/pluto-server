/**
 * Shared Vega chrome so every Vega view in the app themes identically.
 *
 * Extracted from the wandb custom-chart viewer when the sweep parallel-
 * coordinates chart needed the same treatment. The rule it encodes: theme the
 * *chrome* (axes, legend, title, background) and never the marks — a chart's
 * own colours are the author's choice and often carry meaning.
 */

/**
 * Max legend rows before Vega truncates with an ellipsis entry. Sized so a
 * legend stays a sidebar rather than becoming the panel: at 10px rows this is
 * ~140px tall, comfortably inside the ~300px charts these presets render at.
 */
export const LEGEND_SYMBOL_LIMIT = 12;

const THEME_CHROME = {
  dark: { label: "#94a3b8", title: "#e2e8f0", line: "148,163,184" },
  light: { label: "#475569", title: "#0f172a", line: "71,85,105" },
} as const;

export function vegaConfig(theme: "dark" | "light") {
  const c = THEME_CHROME[theme];
  return {
    background: "transparent",
    font: "ui-monospace, monospace",
    axis: {
      labelColor: c.label,
      titleColor: c.label,
      gridColor: `rgba(${c.line},0.15)`,
      domainColor: `rgba(${c.line},0.3)`,
      tickColor: `rgba(${c.line},0.3)`,
      labelFontSize: 10,
      titleFontSize: 11,
    },
    legend: {
      labelColor: c.label,
      titleColor: c.label,
      labelFontSize: 10,
      titleFontSize: 11,
      // Deliberately no orient/columns override: wandb's presets place their
      // own legends (the scatter's two gradient bars only fit on the right),
      // and moving them broke that layout.
      //
      // Caps, though, are necessary. These legends carry one row per run, so a
      // 30-run selection pushed the legend to roughly half the panel and left
      // the chart itself unreadable. Vega reserves whatever the legend asks
      // for, so the chart only gets space back if the legend is bounded.
      //
      // symbolLimit truncates the rows and Vega appends an ellipsis entry, so
      // the truncation is visible rather than silent.
      //
      // Deliberately NOT also capping labelLimit: run labels look like
      // "custom-charts-all-r07 (BL7-764)" and differ only at the END, so
      // truncating their width renders every row identical and the legend
      // stops identifying anything. Height is what this cap buys back.
      symbolLimit: LEGEND_SYMBOL_LIMIT,
    },
    title: { color: c.title, fontSize: 12 },
    view: { stroke: "transparent" },
  };
}
