import { describe, it, expect, vi } from "vitest";
import {
  addSection,
  addFolder,
  deleteSection,
  updateSection,
  toggleSectionCollapse,
  toggleAllSections,
  reorderSections,
  addChildSection,
  deleteChildSection,
  updateChildSection,
  toggleChildSectionCollapse,
  reorderChildSections,
  toggleAllChildSections,
  isFolder,
  addWidget,
  deleteWidget,
  updateWidgets,
  updateWidgetScale,
  copyWidget,
  pasteWidget,
  sanitizeConfig,
  handleEditWidgetSave,
} from "../use-dashboard-config";
import type { DashboardViewConfig, Section, Widget } from "../../../~types/dashboard-types";

// Helper to create a minimal config for testing
function createTestConfig(sections: Section[] = []): DashboardViewConfig {
  return {
    version: 1,
    sections,
    settings: { gridCols: 12, rowHeight: 80, compactType: "vertical" },
  };
}

function createTestWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: "widget-1",
    type: "chart",
    config: {
      metrics: ["train/loss"],
      xAxis: "step",
      yAxisScale: "linear",
      xAxisScale: "linear",
      aggregation: "LAST",
      showOriginal: false,
    },
    layout: { x: 0, y: 0, w: 6, h: 4 },
    ...overrides,
  };
}

function createTestSection(overrides: Partial<Section> = {}): Section {
  return {
    id: "section-1",
    name: "Test Section",
    collapsed: false,
    widgets: [],
    ...overrides,
  };
}

describe("addSection", () => {
  it("adds a new static section to config", () => {
    const config = createTestConfig();
    const result = addSection(config, "New Section");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe("New Section");
    expect(result.sections[0].collapsed).toBe(false);
    expect(result.sections[0].widgets).toEqual([]);
    expect(result.sections[0].id).toMatch(/^section-/);
  });

  it("adds a dynamic section with pattern", () => {
    const config = createTestConfig();
    const result = addSection(config, "Dynamic", "train/*", "search");
    expect(result.sections[0].dynamicPattern).toBe("train/*");
    expect(result.sections[0].dynamicPatternMode).toBe("search");
  });

  it("preserves existing sections", () => {
    const config = createTestConfig([createTestSection({ id: "existing" })]);
    const result = addSection(config, "New");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].id).toBe("existing");
  });
});

describe("deleteSection", () => {
  it("removes section by id", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A" }),
      createTestSection({ id: "s2", name: "B" }),
    ]);
    const result = deleteSection(config, "s1");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe("s2");
  });

  it("does nothing when id not found", () => {
    const config = createTestConfig([createTestSection({ id: "s1" })]);
    const result = deleteSection(config, "nonexistent");
    expect(result.sections).toHaveLength(1);
  });
});

describe("updateSection", () => {
  it("replaces section with matching id", () => {
    const original = createTestSection({ id: "s1", name: "Old" });
    const config = createTestConfig([original]);
    const updated = { ...original, name: "New Name" };
    const result = updateSection(config, "s1", updated);
    expect(result.sections[0].name).toBe("New Name");
  });

  it("does not affect other sections", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A" }),
      createTestSection({ id: "s2", name: "B" }),
    ]);
    const updated = createTestSection({ id: "s1", name: "Updated" });
    const result = updateSection(config, "s1", updated);
    expect(result.sections[1].name).toBe("B");
  });
});

describe("toggleSectionCollapse", () => {
  it("toggles collapsed from false to true", () => {
    const config = createTestConfig([createTestSection({ id: "s1", collapsed: false })]);
    const result = toggleSectionCollapse(config, "s1");
    expect(result.sections[0].collapsed).toBe(true);
  });

  it("toggles collapsed from true to false", () => {
    const config = createTestConfig([createTestSection({ id: "s1", collapsed: true })]);
    const result = toggleSectionCollapse(config, "s1");
    expect(result.sections[0].collapsed).toBe(false);
  });
});

describe("toggleAllSections", () => {
  it("collapses all when not all are collapsed", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", collapsed: true }),
      createTestSection({ id: "s2", collapsed: false }),
    ]);
    const result = toggleAllSections(config);
    expect(result.sections.every((s) => s.collapsed)).toBe(true);
  });

  it("expands all when all are collapsed", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", collapsed: true }),
      createTestSection({ id: "s2", collapsed: true }),
    ]);
    const result = toggleAllSections(config);
    expect(result.sections.every((s) => !s.collapsed)).toBe(true);
  });
});

