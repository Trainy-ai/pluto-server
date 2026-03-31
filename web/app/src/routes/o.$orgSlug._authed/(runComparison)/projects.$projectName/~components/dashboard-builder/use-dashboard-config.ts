/**
 * Pure state transformation functions for dashboard config mutations.
 *
 * Each function takes a DashboardViewConfig and returns a new one (immutable).
 * These are extracted from dashboard-builder.tsx for testability and reuse.
 */

import {
  generateId,
  type DashboardViewConfig,
  type Section,
  type Widget,
  type ChartWidgetConfig,
} from "../../~types/dashboard-types";

// ─── Section operations ───────────────────────────────────────────────

export function addSection(
  config: DashboardViewConfig,
  name: string,
  dynamicPattern?: string,
  dynamicPatternMode?: "search" | "regex"
): DashboardViewConfig {
  const newSection: Section = {
    id: `section-${generateId()}`,
    name,
    collapsed: false,
    widgets: [],
    dynamicPattern,
    dynamicPatternMode,
  };
  return { ...config, sections: [...config.sections, newSection] };
}

export function deleteSection(
  config: DashboardViewConfig,
  sectionId: string
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.filter((s) => s.id !== sectionId),
  };
}

export function updateSection(
  config: DashboardViewConfig,
  sectionId: string,
  section: Section
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) => (s.id === sectionId ? section : s)),
  };
}

export function toggleSectionCollapse(
  config: DashboardViewConfig,
  sectionId: string
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s
    ),
  };
}

export function reorderSections(
  config: DashboardViewConfig,
  fromIndex: number,
  toIndex: number
): DashboardViewConfig {
  const sections = [...config.sections];
  const [moved] = sections.splice(fromIndex, 1);
  sections.splice(toIndex, 0, moved);
  return { ...config, sections };
}

export function toggleAllSections(
  config: DashboardViewConfig
): DashboardViewConfig {
  const allCollapsed = config.sections.every((s) => s.collapsed);
  return {
    ...config,
    sections: config.sections.map((s) => ({ ...s, collapsed: !allCollapsed })),
  };
}

// ─── Widget operations ────────────────────────────────────────────────

export function addWidget(
  config: DashboardViewConfig,
  sectionId: string,
  widget: Omit<Widget, "id">
): DashboardViewConfig {
  const newWidget: Widget = { ...widget, id: `widget-${generateId()}` };
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === sectionId ? { ...s, widgets: [...s.widgets, newWidget] } : s
    ),
  };
}

export function deleteWidget(
  config: DashboardViewConfig,
  sectionId: string,
  widgetId: string
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === sectionId
        ? { ...s, widgets: s.widgets.filter((w) => w.id !== widgetId) }
        : s
    ),
  };
}

export function updateWidgets(
  config: DashboardViewConfig,
  sectionId: string,
  widgets: Widget[]
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === sectionId ? { ...s, widgets } : s
    ),
  };
}

export function updateWidgetScale(
  config: DashboardViewConfig,
  widgetId: string,
  axis: "x" | "y",
  value: boolean
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) => ({
      ...s,
      widgets: s.widgets.map((w) => {
        if (w.id !== widgetId || w.type !== "chart") return w;
        const cfg = w.config as ChartWidgetConfig;
        const scaleValue = value ? "log" : "linear";
        return {
          ...w,
          config: {
            ...cfg,
            ...(axis === "x"
              ? { xAxisScale: scaleValue }
              : { yAxisScale: scaleValue }),
          },
        };
      }),
    })),
  };
}

// ─── Copy/paste ───────────────────────────────────────────────────────

/** Returns a deep-cloned copy of the widget (ready for pasting). */
export function copyWidget(widget: Widget): Widget {
  return structuredClone(widget);
}

export function pasteWidget(
  config: DashboardViewConfig,
  sectionId: string,
  copiedWidget: Widget
): DashboardViewConfig {
  const newWidget: Widget = {
    ...copiedWidget,
    id: `widget-${generateId()}`,
    config: structuredClone(copiedWidget.config),
    layout: { ...copiedWidget.layout, y: 9999 },
  };
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === sectionId ? { ...s, widgets: [...s.widgets, newWidget] } : s
    ),
  };
}

// ─── Config utilities ─────────────────────────────────────────────────

export function sanitizeConfig(
  config: DashboardViewConfig
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((widget) => ({
        ...widget,
        layout: {
          ...widget.layout,
          x: Number.isFinite(widget.layout.x) ? widget.layout.x : 0,
          y: Number.isFinite(widget.layout.y) ? widget.layout.y : 9999,
          w: Number.isFinite(widget.layout.w) ? widget.layout.w : 6,
          h: Number.isFinite(widget.layout.h) ? widget.layout.h : 4,
        },
      })),
    })),
  };
}

export function handleEditWidgetSave(
  config: DashboardViewConfig,
  sectionId: string,
  editingWidgetId: string,
  widgetData: Omit<Widget, "id">
): DashboardViewConfig {
  const updatedWidget: Widget = { ...widgetData, id: editingWidgetId };
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            widgets: s.widgets.map((w) =>
              w.id === editingWidgetId ? updatedWidget : w
            ),
          }
        : s
    ),
  };
}
