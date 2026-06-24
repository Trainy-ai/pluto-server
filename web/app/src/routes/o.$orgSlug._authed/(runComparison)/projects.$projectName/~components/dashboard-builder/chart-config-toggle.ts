import type { ChartWidgetConfig } from "../../~types/dashboard-types";

// Pure toggle logic for chart-widget chip add/remove. Lives outside the
// React component so it's directly unit-testable and so the chip-X
// callback routes through the same path as the search-list click.
//
// Chart widgets host only line metrics — `{bars}` rollups and numeric
// histograms moved into the distributions widget, so toggling here is
// straightforward set membership on `config.metrics[]`.
export function toggleChartConfigChip(
  config: Partial<ChartWidgetConfig>,
  value: string,
): Partial<ChartWidgetConfig> {
  const current = config.metrics ?? [];
  if (current.includes(value)) {
    return { ...config, metrics: current.filter((m) => m !== value) };
  }
  return { ...config, metrics: [...current, value] };
}
