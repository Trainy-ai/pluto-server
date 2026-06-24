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
  type HistogramWidgetConfig,
  type HistogramViewMode,
  type HistogramDepthAxis,
  type FileGroupWidgetConfig,
  type DistributionsWidgetConfig,
  type DistributionsEntry,
} from "../../~types/dashboard-types";

// ─── Helpers ─────────────────────────────────────────────────────────

/** Whether a section is a folder (has children array). */
export function isFolder(section: Section): boolean {
  return Array.isArray(section.children);
}

// ─── Migration shims ────────────────────────────────────────────────
//
// Applied at config load time. Three legacy shapes get rewritten into
// the new `distributions` widget type:
//
//   1. Chart widget carrying `bars` field         → chart + distributions
//   2. File-group with `categoricalPrefixes`      → file-group + distributions
//   3. Standalone `histogram` widget              → distributions (1 entry)
//
// Each is idempotent — re-running on an already-migrated config is a
// no-op. We don't touch on-disk JSON; the next save through the normal
// flow naturally writes the migrated shape because every widget gets
// serialized from the in-memory (post-migration) state.

// Legacy shapes — TypeScript can't see these on the current schemas
// (they were stripped), so we describe them locally for the migration.
interface LegacyBarsEntry {
  prefix: string;
  viewMode?: HistogramViewMode;
  depthAxis?: HistogramDepthAxis;
  binRange?: { start: number; end: number };
  ignoreOutliers?: boolean;
  stepsOnX?: boolean;
}
interface LegacyChartWithBars extends ChartWidgetConfig {
  bars?: LegacyBarsEntry | LegacyBarsEntry[];
}
interface LegacyFileGroupWithBars extends FileGroupWidgetConfig {
  categoricalPrefixes?: string[];
  viewModes?: Record<string, HistogramViewMode>;
  depthAxes?: Record<string, HistogramDepthAxis>;
  binRanges?: Record<string, { start: number; end: number }>;
  ignoreOutliers?: Record<string, boolean>;
  stepsOnX?: Record<string, boolean>;
}

function barsEntryFromLegacy(
  raw: LegacyBarsEntry,
  overrides?: {
    viewMode?: HistogramViewMode;
    depthAxis?: HistogramDepthAxis;
    binRange?: { start: number; end: number };
    ignoreOutliers?: boolean;
    stepsOnX?: boolean;
  },
): Extract<DistributionsEntry, { kind: "bars" }> {
  return {
    kind: "bars",
    prefix: raw.prefix,
    viewMode: overrides?.viewMode ?? raw.viewMode ?? "ridgeline",
    depthAxis: overrides?.depthAxis ?? raw.depthAxis ?? "step",
    binRange: overrides?.binRange ?? raw.binRange,
    ignoreOutliers: overrides?.ignoreOutliers ?? raw.ignoreOutliers ?? true,
    stepsOnX: overrides?.stepsOnX ?? raw.stepsOnX ?? false,
  };
}

// 1. Chart widget with `bars` field → chart (metrics-only, if any) + distributions
function migrateChartWithBars(widget: Widget): Widget[] {
  if (widget.type !== "chart") return [widget];
  const cfg = widget.config as LegacyChartWithBars;
  const barsRaw = cfg.bars;
  if (!barsRaw) return [widget];
  const barsArr: LegacyBarsEntry[] = Array.isArray(barsRaw)
    ? barsRaw
    : [barsRaw];
  if (barsArr.length === 0) return [widget];

  const out: Widget[] = [];
  const hasLineMetrics = !!cfg.metrics && cfg.metrics.length > 0;
  if (hasLineMetrics) {
    // Strip the bars field; keep every other chart-config field intact.
    const { bars: _stripped, ...rest } = cfg;
    void _stripped;
    const cleaned: ChartWidgetConfig = rest;
    out.push({ ...widget, config: cleaned });
  }

  const entries: DistributionsEntry[] = barsArr.map((b) =>
    barsEntryFromLegacy(b),
  );
  const distCfg: DistributionsWidgetConfig = { entries };
  if (cfg.title) distCfg.title = cfg.title;
  // When the cleaned chart sibling shares this slot, shift the new
  // distributions widget DOWN by the chart's height so they don't
  // overlap on read (react-grid-layout's vertical compact usually
  // resolves overlaps, but the explicit y-shift is a defensive guard).
  const distLayout = hasLineMetrics
    ? { ...widget.layout, y: widget.layout.y + (widget.layout.h ?? 4) }
    : widget.layout;
  out.push({
    id: `${widget.id}-distributions`,
    type: "distributions",
    config: distCfg,
    layout: distLayout,
  });
  return out;
}

