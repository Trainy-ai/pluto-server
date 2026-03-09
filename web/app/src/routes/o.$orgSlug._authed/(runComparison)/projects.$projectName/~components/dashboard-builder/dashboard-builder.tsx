import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { SectionContainer, AddSectionButton } from "./section-container";
import { WidgetGrid } from "./widget-grid";
import { WidgetRenderer } from "./widget-renderer";
import { AddWidgetModal } from "./add-widget-modal";
import { DynamicSectionGrid } from "./dynamic-section-grid";
import { DashboardToolbar } from "./dashboard-toolbar";
import {
  CancelConfirmDialog,
  DraftRestoreDialog,
  NavGuardDialog,
  SaveAsNewDialog,
} from "./dashboard-dialogs";
import { useDraftSave } from "./use-auto-save";
import { useNavigationGuard } from "./use-navigation-guard";
import { useHiddenPatternWidgets } from "./use-hidden-pattern-widgets";
import { useDashboardSave } from "./use-dashboard-save";
import { DashboardStaleWarning } from "./dashboard-stale-warning";
import {
  useCreateDashboardView,
  useDashboardStalenessCheck,
  type DashboardView,
} from "../../~queries/dashboard-views";
import {
  type DashboardViewConfig,
  type Section,
  type Widget,
  type ChartWidgetConfig,
} from "../../~types/dashboard-types";
import * as configOps from "./use-dashboard-config";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { searchUtils, type SearchState } from "../../~lib/search-utils";

/** Total horizontal padding of section containers (px-6 each side = 24px * 2). */
const SECTION_HORIZONTAL_PADDING = 48;

interface DashboardBuilderProps {
  view: DashboardView;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  onClose?: () => void;
  /** When provided, reads line settings from this runId instead of the "full" key */
  settingsRunId?: string;
  searchState?: SearchState;
}

