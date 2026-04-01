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

// ─── Helpers ─────────────────────────────────────────────────────────

/** Whether a section is a folder (has children array). */
export function isFolder(section: Section): boolean {
  return Array.isArray(section.children);
}

/**
 * Map over widgets in a specific section, including child sections of folders.
 * If parentId is provided, the target is a child section within that parent.
 */
function mapSectionWidgets(
  sections: Section[],
  sectionId: string,
  fn: (widgets: Widget[]) => Widget[],
  parentId?: string,
): Section[] {
  if (parentId) {
    return sections.map((s) => {
      if (s.id !== parentId || !s.children) return s;
      return {
        ...s,
        children: s.children.map((child) =>
          child.id === sectionId ? { ...child, widgets: fn(child.widgets) } : child
        ),
      };
    });
  }
  return sections.map((s) =>
    s.id === sectionId ? { ...s, widgets: fn(s.widgets) } : s
  );
}

/**
 * Map over ALL widgets across all sections and their children.
 * Used by global operations like resetAllWidgetBounds, sanitizeConfig, etc.
 */
function mapAllWidgets(
  sections: Section[],
  fn: (widget: Widget) => Widget,
): Section[] {
  return sections.map((s) => ({
    ...s,
    widgets: s.widgets.map(fn),
    ...(s.children
      ? {
          children: s.children.map((child) => ({
            ...child,
            widgets: child.widgets.map(fn),
          })),
        }
      : {}),
  }));
}

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

/** Add a new folder section (a section with an empty children array). */
export function addFolder(
  config: DashboardViewConfig,
  name: string,
): DashboardViewConfig {
  const newFolder: Section = {
    id: `section-${generateId()}`,
    name,
    collapsed: false,
    widgets: [],
    children: [],
  };
  return { ...config, sections: [...config.sections, newFolder] };
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

// ─── Child section (folder) operations ───────────────────────────────

/** Add a child section inside a folder. */
export function addChildSection(
  config: DashboardViewConfig,
  parentId: string,
  name: string,
  dynamicPattern?: string,
  dynamicPatternMode?: "search" | "regex",
): DashboardViewConfig {
  const newChild: Section = {
    id: `section-${generateId()}`,
    name,
    collapsed: false,
    widgets: [],
    dynamicPattern,
    dynamicPatternMode,
  };
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === parentId && s.children
        ? { ...s, children: [...s.children, newChild] }
        : s
    ),
  };
}

/** Delete a child section from a folder. */
export function deleteChildSection(
  config: DashboardViewConfig,
  parentId: string,
  childId: string,
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === parentId && s.children
        ? { ...s, children: s.children.filter((c) => c.id !== childId) }
        : s
    ),
  };
}

/** Update a child section within a folder. */
export function updateChildSection(
  config: DashboardViewConfig,
  parentId: string,
  childId: string,
  child: Section,
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === parentId && s.children
        ? { ...s, children: s.children.map((c) => (c.id === childId ? child : c)) }
        : s
    ),
  };
}

/** Toggle collapse of a child section within a folder. */
export function toggleChildSectionCollapse(
  config: DashboardViewConfig,
  parentId: string,
  childId: string,
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.id === parentId && s.children
        ? {
            ...s,
            children: s.children.map((c) =>
              c.id === childId ? { ...c, collapsed: !c.collapsed } : c
            ),
          }
        : s
    ),
  };
}

/** Reorder child sections within a folder. */
export function reorderChildSections(
  config: DashboardViewConfig,
  parentId: string,
  fromIndex: number,
  toIndex: number,
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map((s) => {
      if (s.id !== parentId || !s.children) return s;
      const children = [...s.children];
      const [moved] = children.splice(fromIndex, 1);
      children.splice(toIndex, 0, moved);
      return { ...s, children };
    }),
  };
}