// 2. File-group with `categoricalPrefixes` → file-group (image/video/audio
// only, if any) + distributions widget (one bars entry per prefix).
function migrateFileGroupWithBars(widget: Widget): Widget[] {
  if (widget.type !== "file-group") return [widget];
  const cfg = widget.config as LegacyFileGroupWithBars;
  const prefixes = cfg.categoricalPrefixes;
  if (!prefixes || prefixes.length === 0) return [widget];

  const out: Widget[] = [];
  const fileGroupHasFiles = !!cfg.files && cfg.files.length > 0;
  if (fileGroupHasFiles) {
    // Clean file-group: keep files[], drop every histogram/bars map.
    const cleaned: FileGroupWidgetConfig = { files: cfg.files };
    if (cfg.title) cleaned.title = cfg.title;
    out.push({ ...widget, config: cleaned });
  }

  const entries: DistributionsEntry[] = prefixes.map((prefix) =>
    barsEntryFromLegacy(
      { prefix },
      {
        viewMode: cfg.viewModes?.[prefix],
        depthAxis: cfg.depthAxes?.[prefix],
        binRange: cfg.binRanges?.[prefix],
        ignoreOutliers: cfg.ignoreOutliers?.[prefix],
        stepsOnX: cfg.stepsOnX?.[prefix],
      },
    ),
  );
  const distCfg: DistributionsWidgetConfig = { entries };
  if (cfg.title) distCfg.title = cfg.title;
  // Same defensive y-shift as migrateChartWithBars: when the cleaned
  // file-group sibling is also pushed, place the new distributions
  // widget below it instead of on top.
  const distLayout = fileGroupHasFiles
    ? { ...widget.layout, y: widget.layout.y + (widget.layout.h ?? 4) }
    : widget.layout;
  out.push({
    id: `${widget.id}-distributions`,
    type: "distributions",
    config: distCfg,
    layout: distLayout,
  });
  return out;
}

// 3. Standalone `histogram` widget → distributions (one histogram entry).
// One-to-one replacement; ID reused since the widget is being re-typed.
function migrateStandaloneHistogram(widget: Widget): Widget[] {
  if (widget.type !== "histogram") return [widget];
  const cfg = widget.config as HistogramWidgetConfig;
  if (!cfg.metric) return [widget];
  const entry: DistributionsEntry = {
    kind: "histogram",
    metric: cfg.metric,
    viewMode: cfg.viewMode ?? "ridgeline",
    ignoreOutliers: cfg.ignoreOutliers ?? true,
    stepsOnX: cfg.stepsOnX ?? false,
  };
  const distCfg: DistributionsWidgetConfig = { entries: [entry] };
  if (cfg.title) distCfg.title = cfg.title;
  return [
    {
      id: widget.id,
      type: "distributions",
      config: distCfg,
      layout: widget.layout,
    },
  ];
}

function migrateSection(section: Section): Section {
  const widgets = (section.widgets ?? [])
    .flatMap(migrateChartWithBars)
    .flatMap(migrateFileGroupWithBars)
    .flatMap(migrateStandaloneHistogram);
  const children = section.children?.map(migrateSection);
  return { ...section, widgets, children };
}

/**
 * Normalize a freshly-loaded dashboard config against current widget
 * shapes. Idempotent — running twice does nothing once every widget is
 * already in its post-migration shape. Apply at every point where
 * `view.config` enters component state.
 */
/**
 * Save-time auto-lift for legacy file-group histograms.
 *
 * At read time we can't tell which file entries inside a file-group
 * widget are HISTOGRAM-type — types come from a backend query. The
 * FileGroupWidget renderer reports each widget's HISTOGRAM file names
 * up to dashboard-builder once the types resolve;
 * dashboard-builder caches them in a `widgetId → histogramFiles` map
 * and feeds the map to this transform just before the next save
 * mutation.
 *
 * For each entry:
 *   • If a file-group widget contains both HISTOGRAM files and other
 *     entries (images / videos / audio / console), the histogram names
 *     get removed from its `files[]`, and a sibling distributions
 *     widget is appended after it carrying one histogram entry per
 *     name. The file-group keeps its original ID + layout.
 *   • If a file-group widget contains ONLY HISTOGRAM files, the
 *     whole widget is replaced in-place by a distributions widget at
 *     the same id + layout — no row collision.
 *
 * Dynamic-section widgets are never in the map (FileGroupWidget there
 * gets `onHistogramsDetected = undefined`), so this is a no-op for
 * them. Idempotent: running with an empty map or no matching widgets
 * returns the input unchanged.
 */