export function DashboardBuilder({
  view,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  onClose,
  settingsRunId,
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
  const [copiedWidget, setCopiedWidget] = useState<Widget | null>(null);

  // Staleness / optimistic concurrency state
  const [isStale, setIsStale] = useState(false);
  const [showSaveAsNew, setShowSaveAsNew] = useState(false);
  const [saveAsNewName, setSaveAsNewName] = useState("");
  const editStartUpdatedAtRef = useRef<string | null>(null);

  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);

  const { hasDraft, restoreDraft, clearDraft } = useDraftSave({
    config,
    viewId: view.id,
    isEditing,
    hasChanges,
  });

  const navGuard = useNavigationGuard(isEditing && hasChanges);

  // Staleness detection: poll for remote changes while editing
  const { data: remoteView } = useDashboardStalenessCheck(
    organizationId,
    view.id,
    isEditing && !isStale, // stop polling once stale detected
  );

  const createMutation = useCreateDashboardView(organizationId, projectName);

  // Detect staleness: compare remote updatedAt with what we had when editing started
  useEffect(() => {
    if (!isEditing || !remoteView || !editStartUpdatedAtRef.current) return;
    const remoteTime = new Date(remoteView.updatedAt).getTime();
    const editStartTime = new Date(editStartUpdatedAtRef.current).getTime();
    if (remoteTime > editStartTime) {
      setIsStale(true);
    }
  }, [isEditing, remoteView]);

  const resetEditState = useCallback(() => {
    setHasChanges(false);
    setIsStale(false);
    editStartUpdatedAtRef.current = null;
    clearDraft();
    setIsEditing(false);
  }, [clearDraft]);

  const { isSaving, handleSave, handleOverride } = useDashboardSave({
    view,
    config,
    organizationId,
    projectName,
    clearDraft,
    expectedUpdatedAt: editStartUpdatedAtRef.current ?? undefined,
    onSaveSuccess: resetEditState,
    onConflict: useCallback(() => setIsStale(true), []),
  });

  const hiddenWidgetIds = useHiddenPatternWidgets({
    sections: config.sections,
    selectedRunIds,
    organizationId,
    projectName,
    isEditing,
  });

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
  // Skip overwriting when the user is editing and a stale state has been detected
  useEffect(() => {
    if (isEditing && isStale) return;
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
  }, [view.config, isEditing, isStale]);

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
          return (dynamicWidgetCounts[section.id] ?? 0) > 0;
        }
        return section.widgets.length > 0;
      });
  }, [config.sections, searchState, dynamicWidgetCounts]);

  const isSearching = !!searchState?.query.trim();
  const isSearchingRef = useRef(false);
  isSearchingRef.current = isSearching;

  // ─── Edit mode handlers ─────────────────────────────────────────────

  const handleEnterEditMode = useCallback(() => {
    editStartUpdatedAtRef.current = new Date(view.updatedAt).toISOString();
    setIsStale(false);
    setIsEditing(true);
    if (hasDraft) {
      setShowDraftRestore(true);
    }
  }, [hasDraft, view.updatedAt]);

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
    setIsStale(false);
    editStartUpdatedAtRef.current = null;
    clearDraft();
    setIsEditing(false);
    setShowCancelConfirm(false);
  }, [view.config, clearDraft]);

  // ─── Stale warning handlers ─────────────────────────────────────────

  const handleSaveAsNew = useCallback(() => {
    setSaveAsNewName(`${view.name} (copy)`);
    setShowSaveAsNew(true);
  }, [view.name]);

  const confirmSaveAsNew = useCallback(() => {
    if (!saveAsNewName.trim()) return;
    createMutation.mutate(
      {
        organizationId,
        projectName,
        name: saveAsNewName.trim(),
        config,
      },
      {
        onSuccess: () => {
          setShowSaveAsNew(false);
          setSaveAsNewName("");
          resetEditState();
          toast.success("Dashboard saved as new view");
        },
        onError: (error) => {
          toast.error("Failed to save as new dashboard", {
            description: error.message || "An unexpected error occurred",
          });
        },
      }
    );
  }, [createMutation, organizationId, projectName, saveAsNewName, config, resetEditState]);

  // ─── Config mutation callbacks (delegate to pure functions) ──────────

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setConfig((prev) => configOps.toggleSectionCollapse(prev, sectionId));
  }, []);

  const updateSection = useCallback((sectionId: string, section: Section) => {
    setConfig((prev) => configOps.updateSection(prev, sectionId, section));
    setHasChanges(true);
  }, []);

  const deleteSection = useCallback((sectionId: string) => {
    setConfig((prev) => configOps.deleteSection(prev, sectionId));
    setHasChanges(true);
  }, []);

  const addSection = useCallback((name: string, dynamicPattern?: string, dynamicPatternMode?: "search" | "regex") => {
    setConfig((prev) => configOps.addSection(prev, name, dynamicPattern, dynamicPatternMode));
    setHasChanges(true);
  }, []);

  const addWidget = useCallback((sectionId: string, widget: Omit<Widget, "id">) => {
    setConfig((prev) => configOps.addWidget(prev, sectionId, widget));
    setHasChanges(true);
    setAddWidgetSectionId(null);
  }, []);

  const updateWidgetsInSection = useCallback((sectionId: string, widgets: Widget[]) => {
    if (isSearchingRef.current) return;
    setConfig((prev) => configOps.updateWidgets(prev, sectionId, widgets));
    setHasChanges(true);
  }, []);

  const deleteWidget = useCallback((sectionId: string, widgetId: string) => {
    setConfig((prev) => configOps.deleteWidget(prev, sectionId, widgetId));
    setHasChanges(true);
  }, []);

  const editWidget = useCallback((sectionId: string, widget: Widget) => {
    setAddWidgetSectionId(sectionId);
    setEditingWidget(widget);
  }, []);

  const handleCopyWidget = useCallback((widget: Widget) => {
    setCopiedWidget(widget);
    toast.success("Widget copied");
  }, []);

  const pasteWidget = useCallback((sectionId: string) => {
    if (!copiedWidget) return;
    setConfig((prev) => configOps.pasteWidget(prev, sectionId, copiedWidget));
    setHasChanges(true);
  }, [copiedWidget]);

  const updateWidgetBounds = useCallback((widgetId: string, yMin?: number, yMax?: number) => {
    setConfig((prev) => configOps.updateWidgetBounds(prev, widgetId, yMin, yMax));
  }, []);

  const updateWidgetScale = useCallback((widgetId: string, axis: "x" | "y", value: boolean) => {
    setConfig((prev) => configOps.updateWidgetScale(prev, widgetId, axis, value));
    setHasChanges(true);
  }, []);

  const resetAllWidgetBounds = useCallback(() => {
    setConfig((prev) => configOps.resetAllWidgetBounds(prev));
  }, []);

  const allCollapsed = config.sections.length > 0 && config.sections.every((s) => s.collapsed);

  const toggleAllSections = useCallback(() => {
    setConfig((prev) => configOps.toggleAllSections(prev));
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
      setConfig((prev) =>
        configOps.handleEditWidgetSave(prev, addWidgetSectionId, editingWidget.id, widgetData)
      );
      setHasChanges(true);
      setAddWidgetSectionId(null);
      setEditingWidget(null);
    },
    [editingWidget, addWidgetSectionId]
  );

  return (
    <div ref={containerRef} className="flex-1 space-y-4">
      {/* Toolbar */}
      <DashboardToolbar
        viewName={view.name}
        hasChanges={hasChanges}
        isEditing={isEditing}
        isSaving={isSaving}
        sectionCount={config.sections.length}
        allCollapsed={allCollapsed}
        coarseMode={coarseMode}
        onResetAllBounds={resetAllWidgetBounds}
        onToggleAllSections={toggleAllSections}
        onSetCoarseMode={setCoarseMode}
        onCancel={handleCancel}
        onSave={handleSave}
        onEnterEditMode={handleEnterEditMode}
      />

      {/* Stale dashboard warning */}
      {isStale && isEditing && (
        <DashboardStaleWarning
          onSaveAsNew={handleSaveAsNew}
          onOverride={handleOverride}
        />
      )}

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
          {filteredSections.map((section) => {
            const visibleWidgets = isEditing || section.dynamicPattern
              ? section.widgets
              : section.widgets.filter((w) => !hiddenWidgetIds.has(w.id));

            if (!isEditing && !section.dynamicPattern && visibleWidgets.length === 0 && section.widgets.length > 0) {
              return null;
            }

            return (
              <SectionContainer
                key={section.id}
                section={section}
                visibleWidgetCount={section.dynamicPattern ? undefined : visibleWidgets.length}
                onUpdate={(s) => updateSection(section.id, s)}
                onToggleCollapse={() => toggleSectionCollapse(section.id)}
                onDelete={() => deleteSection(section.id)}
                onAddWidget={() => setAddWidgetSectionId(section.id)}
                onPasteWidget={() => pasteWidget(section.id)}
                hasCopiedWidget={!!copiedWidget}
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
                    settingsRunId={settingsRunId}
                  />
                ) : (
                  <WidgetGrid
                    widgets={visibleWidgets}
                    onLayoutChange={(widgets) => updateWidgetsInSection(section.id, widgets)}
                    onEditWidget={(widget) => editWidget(section.id, widget)}
                    onDeleteWidget={(widgetId) => deleteWidget(section.id, widgetId)}
                    onCopyWidget={handleCopyWidget}
                    onFullscreenWidget={setFullscreenWidget}
                    onUpdateWidgetBounds={updateWidgetBounds}
                    onUpdateWidgetScale={updateWidgetScale}
                    isEditing={isEditing}
                    coarseMode={coarseMode}
                    containerWidth={containerWidth - SECTION_HORIZONTAL_PADDING}
                    renderWidget={(widget, onDataRange, onResetBounds) => (
                      <WidgetRenderer
                        widget={widget}
                        groupedMetrics={groupedMetrics}
                        selectedRuns={selectedRuns}
                        organizationId={organizationId}
                        projectName={projectName}
                        onDataRange={onDataRange}
                        onResetBounds={onResetBounds}
                        settingsRunId={settingsRunId}
                      />
                    )}
                  />
                )}
              </SectionContainer>
            );
          })}

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
            settingsRunId={settingsRunId}
          />
        </ChartFullscreenDialog>
      )}

      {/* Dialogs */}
      <CancelConfirmDialog
        open={showCancelConfirm}
        onOpenChange={setShowCancelConfirm}
        onConfirm={confirmCancel}
      />

      <DraftRestoreDialog
        open={showDraftRestore}
        onOpenChange={setShowDraftRestore}
        onRestore={handleRestoreDraft}
        onDiscard={handleDiscardDraft}
      />

      <NavGuardDialog
        open={navGuard.isBlocked}
        onStay={navGuard.reset}
        onLeave={navGuard.proceed}
      />

      {/* Save as New Dashboard Dialog (from stale warning) */}
      <SaveAsNewDialog
        open={showSaveAsNew}
        onOpenChange={setShowSaveAsNew}
        name={saveAsNewName}
        onNameChange={setSaveAsNewName}
        onConfirm={confirmSaveAsNew}
        isPending={createMutation.isPending}
      />
    </div>
  );
}
