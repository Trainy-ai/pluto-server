import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { PlusIcon, SaveIcon, XIcon, AlertTriangleIcon, RotateCcwIcon, GridIcon, SlidersHorizontalIcon, ArchiveRestoreIcon, ChevronsUpDownIcon, ChevronsDownUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { SectionContainer, AddSectionButton } from "./section-container";
import { WidgetGrid } from "./widget-grid";
import { WidgetRenderer } from "./widget-renderer";
import { AddWidgetModal } from "./add-widget-modal";
import { DynamicSectionGrid } from "./dynamic-section-grid";
import { useDraftSave } from "./use-auto-save";
import { useNavigationGuard } from "./use-navigation-guard";
import {
  useUpdateDashboardView,
  type DashboardView,
} from "../../~queries/dashboard-views";
import {
  generateId,
  type DashboardViewConfig,
  type Section,
  type Widget,
  type ChartWidgetConfig,
} from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { searchUtils, type SearchState } from "../../~lib/search-utils";

interface DashboardBuilderProps {
  view: DashboardView;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  onClose?: () => void;
  searchState?: SearchState;
}

export function DashboardBuilder({
  view,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  onClose,
  searchState,
}: DashboardBuilderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [isEditing, setIsEditing] = useState(false);
  const [config, setConfig] = useState<DashboardViewConfig>(view.config);
  const [hasChanges, setHasChanges] = useState(false);
  const [addWidgetSectionId, setAddWidgetSectionId] = useState<string | null>(null);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDraftRestore, setShowDraftRestore] = useState(false);
  const [fullscreenWidget, setFullscreenWidget] = useState<Widget | null>(null);
  const [coarseMode, setCoarseMode] = useState(true);
  const [dynamicWidgetCounts, setDynamicWidgetCounts] = useState<Record<string, number>>({});

  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);

  const updateMutation = useUpdateDashboardView(organizationId, projectName);

  const { hasDraft, restoreDraft, clearDraft } = useDraftSave({
    config,
    viewId: view.id,
    isEditing,
    hasChanges,
  });

  // Block navigation when there are unsaved changes during editing
  const navGuard = useNavigationGuard(isEditing && hasChanges);

  // Track container width for responsive grid
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Update config when view changes — preserve current collapse state, default new sections to open
  useEffect(() => {
    setConfig((prev) => {
      const collapseState = new Map(prev.sections.map((s) => [s.id, s.collapsed]));
      return {
        ...view.config,
        sections: view.config.sections.map((s) => ({
          ...s,
          collapsed: collapseState.get(s.id) ?? false,
        })),
      };
    });
    setHasChanges(false);
  }, [view.config]);

  // Filter sections/widgets based on search state
  const filteredSections = useMemo(() => {
    if (!searchState || !searchState.query.trim()) {
      return config.sections;
    }
    return config.sections
      .map((section) => ({
        ...section,
        widgets: section.widgets.filter((widget) =>
          searchUtils.doesWidgetMatchSearch(widget, searchState)
        ),
      }))
      .filter((section) => {
        if (section.dynamicPattern) {
          // Dynamic sections: use reported widget count (0 or undefined means hide)
          return (dynamicWidgetCounts[section.id] ?? 0) > 0;
        }
        return section.widgets.length > 0;
      });
  }, [config.sections, searchState, dynamicWidgetCounts]);

  const isSearching = !!searchState?.query.trim();
  const isSearchingRef = useRef(false);
  isSearchingRef.current = isSearching;

  // Show draft restore prompt when entering edit mode with a pending draft
  const handleEnterEditMode = useCallback(() => {
    setIsEditing(true);
    if (hasDraft) {
      setShowDraftRestore(true);
    }
  }, [hasDraft]);

  const handleRestoreDraft = useCallback(() => {
    const draft = restoreDraft();
    if (draft) {
      setConfig(draft);
      setHasChanges(true);
    }
    setShowDraftRestore(false);
  }, [restoreDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setShowDraftRestore(false);
  }, [clearDraft]);

  const handleSave = useCallback(() => {
    // Sanitize config: ensure no non-finite numbers (Infinity, NaN) in layouts or configs
    const sanitizedConfig: DashboardViewConfig = {
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

    updateMutation.mutate(
      {
        organizationId,
        viewId: view.id,
        config: sanitizedConfig,
      },
      {
        onSuccess: () => {
          setHasChanges(false);
          clearDraft();
          setIsEditing(false);
        },
        onError: (error) => {
          console.error("Dashboard save failed:", error);
          toast.error("Failed to save dashboard", {
            description: error.message || "An unexpected error occurred",
          });
        },
      }
    );
  }, [updateMutation, organizationId, view.id, config, clearDraft]);

  const handleCancel = useCallback(() => {
    if (hasChanges) {
      setShowCancelConfirm(true);
    } else {
      setIsEditing(false);
    }
  }, [hasChanges]);

  const confirmCancel = useCallback(() => {
    setConfig(view.config);
    setHasChanges(false);
    clearDraft();
    setIsEditing(false);
    setShowCancelConfirm(false);
  }, [view.config, clearDraft]);

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s
      ),
    }));
  }, []);

  const updateSection = useCallback((sectionId: string, section: Section) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId ? section : s
      ),
    }));
    setHasChanges(true);
  }, []);

  const deleteSection = useCallback((sectionId: string) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== sectionId),
    }));
    setHasChanges(true);
  }, []);

  const addSection = useCallback((name: string, dynamicPattern?: string, dynamicPatternMode?: "search" | "regex") => {
    const newSection: Section = {
      id: `section-${generateId()}`,
      name,
      collapsed: false,
      widgets: [],
      dynamicPattern,
      dynamicPatternMode,
    };

    setConfig((prev) => ({
      ...prev,
      sections: [...prev.sections, newSection],
    }));
    setHasChanges(true);
  }, []);

  const addWidget = useCallback(
    (sectionId: string, widget: Omit<Widget, "id">) => {
      const newWidget: Widget = {
        ...widget,
        id: `widget-${generateId()}`,
      };

      setConfig((prev) => ({
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === sectionId
            ? { ...s, widgets: [...s.widgets, newWidget] }
            : s
        ),
      }));
      setHasChanges(true);
      setAddWidgetSectionId(null);
    },
    []
  );

  const updateWidgets = useCallback((sectionId: string, widgets: Widget[]) => {
    // Skip layout updates while searching — the filtered widget list passed
    // to WidgetGrid would permanently remove hidden widgets from config
    if (isSearchingRef.current) return;
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId ? { ...s, widgets } : s
      ),
    }));
    setHasChanges(true);
  }, []);

  const deleteWidget = useCallback((sectionId: string, widgetId: string) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? { ...s, widgets: s.widgets.filter((w) => w.id !== widgetId) }
          : s
      ),
    }));
    setHasChanges(true);
  }, []);

  const editWidget = useCallback((sectionId: string, widget: Widget) => {
    setAddWidgetSectionId(sectionId);
    setEditingWidget(widget);
  }, []);

  const updateWidgetBounds = useCallback((widgetId: string, yMin?: number, yMax?: number) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        widgets: s.widgets.map((w) =>
          w.id === widgetId
            ? { ...w, config: { ...w.config, yMin, yMax } }
            : w
        ),
      })),
    }));
  }, []);

  const updateWidgetScale = useCallback((widgetId: string, axis: "x" | "y", value: boolean) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        widgets: s.widgets.map((w) => {
          if (w.id !== widgetId || w.type !== "chart") return w;
          const config = w.config as ChartWidgetConfig;
          const scaleValue = value ? "log" : "linear";
          return {
            ...w,
            config: {
              ...config,
              ...(axis === "x" ? { xAxisScale: scaleValue } : { yAxisScale: scaleValue }),
            },
          };
        }),
      })),
    }));
    setHasChanges(true);
  }, []);

  const resetAllWidgetBounds = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        widgets: s.widgets.map((w) => {
          if (w.type === "chart") {
            const { yMin, yMax, ...restConfig } = w.config as ChartWidgetConfig;
            return { ...w, config: restConfig };
          }
          return w;
        }),
      })),
    }));
  }, []);

  const allCollapsed = config.sections.length > 0 && config.sections.every((s) => s.collapsed);

  const toggleAllSections = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        collapsed: !prev.sections.every((sec) => sec.collapsed),
      })),
    }));
  }, []);

  const handleDynamicWidgetCount = useCallback((sectionId: string, count: number) => {
    setDynamicWidgetCounts((prev) => {
      if (prev[sectionId] === count) return prev;
      return { ...prev, [sectionId]: count };
    });
  }, []);

  const handleEditWidgetSave = useCallback(
    (widgetData: Omit<Widget, "id">) => {
      if (!editingWidget || !addWidgetSectionId) return;

      const updatedWidget: Widget = {
        ...widgetData,
        id: editingWidget.id,
      };

      setConfig((prev) => ({
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === addWidgetSectionId
            ? {
                ...s,
                widgets: s.widgets.map((w) =>
                  w.id === editingWidget.id ? updatedWidget : w
                ),
              }
            : s
        ),
      }));
      setHasChanges(true);
      setAddWidgetSectionId(null);
      setEditingWidget(null);
    },
    [editingWidget, addWidgetSectionId]
  );

  return (
    <div ref={containerRef} className="flex-1 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{view.name}</h2>
          {hasChanges && (
            <span className="text-xs text-muted-foreground">(unsaved changes)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {config.sections.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={resetAllWidgetBounds}
              title="Reset all Y-axis bounds"
            >
              <RotateCcwIcon className="mr-1.5 size-3.5" />
              Reset Bounds
            </Button>
          )}
          {config.sections.length >= 2 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={toggleAllSections}
              title={allCollapsed ? "Expand all sections" : "Collapse all sections"}
            >
              {allCollapsed ? (
                <>
                  <ChevronsUpDownIcon className="mr-1.5 size-3.5" />
                  Expand All
                </>
              ) : (
                <>
                  <ChevronsDownUpIcon className="mr-1.5 size-3.5" />
                  Collapse All
                </>
              )}
            </Button>
          )}
          {isEditing ? (
            <>
              {/* Coarse / Fine toggle */}
              <div className="flex items-center rounded-md border">
                <Button
                  variant={coarseMode ? "secondary" : "ghost"}
                  size="sm"
                  className="rounded-r-none border-0"
                  onClick={() => setCoarseMode(true)}
                >
                  <GridIcon className="mr-1.5 size-3.5" />
                  Grid
                </Button>
                <Button
                  variant={!coarseMode ? "secondary" : "ghost"}
                  size="sm"
                  className="rounded-l-none border-0"
                  onClick={() => setCoarseMode(false)}
                >
                  <SlidersHorizontalIcon className="mr-1.5 size-3.5" />
                  Free
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                <XIcon className="mr-2 size-4" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                loading={updateMutation.isPending}
                disabled={!hasChanges}
              >
                <SaveIcon className="mr-2 size-4" />
                Save
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={handleEnterEditMode}>
              Edit Dashboard
            </Button>
          )}
        </div>
      </div>

      {/* Sections */}
      {filteredSections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground mb-4">
            {isSearching
              ? "No widgets match your search."
              : "This dashboard is empty. Start by adding a section."}
          </p>
          {isEditing && !isSearching && (
            <AddSectionButton
              onAddSection={addSection}
              organizationId={organizationId}
              projectName={projectName}
              selectedRunIds={selectedRunIds}
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSections.map((section) => (
            <SectionContainer
              key={section.id}
              section={section}
              onUpdate={(s) => updateSection(section.id, s)}
              onToggleCollapse={() => toggleSectionCollapse(section.id)}
              onDelete={() => deleteSection(section.id)}
              onAddWidget={() => setAddWidgetSectionId(section.id)}
              isEditing={isEditing}
              dynamicWidgetCount={dynamicWidgetCounts[section.id]}
              organizationId={organizationId}
              projectName={projectName}
              selectedRunIds={selectedRunIds}
            >
              {section.dynamicPattern ? (
                <DynamicSectionGrid
                  sectionId={section.id}
                  pattern={section.dynamicPattern}
                  patternMode={section.dynamicPatternMode}
                  organizationId={organizationId}
                  projectName={projectName}
                  selectedRunIds={selectedRunIds}
                  groupedMetrics={groupedMetrics}
                  selectedRuns={selectedRuns}
                  searchState={searchState}
                  onWidgetCountChange={(count) => handleDynamicWidgetCount(section.id, count)}
                />
              ) : (
                <WidgetGrid
                  widgets={section.widgets}
                  onLayoutChange={(widgets) => updateWidgets(section.id, widgets)}
                  onEditWidget={(widget) => editWidget(section.id, widget)}
                  onDeleteWidget={(widgetId) => deleteWidget(section.id, widgetId)}
                  onFullscreenWidget={setFullscreenWidget}
                  onUpdateWidgetBounds={updateWidgetBounds}
                  onUpdateWidgetScale={updateWidgetScale}
                  isEditing={isEditing}
                  coarseMode={coarseMode}
                  containerWidth={containerWidth - 48} // Account for padding
                  renderWidget={(widget, onDataRange, onResetBounds) => (
                    <WidgetRenderer
                      widget={widget}
                      groupedMetrics={groupedMetrics}
                      selectedRuns={selectedRuns}
                      organizationId={organizationId}
                      projectName={projectName}
                      onDataRange={onDataRange}
                      onResetBounds={onResetBounds}
                    />
                  )}
                />
              )}
            </SectionContainer>
          ))}

          {isEditing && (
            <AddSectionButton
              onAddSection={addSection}
              organizationId={organizationId}
              projectName={projectName}
              selectedRunIds={selectedRunIds}
            />
          )}
        </div>
      )}

      {/* Add/Edit Widget Modal */}
      <AddWidgetModal
        open={!!addWidgetSectionId}
        onOpenChange={(open) => {
          if (!open) {
            setAddWidgetSectionId(null);
            setEditingWidget(null);
          }
        }}
        onAdd={editingWidget ? handleEditWidgetSave : (w) => addWidgetSectionId && addWidget(addWidgetSectionId, w)}
        organizationId={organizationId}
        projectName={projectName}
        editWidget={editingWidget ?? undefined}
        selectedRunIds={selectedRunIds}
      />

      {/* Fullscreen Chart Dialog */}
      {fullscreenWidget && (
        <ChartFullscreenDialog
          open={!!fullscreenWidget}
          onOpenChange={(open) => {
            if (!open) setFullscreenWidget(null);
          }}
          title={
            fullscreenWidget.config.title ||
            (fullscreenWidget.type === "chart"
              ? (fullscreenWidget.config as ChartWidgetConfig).metrics[0] || "Chart"
              : fullscreenWidget.type === "file-group"
                ? `${(fullscreenWidget.config as { files?: string[] }).files?.length ?? 0} files`
                : "Widget")
          }
          yMin={fullscreenWidget.type === "chart" ? (fullscreenWidget.config as ChartWidgetConfig).yMin : undefined}
          yMax={fullscreenWidget.type === "chart" ? (fullscreenWidget.config as ChartWidgetConfig).yMax : undefined}
          onBoundsChange={
            fullscreenWidget.type === "chart"
              ? (yMin, yMax) => {
                  updateWidgetBounds(fullscreenWidget.id, yMin, yMax);
                  setFullscreenWidget((prev) =>
                    prev ? { ...prev, config: { ...prev.config, yMin, yMax } } : null
                  );
                }
              : undefined
          }
          logXAxis={fullscreenWidget.type === "chart" ? (fullscreenWidget.config as ChartWidgetConfig).xAxisScale === "log" : undefined}
          logYAxis={fullscreenWidget.type === "chart" ? (fullscreenWidget.config as ChartWidgetConfig).yAxisScale === "log" : undefined}
          onLogScaleChange={
            fullscreenWidget.type === "chart"
              ? (axis, value) => {
                  updateWidgetScale(fullscreenWidget.id, axis, value);
                  const scaleValue = value ? "log" : "linear";
                  setFullscreenWidget((prev) =>
                    prev
                      ? {
                          ...prev,
                          config: {
                            ...prev.config,
                            ...(axis === "x" ? { xAxisScale: scaleValue } : { yAxisScale: scaleValue }),
                          },
                        }
                      : null
                  );
                }
              : undefined
          }
          onResetAll={
            fullscreenWidget.type === "chart"
              ? () => {
                  updateWidgetBounds(fullscreenWidget.id, undefined, undefined);
                  updateWidgetScale(fullscreenWidget.id, "x", false);
                  updateWidgetScale(fullscreenWidget.id, "y", false);
                  setFullscreenWidget((prev) =>
                    prev
                      ? {
                          ...prev,
                          config: {
                            ...prev.config,
                            yMin: undefined,
                            yMax: undefined,
                            xAxisScale: "linear",
                            yAxisScale: "linear",
                          },
                        }
                      : null
                  );
                }
              : undefined
          }
        >
          <WidgetRenderer
            widget={fullscreenWidget}
            groupedMetrics={groupedMetrics}
            selectedRuns={selectedRuns}
            organizationId={organizationId}
            projectName={projectName}
          />
        </ChartFullscreenDialog>
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-yellow-500" />
              Discard unsaved changes?
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes to this dashboard. Are you sure you want to
              discard them? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
              Keep Editing
            </Button>
            <Button variant="destructive" onClick={confirmCancel}>
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Draft Restore Dialog */}
      <Dialog open={showDraftRestore} onOpenChange={setShowDraftRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArchiveRestoreIcon className="size-5 text-blue-500" />
              Restore unsaved draft?
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes from a previous editing session. Would you
              like to restore them, or start fresh from the last saved version?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleDiscardDraft}>
              Start Fresh
            </Button>
            <Button onClick={handleRestoreDraft}>
              Restore Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Navigation Guard Dialog */}
      <Dialog
        open={navGuard.isBlocked}
        onOpenChange={(open) => { if (!open) { navGuard.reset(); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-yellow-500" />
              Unsaved dashboard changes
            </DialogTitle>
            <DialogDescription>
              Your dashboard has changes that haven&apos;t been saved yet. If you
              leave now, these changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={navGuard.reset}>
              Stay
            </Button>
            <Button variant="destructive" onClick={navGuard.proceed}>
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