export function liftFileGroupHistograms(
  config: DashboardViewConfig,
  detectedHistograms: Record<string, string[]>,
): DashboardViewConfig {
  if (Object.keys(detectedHistograms).length === 0) return config;

  let mutated = false;
  const sections = config.sections.map((section) => {
    let sectionMutated = false;
    const widgets: Widget[] = [];
    for (const w of section.widgets) {
      if (w.type !== "file-group") {
        widgets.push(w);
        continue;
      }
      const histograms = detectedHistograms[w.id];
      if (!histograms || histograms.length === 0) {
        widgets.push(w);
        continue;
      }
      const cfg = w.config as FileGroupWidgetConfig;
      const remainingFiles = (cfg.files ?? []).filter(
        (f) => !histograms.includes(f),
      );
      const distEntries: DistributionsEntry[] = histograms.map((metric) => ({
        kind: "histogram",
        metric,
        viewMode: "ridgeline",
        ignoreOutliers: true,
        stepsOnX: false,
      }));
      sectionMutated = true;

      if (remainingFiles.length === 0) {
        // File-group held only histograms — replace in place.
        const distCfg: DistributionsWidgetConfig = { entries: distEntries };
        if (cfg.title) distCfg.title = cfg.title;
        widgets.push({
          id: w.id,
          type: "distributions",
          config: distCfg,
          layout: w.layout,
        });
      } else {
        // Keep the file-group with non-histogram entries; spawn a
        // sibling distributions widget for the lifted histograms. The
        // sibling sits one row below so the auto-pack on save lays
        // them out without overlap.
        widgets.push({
          ...w,
          config: { ...cfg, files: remainingFiles },
        });
        widgets.push({
          id: `${w.id}-lifted-distributions`,
          type: "distributions",
          config: { entries: distEntries },
          layout: {
            ...w.layout,
            y: w.layout.y + (w.layout.h ?? 4),
          },
        });
      }
    }
    if (!sectionMutated) return section;
    mutated = true;
    return { ...section, widgets };
  });
  return mutated ? { ...config, sections } : config;
}

