/**
 * Panel names for the copilot's page context — "what charts am I looking at".
 *
 * Deliberately reads the *saved* dashboard config and the grouped metric
 * list, both of which the pages already hold. Glob and dynamic sections are
 * resolved per widget, deep inside the render tree and against their own
 * server queries, so their expanded names are not available here; a dynamic
 * section is reported by its pattern instead of guessing at its matches.
 *
 * Shapes are structural rather than imported from the route's dashboard
 * types: this keeps a lib file free of a dependency on a route tree, and the
 * two callers pass the real types.
 */

export interface PanelWidgetLike {
  type: string;
  config: {
    title?: string;
    metrics?: string[];
    files?: string[];
  };
}

export interface PanelSectionLike {
  name: string;
  widgets: PanelWidgetLike[];
  dynamicPattern?: string;
  children?: PanelSectionLike[];
}

/**
 * The selected dashboard, but only once the fetch for *that* id has landed.
 *
 * `useDashboardView` keeps the previously fetched view as placeholder data
 * while it loads the next one, so during a switch its data is a different
 * dashboard than the id in the URL. Publishing from that pairs the new id
 * with the old name and panels — the model would be told to read one
 * dashboard while being described another. Returning undefined instead means
 * the page omits panels until they are known, rather than claiming none.
 */
export function resolvedDashboardView<T extends { id: string }>(
  viewId: string | null | undefined,
  view: T | undefined | null,
): T | undefined {
  if (!viewId || !view || view.id !== viewId) return undefined;
  return view;
}

/** Metrics named on one widget before the list is truncated for display. */
const MAX_METRICS_PER_WIDGET = 3;

/**
 * Panel labels for a saved dashboard, in display order: each section's own
 * widgets, then its child sections. A dynamic section contributes its
 * pattern, marked as such, since the panels it expands to depend on which
 * metrics the selected runs logged.
 */
export function dashboardPanelNames(
  sections: readonly PanelSectionLike[] | undefined,
): string[] {
  if (!sections) return [];
  const names: string[] = [];
  for (const section of sections) {
    for (const widget of section.widgets ?? []) {
      names.push(widgetLabel(widget));
    }
    if (section.dynamicPattern) {
      names.push(`${section.dynamicPattern} (dynamic section “${section.name}”)`);
    }
    if (section.children) {
      names.push(...dashboardPanelNames(section.children));
    }
  }
  return names;
}

/**
 * Metric names from the All-metrics view, group by group. This is every
 * metric the view can render for the selected runs; the user's search box
 * narrows what is on screen further, and that filter lives inside the
 * metrics display rather than here.
 */
export function groupedMetricNames(
  grouped: Record<string, { metrics: Array<{ name: string }> }> | undefined,
): string[] {
  if (!grouped) return [];
  const names: string[] = [];
  for (const group of Object.values(grouped)) {
    for (const metric of group.metrics ?? []) {
      names.push(metric.name);
    }
  }
  return names;
}

function widgetLabel(widget: PanelWidgetLike): string {
  const title = widget.config?.title?.trim();
  if (title) return title;

  const sources = widget.config?.metrics?.length
    ? widget.config.metrics
    : widget.config?.files;
  if (sources?.length) {
    const shown = sources.slice(0, MAX_METRICS_PER_WIDGET).join(" + ");
    return sources.length > MAX_METRICS_PER_WIDGET
      ? `${shown} +${sources.length - MAX_METRICS_PER_WIDGET}`
      : shown;
  }
  // A widget with neither a title nor sources (an empty chart the user just
  // added, or a python panel) is still on screen, so it still counts.
  return widget.type;
}