/** Toggle collapse of all child sections across all folders. */
export function toggleAllChildSections(
  config: DashboardViewConfig,
): DashboardViewConfig {
  const allChildren = config.sections.flatMap((s) => s.children ?? []);
  if (allChildren.length === 0) return config;
  const allCollapsed = allChildren.every((c) => c.collapsed);
  return {
    ...config,
    sections: config.sections.map((s) =>
      s.children
        ? { ...s, children: s.children.map((c) => ({ ...c, collapsed: !allCollapsed })) }
        : s
    ),
  };
}

// ─── Widget operations ────────────────────────────────────────────────

/**
 * Add a widget to a section. If parentId is provided, the target is a child
 * section within that parent folder.
 */
export function addWidget(
  config: DashboardViewConfig,
  sectionId: string,
  widget: Omit<Widget, "id">,
  parentId?: string,
): DashboardViewConfig {
  const newWidget: Widget = { ...widget, id: `widget-${generateId()}` };
  return {
    ...config,
    sections: mapSectionWidgets(
      config.sections,
      sectionId,
      (widgets) => [...widgets, newWidget],
      parentId,
    ),
  };
}

/**
 * Delete a widget from a section. If parentId is provided, the target is a
 * child section within that parent folder.
 */
export function deleteWidget(
  config: DashboardViewConfig,
  sectionId: string,
  widgetId: string,
  parentId?: string,
): DashboardViewConfig {
  return {
    ...config,
    sections: mapSectionWidgets(
      config.sections,
      sectionId,
      (widgets) => widgets.filter((w) => w.id !== widgetId),
      parentId,
    ),
  };
}

/**
 * Replace all widgets in a section. If parentId is provided, the target is a
 * child section within that parent folder.
 */
export function updateWidgets(
  config: DashboardViewConfig,
  sectionId: string,
  widgets: Widget[],
  parentId?: string,
): DashboardViewConfig {
  return {
    ...config,
    sections: mapSectionWidgets(
      config.sections,
      sectionId,
      () => widgets,
      parentId,
    ),
  };
}