export function migrateDashboardConfig(
  config: DashboardViewConfig,
): DashboardViewConfig {
  return {
    ...config,
    sections: config.sections.map(migrateSection),
  };
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
  dynamicPatternMode?: "search" | "regex",
  dynamicGroupBy?: string[],
  dynamicGroupPrefixes?: string[],
  dynamicGroupPrefixRegex?: string,
): DashboardViewConfig {
  const newSection: Section = {
    id: `section-${generateId()}`,
    name,
    collapsed: false,
    widgets: [],
    dynamicPattern,
    dynamicPatternMode,
    dynamicGroupBy: dynamicGroupBy && dynamicGroupBy.length > 0 ? dynamicGroupBy : undefined,
    dynamicGroupPrefixes:
      dynamicGroupPrefixes && dynamicGroupPrefixes.length > 0 ? dynamicGroupPrefixes : undefined,
    dynamicGroupPrefixRegex:
      dynamicGroupPrefixRegex && dynamicGroupPrefixRegex.trim().length > 0
        ? dynamicGroupPrefixRegex.trim()
        : undefined,
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
  dynamicGroupBy?: string[],
  dynamicGroupPrefixes?: string[],
  dynamicGroupPrefixRegex?: string,
): DashboardViewConfig {
  const newChild: Section = {
    id: `section-${generateId()}`,
    name,
    collapsed: false,
    widgets: [],
    dynamicPattern,
    dynamicPatternMode,
    dynamicGroupBy: dynamicGroupBy && dynamicGroupBy.length > 0 ? dynamicGroupBy : undefined,
    dynamicGroupPrefixes:
      dynamicGroupPrefixes && dynamicGroupPrefixes.length > 0 ? dynamicGroupPrefixes : undefined,
    dynamicGroupPrefixRegex:
      dynamicGroupPrefixRegex && dynamicGroupPrefixRegex.trim().length > 0
        ? dynamicGroupPrefixRegex.trim()
        : undefined,
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

/**
 * Set a per-metric Step/Ridgeline/Heatmap viewMode on a section's
 * `histogramViewModes` map (applies to both numeric histogram entries
 * AND `{bars}` prefix entries inside dynamic sections — both share this
 * map). Dynamic widgets aren't stored in `section.widgets[]`, so user
 * view preferences have to live on the section itself. Field name kept
 * for on-disk backwards-compat.
 */
export function updateSectionHistogramViewMode(
  config: DashboardViewConfig,
  sectionId: string,
  metric: string,
  mode: HistogramViewMode,
): DashboardViewConfig {
  const visit = (sections: Section[]): Section[] =>
    sections.map((s) => {
      if (s.id === sectionId) {
        return {
          ...s,
          histogramViewModes: { ...(s.histogramViewModes ?? {}), [metric]: mode },
        };
      }
      if (s.children) {
        return { ...s, children: visit(s.children) };
      }
      return s;
    });
  return { ...config, sections: visit(config.sections) };
}

/**
 * Set the viewMode for ONE histogram file inside a file-group widget. Each
 * file in the group tracks its own mode independently via the `viewModes`
 * map (keyed by file name).
 */
// File-group / standalone-histogram per-entry mutators removed —
// histograms and {bars} entries live in distributions widgets now. The
// distributions-entry mutators below replace them; migration handles
// legacy on-disk shapes.

// (The distributions-widget per-entry patches live just below.)
// entries (and mix them with line metrics).

// ─── Distributions widget — per-entry patches ───────────────────────
//
// All five updaters target an entry by INDEX into config.entries[].
// Index-keying lets the widget hold repeated prefixes or metrics
// without ambiguity, and lines up with the renderer (which passes the
// index back from each panel's change handler).

function patchDistributionsEntry(
  config: DashboardViewConfig,
  widgetId: string,
  index: number,
  patch: (entry: DistributionsEntry) => DistributionsEntry,
): DashboardViewConfig {
  return {
    ...config,
    sections: mapAllWidgets(config.sections, (w) => {
      if (w.id !== widgetId || w.type !== "distributions") return w;
      const cfg = w.config as DistributionsWidgetConfig;
      if (!cfg.entries || index < 0 || index >= cfg.entries.length) return w;
      const next = cfg.entries.map((e, i) => (i === index ? patch(e) : e));
      return { ...w, config: { ...cfg, entries: next } };
    }),
  };
}

export function updateWidgetDistributionsEntryViewMode(
  config: DashboardViewConfig,
  widgetId: string,
  index: number,
  viewMode: HistogramViewMode,
): DashboardViewConfig {
  return patchDistributionsEntry(config, widgetId, index, (e) => ({
    ...e,
    viewMode,
  }));
}

export function updateWidgetDistributionsEntryDepthAxis(
  config: DashboardViewConfig,
  widgetId: string,
  index: number,
  depthAxis: HistogramDepthAxis,
): DashboardViewConfig {
  return patchDistributionsEntry(config, widgetId, index, (e) =>
    // Only bars entries have a depth axis; histogram entries get the
    // patch as a no-op so callers don't have to discriminate.
    e.kind === "bars" ? { ...e, depthAxis } : e,
  );
}

export function updateWidgetDistributionsEntryBinRange(
  config: DashboardViewConfig,
  widgetId: string,
  index: number,
  range: { start: number; end: number },
): DashboardViewConfig {
  return patchDistributionsEntry(config, widgetId, index, (e) =>
    e.kind === "bars" ? { ...e, binRange: range } : e,
  );
}

export function updateWidgetDistributionsEntryIgnoreOutliers(
  config: DashboardViewConfig,
  widgetId: string,
  index: number,
  next: boolean,
): DashboardViewConfig {
  return patchDistributionsEntry(config, widgetId, index, (e) => ({
    ...e,
    ignoreOutliers: next,
  }));
}

export function updateWidgetDistributionsEntryStepsOnX(
  config: DashboardViewConfig,
  widgetId: string,
  index: number,
  next: boolean,
): DashboardViewConfig {
  return patchDistributionsEntry(config, widgetId, index, (e) => ({
    ...e,
    stepsOnX: next,
  }));
}

/** Find a widget by id anywhere in the config (top-level sections + folder
 *  children). Returns undefined when the id doesn't match — happens
 *  briefly between a delete and the consumer noticing the id is gone.
 *  Used by the fullscreen dialog to look up the LIVE widget from the
 *  current config on every render, instead of holding a stale snapshot
 *  captured when the dialog opened. */
export function findWidgetById(
  config: DashboardViewConfig,
  widgetId: string,
): Widget | undefined {
  for (const s of config.sections) {
    const hit = s.widgets.find((w) => w.id === widgetId);
    if (hit) return hit;
    for (const c of s.children ?? []) {
      const childHit = c.widgets.find((w) => w.id === widgetId);
      if (childHit) return childHit;
    }
  }
  return undefined;
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