describe("reorderSections", () => {
  it("moves a section forward (0 → 2)", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A" }),
      createTestSection({ id: "s2", name: "B" }),
      createTestSection({ id: "s3", name: "C" }),
    ]);
    const result = reorderSections(config, 0, 2);
    expect(result.sections.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
  });

  it("moves a section backward (2 → 0)", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A" }),
      createTestSection({ id: "s2", name: "B" }),
      createTestSection({ id: "s3", name: "C" }),
    ]);
    const result = reorderSections(config, 2, 0);
    expect(result.sections.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("no-op when fromIndex equals toIndex", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A" }),
      createTestSection({ id: "s2", name: "B" }),
    ]);
    const result = reorderSections(config, 1, 1);
    expect(result.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("preserves section data after reorder", () => {
    const widget = createTestWidget({ id: "w1" });
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A", widgets: [widget] }),
      createTestSection({ id: "s2", name: "B" }),
    ]);
    const result = reorderSections(config, 0, 1);
    expect(result.sections[1].id).toBe("s1");
    expect(result.sections[1].widgets).toHaveLength(1);
    expect(result.sections[1].widgets[0].id).toBe("w1");
  });

  it("does not mutate the original config", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", name: "A" }),
      createTestSection({ id: "s2", name: "B" }),
    ]);
    const originalIds = config.sections.map((s) => s.id);
    reorderSections(config, 0, 1);
    expect(config.sections.map((s) => s.id)).toEqual(originalIds);
  });
});

describe("addWidget", () => {
  it("adds widget to the correct section", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1" }),
      createTestSection({ id: "s2" }),
    ]);
    const widget = createTestWidget();
    const { id: _, ...widgetWithoutId } = widget;
    const result = addWidget(config, "s1", widgetWithoutId);
    expect(result.sections[0].widgets).toHaveLength(1);
    expect(result.sections[1].widgets).toHaveLength(0);
    expect(result.sections[0].widgets[0].id).toMatch(/^widget-/);
  });

  it("preserves existing widgets in section", () => {
    const existing = createTestWidget({ id: "existing" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [existing] }),
    ]);
    const newWidget = createTestWidget({ id: "new" });
    const { id: _, ...widgetWithoutId } = newWidget;
    const result = addWidget(config, "s1", widgetWithoutId);
    expect(result.sections[0].widgets).toHaveLength(2);
    expect(result.sections[0].widgets[0].id).toBe("existing");
  });
});

describe("deleteWidget", () => {
  it("removes widget from section", () => {
    const widget = createTestWidget({ id: "w1" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = deleteWidget(config, "s1", "w1");
    expect(result.sections[0].widgets).toHaveLength(0);
  });

  it("does not affect other sections", () => {
    const w1 = createTestWidget({ id: "w1" });
    const w2 = createTestWidget({ id: "w2" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [w1] }),
      createTestSection({ id: "s2", widgets: [w2] }),
    ]);
    const result = deleteWidget(config, "s1", "w1");
    expect(result.sections[1].widgets).toHaveLength(1);
  });
});

describe("updateWidgets", () => {
  it("replaces all widgets in a section", () => {
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [createTestWidget()] }),
    ]);
    const newWidgets = [createTestWidget({ id: "new1" }), createTestWidget({ id: "new2" })];
    const result = updateWidgets(config, "s1", newWidgets);
    expect(result.sections[0].widgets).toHaveLength(2);
    expect(result.sections[0].widgets[0].id).toBe("new1");
  });
});