/** Toggle x/y axis scale on a chart widget (searches all sections and children). */
export function updateWidgetScale(
  config: DashboardViewConfig,
  widgetId: string,
  axis: "x" | "y",
  value: boolean
): DashboardViewConfig {
  return {
    ...config,
    sections: mapAllWidgets(config.sections, (w) => {
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
  };
}

// ─── Copy/paste ───────────────────────────────────────────────────────

/** Returns a deep-cloned copy of the widget (ready for pasting). */
export function copyWidget(widget: Widget): Widget {
  return structuredClone(widget);
}

/**
 * Paste a copied widget into a section. If parentId is provided, the target
 * is a child section within that parent folder.
 */
export function pasteWidget(
  config: DashboardViewConfig,
  sectionId: string,
  copiedWidget: Widget,
  parentId?: string,
): DashboardViewConfig {
  const newWidget: Widget = {
    ...copiedWidget,
    id: `widget-${generateId()}`,
    config: structuredClone(copiedWidget.config),
    layout: { ...copiedWidget.layout, y: 9999 },
  };
  return {
    ...config,
    sections: mapSectionWidgets(
      config.sections,
      sectionId,
      (widgets) => [...widgets, newWidget],
      parentId,
    ),
  };
}

// ─── Config utilities ─────────────────────────────────────────────────

/** Sanitize all widget layouts across all sections and children. */
export function sanitizeConfig(
  config: DashboardViewConfig
): DashboardViewConfig {
  const sanitizeWidget = (widget: Widget): Widget => ({
    ...widget,
    layout: {
      ...widget.layout,
      x: Number.isFinite(widget.layout.x) ? widget.layout.x : 0,
      y: Number.isFinite(widget.layout.y) ? widget.layout.y : 9999,
      w: Number.isFinite(widget.layout.w) ? widget.layout.w : 6,
      h: Number.isFinite(widget.layout.h) ? widget.layout.h : 4,
    },
  });
  return {
    ...config,
    sections: mapAllWidgets(config.sections, sanitizeWidget),
  };
}

/**
 * Update a widget after editing. If parentId is provided, the target is a
 * child section within that parent folder.
 */
export function handleEditWidgetSave(
  config: DashboardViewConfig,
  sectionId: string,
  editingWidgetId: string,
  widgetData: Omit<Widget, "id">,
  parentId?: string,
): DashboardViewConfig {
  const updatedWidget: Widget = { ...widgetData, id: editingWidgetId };
  return {
    ...config,
    sections: mapSectionWidgets(
      config.sections,
      sectionId,
      (widgets) => widgets.map((w) => (w.id === editingWidgetId ? updatedWidget : w)),
      parentId,
    ),
  };
}

// ─── Move operations ─────────────────────────────────────────────────

/** Location of a widget or section within the config tree. */
export interface SectionLocation {
  sectionId: string;
  parentId?: string; // folder ID if inside a folder's children
}

/**
 * Move a widget from one section to another (possibly across folders).
 * The widget is removed from the source and appended at the bottom of the target.
 */
export function moveWidget(
  config: DashboardViewConfig,
  widgetId: string,
  from: SectionLocation,
  to: SectionLocation,
): DashboardViewConfig {
  // Find the widget in the source section
  let widget: Widget | undefined;

  const findWidget = (sections: Section[]): Widget | undefined => {
    for (const s of sections) {
      if (s.id === from.sectionId) {
        return s.widgets.find((w) => w.id === widgetId);
      }
      for (const c of s.children ?? []) {
        if (c.id === from.sectionId) {
          return c.widgets.find((w) => w.id === widgetId);
        }
      }
    }
    return undefined;
  };

  widget = findWidget(config.sections);
  if (!widget) return config;

  // Remove from source, add to target (placed at bottom)
  const movedWidget: Widget = { ...widget, layout: { ...widget.layout, y: 9999 } };

  let result = {
    ...config,
    sections: mapSectionWidgets(
      config.sections,
      from.sectionId,
      (widgets) => widgets.filter((w) => w.id !== widgetId),
      from.parentId,
    ),
  };

  result = {
    ...result,
    sections: mapSectionWidgets(
      result.sections,
      to.sectionId,
      (widgets) => [...widgets, movedWidget],
      to.parentId,
    ),
  };

  return result;
}

/**
 * Move a top-level section into a folder (becomes a child).
 * Removes it from the top level and appends to the folder's children.
 */
export function moveSectionIntoFolder(
  config: DashboardViewConfig,
  sectionId: string,
  folderId: string,
): DashboardViewConfig {
  const section = config.sections.find((s) => s.id === sectionId);
  if (!section) return config;
  const folder = config.sections.find((s) => s.id === folderId);
  if (!folder || !folder.children) return config;

  // Don't allow moving a folder into another folder
  if (section.children) return config;

  // Remove children from the moved section (can't nest deeper)
  const { children: _, ...leafSection } = section;

  return {
    ...config,
    sections: config.sections
      .filter((s) => s.id !== sectionId)
      .map((s) =>
        s.id === folderId
          ? { ...s, children: [...(s.children ?? []), leafSection] }
          : s
      ),
  };
}

/**
 * Move a child section out of a folder to the top level.
 * Removes it from the folder's children and appends at the top level.
 */
/**
 * Move a child section out of a folder to the top level.
 * If targetSectionId and position are provided, inserts relative to that section.
 * Otherwise appends at the end.
 */
export function moveSectionOutOfFolder(
  config: DashboardViewConfig,
  sectionId: string,
  folderId: string,
  targetSectionId?: string,
  position?: "above" | "below",
): DashboardViewConfig {
  const folder = config.sections.find((s) => s.id === folderId);
  if (!folder || !folder.children) return config;

  const child = folder.children.find((c) => c.id === sectionId);
  if (!child) return config;

  // Remove from folder
  const sectionsWithoutChild = config.sections.map((s) =>
    s.id === folderId
      ? { ...s, children: s.children!.filter((c) => c.id !== sectionId) }
      : s
  );

  // Insert at position relative to target, or append at end
  if (targetSectionId && position) {
    const targetIndex = sectionsWithoutChild.findIndex((s) => s.id === targetSectionId);
    if (targetIndex !== -1) {
      const insertAt = position === "below" ? targetIndex + 1 : targetIndex;
      const result = [...sectionsWithoutChild];
      result.splice(insertAt, 0, child);
      return { ...config, sections: result };
    }
  }

  return { ...config, sections: [...sectionsWithoutChild, child] };
}

/**
 * Move a child section from one folder to another.
 */
export function moveSectionBetweenFolders(
  config: DashboardViewConfig,
  sectionId: string,
  fromFolderId: string,
  toFolderId: string,
): DashboardViewConfig {
  const fromFolder = config.sections.find((s) => s.id === fromFolderId);
  if (!fromFolder?.children) return config;

  const child = fromFolder.children.find((c) => c.id === sectionId);
  if (!child) return config;

  return {
    ...config,
    sections: config.sections.map((s) => {
      if (s.id === fromFolderId) {
        return { ...s, children: s.children!.filter((c) => c.id !== sectionId) };
      }
      if (s.id === toFolderId && s.children) {
        return { ...s, children: [...s.children, child] };
      }
      return s;
    }),
  };
}

/**
 * Move a section into a folder at a specific position (relative to a child).
 * Removes from source location, inserts into the folder's children at the
 * position determined by targetChildId and position ("above" or "below").
 */
export function moveSectionIntoFolderAtPosition(
  config: DashboardViewConfig,
  sectionId: string,
  fromParentId: string | undefined,
  toFolderId: string,
  targetChildId: string,
  position: "above" | "below",
): DashboardViewConfig {
  // Find the section to move
  let section: Section | undefined;
  if (fromParentId) {
    const parent = config.sections.find((s) => s.id === fromParentId);
    section = parent?.children?.find((c) => c.id === sectionId);
  } else {
    section = config.sections.find((s) => s.id === sectionId);
  }
  if (!section) return config;
  // Don't allow moving folders into folders
  if (section.children) return config;

  const { children: _, ...leafSection } = section;

  // Remove from source
  let result = { ...config };
  if (fromParentId) {
    result = {
      ...result,
      sections: result.sections.map((s) =>
        s.id === fromParentId && s.children
          ? { ...s, children: s.children.filter((c) => c.id !== sectionId) }
          : s
      ),
    };
  } else {
    result = { ...result, sections: result.sections.filter((s) => s.id !== sectionId) };
  }

  // Insert into target folder at the right position
  result = {
    ...result,
    sections: result.sections.map((s) => {
      if (s.id !== toFolderId || !s.children) return s;
      const children = [...s.children];
      const targetIndex = children.findIndex((c) => c.id === targetChildId);
      if (targetIndex === -1) {
        // Target child not found, append
        children.push(leafSection);
      } else {
        const insertAt = position === "below" ? targetIndex + 1 : targetIndex;
        children.splice(insertAt, 0, leafSection);
      }
      return { ...s, children };
    }),
  };

  return result;
}

/**
 * Collect all non-dynamic sections/subsections as move targets.
 * Returns a flat list with labels and location info.
 */
export function getMoveTargets(
  config: DashboardViewConfig,
  excludeSectionId?: string,
  excludeParentId?: string,
): { label: string; location: SectionLocation; isFolder: boolean }[] {
  const targets: { label: string; location: SectionLocation; isFolder: boolean }[] = [];

  for (const section of config.sections) {
    // Skip dynamic sections
    if (section.dynamicPattern) continue;

    const isSame = section.id === excludeSectionId && !excludeParentId;
    if (!isSame) {
      targets.push({
        label: section.name,
        location: { sectionId: section.id },
        isFolder: isFolder(section),
      });
    }

    for (const child of section.children ?? []) {
      if (child.dynamicPattern) continue;
      const isSameChild = child.id === excludeSectionId && section.id === excludeParentId;
      if (!isSameChild) {
        targets.push({
          label: `${section.name} / ${child.name}`,
          location: { sectionId: child.id, parentId: section.id },
          isFolder: false,
        });
      }
    }
  }

  return targets;
}
