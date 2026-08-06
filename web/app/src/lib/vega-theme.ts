/**
 * Shared Vega chrome so every Vega view in the app themes identically.
 *
 * Extracted from the wandb custom-chart viewer when the sweep parallel-
 * coordinates chart needed the same treatment. The rule it encodes: theme the
 * *chrome* (axes, legend, title, background) and never the marks — a chart's
 * own colours are the author's choice and often carry meaning.
 */

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
    },
    title: { color: c.title, fontSize: 12 },
    view: { stroke: "transparent" },
  };
}