describe("updateWidgetScale", () => {
  it("sets y-axis to log scale", () => {
    const widget = createTestWidget({ id: "w1" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = updateWidgetScale(config, "w1", "y", true);
    expect((result.sections[0].widgets[0].config as any).yAxisScale).toBe("log");
  });

  it("sets x-axis to log scale", () => {
    const widget = createTestWidget({ id: "w1" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = updateWidgetScale(config, "w1", "x", true);
    expect((result.sections[0].widgets[0].config as any).xAxisScale).toBe("log");
  });

  it("sets back to linear scale", () => {
    const widget = createTestWidget({
      id: "w1",
      config: { metrics: ["loss"], xAxis: "step", yAxisScale: "log", xAxisScale: "log", aggregation: "LAST", showOriginal: false },
    });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = updateWidgetScale(config, "w1", "y", false);
    expect((result.sections[0].widgets[0].config as any).yAxisScale).toBe("linear");
  });

  it("ignores non-chart widgets", () => {
    const widget = createTestWidget({ id: "w1", type: "histogram", config: { metric: "loss" } });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = updateWidgetScale(config, "w1", "y", true);
    // Should not change - histogram has no yAxisScale
    expect(result.sections[0].widgets[0].config).toEqual({ metric: "loss" });
  });
});

describe("copyWidget + pasteWidget", () => {
  it("paste creates new widget with new id in target section", () => {
    const original = createTestWidget({ id: "w-original" });
    const copied = copyWidget(original);
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [] }),
    ]);
    const result = pasteWidget(config, "s1", copied);
    expect(result.sections[0].widgets).toHaveLength(1);
    expect(result.sections[0].widgets[0].id).not.toBe("w-original");
    expect(result.sections[0].widgets[0].id).toMatch(/^widget-/);
    expect(result.sections[0].widgets[0].layout.y).toBe(9999);
  });

  it("paste preserves original widget config via deep clone", () => {
    const original = createTestWidget({
      id: "w-original",
      config: { metrics: ["train/loss", "eval/loss"], xAxis: "step", yAxisScale: "linear", xAxisScale: "linear", aggregation: "LAST", showOriginal: false },
    });
    const copied = copyWidget(original);
    const config = createTestConfig([createTestSection({ id: "s1" })]);
    const result = pasteWidget(config, "s1", copied);
    expect((result.sections[0].widgets[0].config as any).metrics).toEqual(["train/loss", "eval/loss"]);
  });
});

describe("sanitizeConfig", () => {
  it("replaces non-finite numbers in layout", () => {
    const widget = createTestWidget({
      id: "w1",
      layout: { x: Infinity, y: NaN, w: -Infinity, h: 4 },
    });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = sanitizeConfig(config);
    expect(result.sections[0].widgets[0].layout.x).toBe(0);
    expect(result.sections[0].widgets[0].layout.y).toBe(9999);
    expect(result.sections[0].widgets[0].layout.w).toBe(6);
    expect(result.sections[0].widgets[0].layout.h).toBe(4);
  });

  it("preserves valid layout values", () => {
    const widget = createTestWidget({
      id: "w1",
      layout: { x: 3, y: 2, w: 6, h: 4 },
    });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const result = sanitizeConfig(config);
    expect(result.sections[0].widgets[0].layout).toEqual({ x: 3, y: 2, w: 6, h: 4 });
  });
});

describe("handleEditWidgetSave", () => {
  it("updates existing widget config in correct section", () => {
    const widget = createTestWidget({ id: "w1" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [widget] }),
    ]);
    const newData: Omit<Widget, "id"> = {
      type: "chart",
      config: { metrics: ["new/metric"], xAxis: "step", yAxisScale: "linear", xAxisScale: "linear", aggregation: "AVG", showOriginal: true },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const result = handleEditWidgetSave(config, "s1", "w1", newData);
    expect(result.sections[0].widgets[0].id).toBe("w1");
    expect((result.sections[0].widgets[0].config as any).metrics).toEqual(["new/metric"]);
    expect((result.sections[0].widgets[0].config as any).aggregation).toBe("AVG");
  });

  it("preserves other widgets in the section", () => {
    const w1 = createTestWidget({ id: "w1" });
    const w2 = createTestWidget({ id: "w2" });
    const config = createTestConfig([
      createTestSection({ id: "s1", widgets: [w1, w2] }),
    ]);
    const newData: Omit<Widget, "id"> = {
      type: "chart",
      config: { metrics: ["updated"], xAxis: "step", yAxisScale: "linear", xAxisScale: "linear", aggregation: "LAST", showOriginal: false },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const result = handleEditWidgetSave(config, "s1", "w1", newData);
    expect(result.sections[0].widgets).toHaveLength(2);
    expect(result.sections[0].widgets[1].id).toBe("w2");
  });
});

// ─── Folder (children) operations ────────────────────────────────────

function createTestFolder(overrides: Partial<Section> = {}): Section {
  return {
    id: "folder-1",
    name: "Test Folder",
    collapsed: false,
    widgets: [],
    children: [],
    ...overrides,
  };
}

describe("isFolder", () => {
  it("returns true for sections with children array", () => {
    expect(isFolder(createTestFolder())).toBe(true);
  });

  it("returns false for regular sections", () => {
    expect(isFolder(createTestSection())).toBe(false);
  });

  it("returns true for folders with non-empty children", () => {
    expect(isFolder(createTestFolder({ children: [createTestSection()] }))).toBe(true);
  });
});

describe("addFolder", () => {
  it("adds a folder with empty children array", () => {
    const config = createTestConfig();
    const result = addFolder(config, "My Folder");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe("My Folder");
    expect(result.sections[0].children).toEqual([]);
    expect(result.sections[0].widgets).toEqual([]);
  });

  it("preserves existing sections", () => {
    const config = createTestConfig([createTestSection({ id: "s1" })]);
    const result = addFolder(config, "Folder");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].id).toBe("s1");
  });
});

describe("addChildSection", () => {
  it("adds a child section to a folder", () => {
    const config = createTestConfig([createTestFolder({ id: "f1" })]);
    const result = addChildSection(config, "f1", "Child");
    expect(result.sections[0].children).toHaveLength(1);
    expect(result.sections[0].children![0].name).toBe("Child");
    expect(result.sections[0].children![0].id).toMatch(/^section-/);
  });

  it("adds a dynamic child section", () => {
    const config = createTestConfig([createTestFolder({ id: "f1" })]);
    const result = addChildSection(config, "f1", "Dynamic", "train/*", "search");
    expect(result.sections[0].children![0].dynamicPattern).toBe("train/*");
    expect(result.sections[0].children![0].dynamicPatternMode).toBe("search");
  });

  it("does not affect non-folder sections", () => {
    const config = createTestConfig([createTestSection({ id: "s1" })]);
    const result = addChildSection(config, "s1", "Child");
    expect(result.sections[0].children).toBeUndefined();
  });

  it("preserves existing children", () => {
    const existing = createTestSection({ id: "child-1", name: "Existing" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [existing] })]);
    const result = addChildSection(config, "f1", "New");
    expect(result.sections[0].children).toHaveLength(2);
    expect(result.sections[0].children![0].id).toBe("child-1");
  });
});

describe("deleteChildSection", () => {
  it("removes a child section from a folder", () => {
    const child = createTestSection({ id: "child-1" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const result = deleteChildSection(config, "f1", "child-1");
    expect(result.sections[0].children).toHaveLength(0);
  });

  it("preserves other children", () => {
    const c1 = createTestSection({ id: "c1" });
    const c2 = createTestSection({ id: "c2" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [c1, c2] })]);
    const result = deleteChildSection(config, "f1", "c1");
    expect(result.sections[0].children).toHaveLength(1);
    expect(result.sections[0].children![0].id).toBe("c2");
  });
});

describe("updateChildSection", () => {
  it("replaces a child section", () => {
    const child = createTestSection({ id: "c1", name: "Old" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const updated = { ...child, name: "New Name" };
    const result = updateChildSection(config, "f1", "c1", updated);
    expect(result.sections[0].children![0].name).toBe("New Name");
  });
});

describe("toggleChildSectionCollapse", () => {
  it("toggles a child section collapsed state", () => {
    const child = createTestSection({ id: "c1", collapsed: false });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const result = toggleChildSectionCollapse(config, "f1", "c1");
    expect(result.sections[0].children![0].collapsed).toBe(true);
  });
});

describe("reorderChildSections", () => {
  it("reorders children within a folder", () => {
    const c1 = createTestSection({ id: "c1" });
    const c2 = createTestSection({ id: "c2" });
    const c3 = createTestSection({ id: "c3" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [c1, c2, c3] })]);
    const result = reorderChildSections(config, "f1", 0, 2);
    expect(result.sections[0].children!.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
  });

  it("does not affect other folders", () => {
    const config = createTestConfig([
      createTestFolder({ id: "f1", children: [createTestSection({ id: "c1" })] }),
      createTestFolder({ id: "f2", children: [createTestSection({ id: "c2" })] }),
    ]);
    const result = reorderChildSections(config, "f1", 0, 0);
    expect(result.sections[1].children![0].id).toBe("c2");
  });
});

describe("toggleAllChildSections", () => {
  it("collapses all children when not all collapsed", () => {
    const config = createTestConfig([
      createTestFolder({
        id: "f1",
        children: [
          createTestSection({ id: "c1", collapsed: true }),
          createTestSection({ id: "c2", collapsed: false }),
        ],
      }),
    ]);
    const result = toggleAllChildSections(config);
    expect(result.sections[0].children!.every((c) => c.collapsed)).toBe(true);
  });

  it("expands all children when all collapsed", () => {
    const config = createTestConfig([
      createTestFolder({
        id: "f1",
        children: [
          createTestSection({ id: "c1", collapsed: true }),
          createTestSection({ id: "c2", collapsed: true }),
        ],
      }),
    ]);
    const result = toggleAllChildSections(config);
    expect(result.sections[0].children!.every((c) => !c.collapsed)).toBe(true);
  });

  it("works across multiple folders", () => {
    const config = createTestConfig([
      createTestFolder({
        id: "f1",
        children: [createTestSection({ id: "c1", collapsed: true })],
      }),
      createTestFolder({
        id: "f2",
        children: [createTestSection({ id: "c2", collapsed: true })],
      }),
    ]);
    const result = toggleAllChildSections(config);
    expect(result.sections[0].children![0].collapsed).toBe(false);
    expect(result.sections[1].children![0].collapsed).toBe(false);
  });

  it("returns unchanged config when no children exist", () => {
    const config = createTestConfig([createTestSection({ id: "s1" })]);
    const result = toggleAllChildSections(config);
    expect(result).toEqual(config);
  });
});

// ─── Widget operations with parentId (folder children) ──────────────

describe("widget operations inside folder children", () => {
  it("addWidget to a child section via parentId", () => {
    const child = createTestSection({ id: "c1" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const widget = createTestWidget();
    const { id: _, ...widgetWithoutId } = widget;
    const result = addWidget(config, "c1", widgetWithoutId, "f1");
    expect(result.sections[0].children![0].widgets).toHaveLength(1);
    expect(result.sections[0].widgets).toHaveLength(0);
  });

  it("deleteWidget from a child section via parentId", () => {
    const w = createTestWidget({ id: "w1" });
    const child = createTestSection({ id: "c1", widgets: [w] });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const result = deleteWidget(config, "c1", "w1", "f1");
    expect(result.sections[0].children![0].widgets).toHaveLength(0);
  });

  it("updateWidgets in a child section via parentId", () => {
    const child = createTestSection({ id: "c1", widgets: [createTestWidget({ id: "w1" })] });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const newWidgets = [createTestWidget({ id: "w2" })];
    const result = updateWidgets(config, "c1", newWidgets, "f1");
    expect(result.sections[0].children![0].widgets[0].id).toBe("w2");
  });

  it("pasteWidget into a child section via parentId", () => {
    const child = createTestSection({ id: "c1" });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const copied = copyWidget(createTestWidget({ id: "original" }));
    const result = pasteWidget(config, "c1", copied, "f1");
    expect(result.sections[0].children![0].widgets).toHaveLength(1);
    expect(result.sections[0].children![0].widgets[0].id).toMatch(/^widget-/);
  });

  it("handleEditWidgetSave in a child section via parentId", () => {
    const w = createTestWidget({ id: "w1" });
    const child = createTestSection({ id: "c1", widgets: [w] });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const newData: Omit<Widget, "id"> = {
      type: "chart",
      config: { metrics: ["updated"], xAxis: "step", yAxisScale: "linear", xAxisScale: "linear", aggregation: "AVG", showOriginal: false },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const result = handleEditWidgetSave(config, "c1", "w1", newData, "f1");
    expect((result.sections[0].children![0].widgets[0].config as any).aggregation).toBe("AVG");
  });
});

// ─── Global widget ops walk children ─────────────────────────────────

describe("global widget operations across folders", () => {
  function createFolderWithChildWidget() {
    const w = createTestWidget({ id: "child-widget" });
    const child = createTestSection({ id: "c1", widgets: [w] });
    const folderWidget = createTestWidget({ id: "folder-widget" });
    return createTestConfig([
      createTestFolder({ id: "f1", widgets: [folderWidget], children: [child] }),
    ]);
  }

  it("updateWidgetScale finds widgets inside children", () => {
    const config = createFolderWithChildWidget();
    const result = updateWidgetScale(config, "child-widget", "y", true);
    expect((result.sections[0].children![0].widgets[0].config as any).yAxisScale).toBe("log");
  });

  it("sanitizeConfig fixes layouts in children too", () => {
    const w = createTestWidget({
      id: "child-widget",
      layout: { x: Infinity, y: NaN, w: 6, h: 4 },
    });
    const child = createTestSection({ id: "c1", widgets: [w] });
    const config = createTestConfig([createTestFolder({ id: "f1", children: [child] })]);
    const result = sanitizeConfig(config);
    expect(result.sections[0].children![0].widgets[0].layout.x).toBe(0);
    expect(result.sections[0].children![0].widgets[0].layout.y).toBe(9999);
  });
});
