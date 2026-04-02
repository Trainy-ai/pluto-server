import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { SectionContainer, FolderContainer, AddSectionButton, AddFolderButton } from "./section-container";
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
import { useSectionDrag } from "./use-section-drag";
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
import { useFullscreenContext } from "@/components/charts/context/fullscreen-context";

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
  const { setFullscreen } = useFullscreenContext();
  useEffect(() => { setFullscreen(!!fullscreenWidget); }, [fullscreenWidget, setFullscreen]);
  // Y zoom ranges keyed by widget ID, shared between mini and fullscreen
  const [widgetYZoomRanges, setWidgetYZoomRanges] = useState<Record<string, [number, number] | null>>({});
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
    expectedUpdatedAtRef: editStartUpdatedAtRef,
    onSaveSuccess: resetEditState,
    onConflict: useCallback(() => setIsStale(true), []),
  });

  const { hidden: hiddenWidgetIds, resolved: resolvedPatternMetrics } = useHiddenPatternWidgets({
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

  // Update config when view changes — preserve current collapse state, default new sections to open.
  // Skip entirely while editing: local changes must not be overwritten by a background refetch
  // (e.g. window-focus refetch after another user saves). Staleness is detected separately via
  // the polling effect above and the server-side CONFLICT check on save.
  useEffect(() => {
    if (isEditing) return;
    setConfig((prev) => {
      // Build collapse state maps for both top-level and child sections
      const collapseState = new Map<string, boolean>();
      for (const s of prev.sections) {
        collapseState.set(s.id, s.collapsed);
        for (const c of s.children ?? []) {
          collapseState.set(c.id, c.collapsed);
        }
      }
      return {
        ...view.config,
        sections: view.config.sections.map((s) => ({
          ...s,
          collapsed: collapseState.get(s.id) ?? false,
          ...(s.children
            ? {
                children: s.children.map((c) => ({
                  ...c,
                  collapsed: collapseState.get(c.id) ?? false,
                })),
              }
            : {}),
        })),
      };
    });
    setHasChanges(false);
  }, [view.config, isEditing]);

  // Filter sections/widgets based on search state (walks children too)
  const filteredSections = useMemo(() => {
    if (!searchState || !searchState.query.trim()) {
      return config.sections;
    }

    const filterSection = (section: Section): Section => ({
      ...section,
      widgets: section.widgets.filter((widget) =>
        searchUtils.doesWidgetMatchSearch(widget, searchState, resolvedPatternMetrics)
      ),
      ...(section.children
        ? {
            children: section.children
              .map(filterSection)
              .filter((child) => {
                if (child.dynamicPattern) {
                  return (dynamicWidgetCounts[child.id] ?? 0) > 0;
                }
                return child.widgets.length > 0;
              }),
          }
        : {}),
    });

    return config.sections
      .map(filterSection)
      .filter((section) => {
        if (section.dynamicPattern) {
          return (dynamicWidgetCounts[section.id] ?? 0) > 0;
        }
        // Keep folders that still have children or direct widgets
        if (section.children) {
          return (section.children.length > 0) || (section.widgets.length > 0);
        }
        return section.widgets.length > 0;
      });
  }, [config.sections, searchState, dynamicWidgetCounts, resolvedPatternMetrics]);

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

  // ─── Folder operations ───────────────────────────────────────────────

  const addFolder = useCallback((name: string) => {
    setConfig((prev) => configOps.addFolder(prev, name));
    setHasChanges(true);
  }, []);

  const addChildSection = useCallback((parentId: string, name: string, dynamicPattern?: string, dynamicPatternMode?: "search" | "regex") => {
    setConfig((prev) => configOps.addChildSection(prev, parentId, name, dynamicPattern, dynamicPatternMode));
    setHasChanges(true);
  }, []);

  const deleteChildSection = useCallback((parentId: string, childId: string) => {
    setConfig((prev) => configOps.deleteChildSection(prev, parentId, childId));
    setHasChanges(true);
  }, []);

  const updateChildSection = useCallback((parentId: string, childId: string, child: Section) => {
    setConfig((prev) => configOps.updateChildSection(prev, parentId, childId, child));
    setHasChanges(true);
  }, []);

  const toggleChildSectionCollapse = useCallback((parentId: string, childId: string) => {
    setConfig((prev) => configOps.toggleChildSectionCollapse(prev, parentId, childId));
  }, []);

  const reorderChildSections = useCallback((parentId: string, fromIndex: number, toIndex: number) => {
    setConfig((prev) => configOps.reorderChildSections(prev, parentId, fromIndex, toIndex));
    setHasChanges(true);
  }, []);

  const toggleAllChildSections = useCallback(() => {
    setConfig((prev) => configOps.toggleAllChildSections(prev));
  }, []);

  const allChildSections = useMemo(
    () => config.sections.flatMap((s) => s.children ?? []),
    [config.sections],
  );
  const hasChildSections = allChildSections.length > 0;
  const allChildrenCollapsed = hasChildSections && allChildSections.every((c) => c.collapsed);

  // ─── Widget operations ──────────────────────────────────────────────

  const [addWidgetParentId, setAddWidgetParentId] = useState<string | null>(null);

  const addWidget = useCallback((sectionId: string, widget: Omit<Widget, "id">, parentId?: string) => {
    setConfig((prev) => configOps.addWidget(prev, sectionId, widget, parentId));
    setHasChanges(true);
    setAddWidgetSectionId(null);
    setAddWidgetParentId(null);
  }, []);

  const updateWidgetsInSection = useCallback((sectionId: string, widgets: Widget[], parentId?: string) => {
    if (isSearchingRef.current) return;
    setConfig((prev) => configOps.updateWidgets(prev, sectionId, widgets, parentId));
    setHasChanges(true);
  }, []);

  const deleteWidget = useCallback((sectionId: string, widgetId: string, parentId?: string) => {
    setConfig((prev) => configOps.deleteWidget(prev, sectionId, widgetId, parentId));
    setHasChanges(true);
  }, []);

  const editWidget = useCallback((sectionId: string, widget: Widget, parentId?: string) => {
    setAddWidgetSectionId(sectionId);
    setAddWidgetParentId(parentId ?? null);
    setEditingWidget(widget);
  }, []);

  const handleCopyWidget = useCallback((widget: Widget) => {
    setCopiedWidget(widget);
    toast.success("Widget copied");
  }, []);

  const pasteWidget = useCallback((sectionId: string, parentId?: string) => {
    if (!copiedWidget) return;
    setConfig((prev) => configOps.pasteWidget(prev, sectionId, copiedWidget, parentId));
    setHasChanges(true);
  }, [copiedWidget]);

  const handleMoveWidget = useCallback((
    widgetId: string,
    fromSectionId: string,
    fromParentId: string | undefined,
    target: configOps.SectionLocation,
  ) => {
    setConfig((prev) => configOps.moveWidget(prev, widgetId, { sectionId: fromSectionId, parentId: fromParentId }, target));
    setHasChanges(true);
    toast.success("Widget moved");
  }, []);
  const updateWidgetScale = useCallback((widgetId: string, axis: "x" | "y", value: boolean) => {
    setConfig((prev) => configOps.updateWidgetScale(prev, widgetId, axis, value));
    setHasChanges(true);
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

  const reorderSections = useCallback((fromIndex: number, toIndex: number) => {
    setConfig((prev) => configOps.reorderSections(prev, fromIndex, toIndex));
    setHasChanges(true);
  }, []);

  const sectionIds = useMemo(
    () => filteredSections.map((s) => s.id),
    [filteredSections]
  );

  const folderIds = useMemo(
    () => filteredSections.filter((s) => configOps.isFolder(s)).map((s) => s.id),
    [filteredSections],
  );

  // Map child section ID → parent folder ID (for drag target identification)
  const childToParentMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of filteredSections) {
      for (const c of s.children ?? []) {
        map[c.id] = s.id;
      }
    }
    return map;
  }, [filteredSections]);

  // Map folder ID → ordered child IDs (for reorder index computation)
  const folderChildIds = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of filteredSections) {
      if (s.children) {
        map[s.id] = s.children.map((c) => c.id);
      }
    }
    return map;
  }, [filteredSections]);

  const handleDragMoveIntoFolder = useCallback(
    (sectionId: string, fromParentId: string | undefined, folderId: string) => {
      if (fromParentId) {
        setConfig((prev) => configOps.moveSectionBetweenFolders(prev, sectionId, fromParentId, folderId));
      } else {
        setConfig((prev) => configOps.moveSectionIntoFolder(prev, sectionId, folderId));
      }
      setHasChanges(true);
      toast.success("Section moved into folder");
    },
    [],
  );

  const handleDragMoveOutOfFolder = useCallback(
    (sectionId: string, fromParentId: string, targetSectionId: string, position: "above" | "below") => {
      setConfig((prev) => configOps.moveSectionOutOfFolder(prev, sectionId, fromParentId, targetSectionId, position));
      setHasChanges(true);
      toast.success("Section moved to top level");
    },
    [],
  );

  const handleDropNearChild = useCallback(
    (sectionId: string, fromParentId: string | undefined, targetParentId: string, targetChildId: string, position: "above" | "below") => {
      setConfig((prev) => configOps.moveSectionIntoFolderAtPosition(prev, sectionId, fromParentId, targetParentId, targetChildId, position));
      setHasChanges(true);
      toast.success("Section moved into folder");
    },
    [],
  );

  const handleReorderChildren = useCallback(
    (parentId: string, fromIndex: number, toIndex: number) => {
      setConfig((prev) => configOps.reorderChildSections(prev, parentId, fromIndex, toIndex));
      setHasChanges(true);
    },
    [],
  );

  const { dragState, handleDragStart, handleDragOver, handleDrop, handleDragEnd, handleDragLeave } =
    useSectionDrag({
      onReorder: reorderSections,
      sectionIds,
      onMoveIntoFolder: handleDragMoveIntoFolder,
      onMoveOutOfFolder: handleDragMoveOutOfFolder,
      onDropNearChild: handleDropNearChild,
      onReorderChildren: handleReorderChildren,
      folderIds,
      childToParentMap,
      folderChildIds,
    });

  const handleEditWidgetSave = useCallback(
    (widgetData: Omit<Widget, "id">) => {
      if (!editingWidget || !addWidgetSectionId) return;
      setConfig((prev) =>
        configOps.handleEditWidgetSave(prev, addWidgetSectionId, editingWidget.id, widgetData, addWidgetParentId ?? undefined)
      );
      setHasChanges(true);
      setAddWidgetSectionId(null);
      setAddWidgetParentId(null);
      setEditingWidget(null);
    },
    [editingWidget, addWidgetSectionId, addWidgetParentId]
  );

  // ─── Section/folder rendering helpers ──────────────────────────────

  /** Render a widget grid or dynamic grid for a given section. */
  function renderSectionContent(section: Section, parentId?: string) {
    const visibleWidgets = isEditing || section.dynamicPattern
      ? section.widgets
      : section.widgets.filter((w) => !hiddenWidgetIds.has(w.id));

    if (section.dynamicPattern) {
      return (
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
      );
    }
    const sectionMoveTargets = isEditing
      ? configOps.getMoveTargets(config, section.id, parentId)
      : [];

    return (
      <WidgetGrid
        widgets={visibleWidgets}
        onLayoutChange={(widgets) => updateWidgetsInSection(section.id, widgets, parentId)}
        onEditWidget={(widget) => editWidget(section.id, widget, parentId)}
        onDeleteWidget={(widgetId) => deleteWidget(section.id, widgetId, parentId)}
        onCopyWidget={handleCopyWidget}
        onMoveWidget={(widgetId, target) => handleMoveWidget(widgetId, section.id, parentId, target)}
        moveTargets={sectionMoveTargets}
        onFullscreenWidget={setFullscreenWidget}
        onUpdateWidgetScale={updateWidgetScale}
        isEditing={isEditing}
        coarseMode={coarseMode}
        containerWidth={containerWidth - SECTION_HORIZONTAL_PADDING}
        renderWidget={(widget) => (
          <WidgetRenderer
            widget={widget}
            groupedMetrics={groupedMetrics}
            selectedRuns={selectedRuns}
            organizationId={organizationId}
            projectName={projectName}
            settingsRunId={settingsRunId}
            yZoomRange={widgetYZoomRanges[widget.id] ?? null}
            onYZoomRangeChange={(range) => setWidgetYZoomRanges((prev) => ({ ...prev, [widget.id]: range }))}
          />
        )}
      />
    );
  }

  /** Render a regular section (no children). */
  /** Get folder targets for moving a section. */
  function getSectionMoveTargets(section: Section, parentId?: string) {
    if (!isEditing) return undefined;
    // Don't allow folders to be moved into other folders
    if (configOps.isFolder(section)) return undefined;

    const targets: { label: string; id: string }[] = [];

    if (parentId) {
      // Child section — can move to top level or other folders
      targets.push({ label: "Top level", id: "" });
    }

    // All folders except the current parent
    for (const s of config.sections) {
      if (!configOps.isFolder(s)) continue;
      if (s.id === parentId) continue; // skip current parent
      targets.push({ label: s.name, id: s.id });
    }

    return targets.length > 0 ? targets : undefined;
  }

  function handleMoveSection(sectionId: string, parentId: string | undefined, targetFolderId: string | null) {
    if (targetFolderId === "" || targetFolderId === null) {
      // Move out of folder to top level
      if (parentId) {
        setConfig((prev) => configOps.moveSectionOutOfFolder(prev, sectionId, parentId));
        setHasChanges(true);
        toast.success("Section moved to top level");
      }
    } else if (parentId) {
      // Move from one folder to another
      setConfig((prev) => configOps.moveSectionBetweenFolders(prev, sectionId, parentId, targetFolderId));
      setHasChanges(true);
      toast.success("Section moved");
    } else {
      // Move from top level into a folder
      setConfig((prev) => configOps.moveSectionIntoFolder(prev, sectionId, targetFolderId));
      setHasChanges(true);
      toast.success("Section moved into folder");
    }
  }

  function renderSection(section: Section, parentId?: string) {
    const visibleWidgets = isEditing || section.dynamicPattern
      ? section.widgets
      : section.widgets.filter((w) => !hiddenWidgetIds.has(w.id));

    if (!isEditing && !section.dynamicPattern && visibleWidgets.length === 0 && section.widgets.length > 0) {
      return null;
    }

    const folderTargets = getSectionMoveTargets(section, parentId);

    return (
      <SectionContainer
        key={section.id}
        section={section}
          visibleWidgetCount={section.dynamicPattern ? undefined : visibleWidgets.length}
          onUpdate={(s) => parentId ? updateChildSection(parentId, section.id, s) : updateSection(section.id, s)}
          onToggleCollapse={() => parentId ? toggleChildSectionCollapse(parentId, section.id) : toggleSectionCollapse(section.id)}
          onDelete={() => parentId ? deleteChildSection(parentId, section.id) : deleteSection(section.id)}
          onAddWidget={() => {
            setAddWidgetSectionId(section.id);
            setAddWidgetParentId(parentId ?? null);
          }}
          onPasteWidget={() => pasteWidget(section.id, parentId)}
          hasCopiedWidget={!!copiedWidget}
          onMoveToFolder={folderTargets ? (folderId) => handleMoveSection(section.id, parentId, folderId) : undefined}
          moveFolderTargets={folderTargets}
          isEditing={isEditing}
          dynamicWidgetCount={dynamicWidgetCounts[section.id]}
          onDynamicCountChange={handleDynamicWidgetCount}
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
          drag={isEditing && !isSearching ? {
            onDragStart: (e) => handleDragStart(section.id, e, parentId),
            onDragOver: (e) => handleDragOver(section.id, e),
            onDrop: (e) => handleDrop(section.id, e),
            onDragEnd: handleDragEnd,
            onDragLeave: handleDragLeave,
            isDragging: dragState.draggedId === section.id,
            isDropTarget: dragState.dragOverId === section.id && dragState.draggedId !== section.id,
            dropPosition: dragState.dragOverId === section.id ? dragState.dropPosition : null,
          } : undefined}
        >
          {renderSectionContent(section, parentId)}
      </SectionContainer>
    );
  }

  /** Render a folder (section with children). */
  function renderFolder(section: Section) {
    return (
      <FolderContainer
        key={section.id}
        section={section}
        onUpdate={(s) => updateSection(section.id, s)}
        onToggleCollapse={() => toggleSectionCollapse(section.id)}
        onDelete={() => deleteSection(section.id)}
        onAddChildSection={(name, dp, dpm) => addChildSection(section.id, name, dp, dpm)}
        organizationId={organizationId}
        projectName={projectName}
        selectedRunIds={selectedRunIds}
        onAddWidget={() => {
          setAddWidgetSectionId(section.id);
          setAddWidgetParentId(null);
        }}
        onPasteWidget={() => pasteWidget(section.id)}
        hasCopiedWidget={!!copiedWidget}
        dynamicWidgetCounts={dynamicWidgetCounts}
        isEditing={isEditing}
        drag={isEditing && !isSearching ? {
          onDragStart: (e) => handleDragStart(section.id, e),
          onDragOver: (e) => handleDragOver(section.id, e),
          onDrop: (e) => handleDrop(section.id, e),
          onDragEnd: handleDragEnd,
          onDragLeave: handleDragLeave,
          isDragging: dragState.draggedId === section.id,
          isDropTarget: dragState.dragOverId === section.id && dragState.draggedId !== section.id,
          dropPosition: dragState.dragOverId === section.id ? dragState.dropPosition : null,
        } : undefined}
      >
        {/* Child sections inside the folder */}
        {(section.children ?? []).map((child) => renderSection(child, section.id))}

        {/* Folder's direct widgets (after sections) */}
        {section.widgets.length > 0 && renderSectionContent(section)}

        {/* Add child section / widget buttons inside folder */}
        {isEditing && (
          <div className="flex items-center justify-center gap-2 py-2">
            <AddSectionButton
              onAddSection={(name, dp, dpm) => addChildSection(section.id, name, dp, dpm)}
              organizationId={organizationId}
              projectName={projectName}
              selectedRunIds={selectedRunIds}
            />
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setAddWidgetSectionId(section.id);
                setAddWidgetParentId(null);
              }}
            >
              <PlusIcon className="mr-1.5 size-3.5" />
              Add Widget
            </Button>
          </div>
        )}
      </FolderContainer>
    );
  }

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
        onToggleAllSections={toggleAllSections}
        hasChildSections={hasChildSections}
        allChildrenCollapsed={allChildrenCollapsed}
        onToggleAllChildSections={toggleAllChildSections}
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
              : "This dashboard is empty. Start by adding a section or folder."}
          </p>
          {isEditing && !isSearching && (
            <div className="flex items-center gap-2">
              <AddSectionButton
                onAddSection={addSection}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
              <AddFolderButton onAddFolder={addFolder} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSections.map((section) => {
            // Render a section or folder depending on whether it has children
            if (configOps.isFolder(section)) {
              return renderFolder(section);
            }
            return renderSection(section);
          })}

          {isEditing && (
            <div className="flex items-center justify-center gap-2 py-4">
              <AddSectionButton
                onAddSection={addSection}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
              <AddFolderButton onAddFolder={addFolder} />
            </div>
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
        onAdd={editingWidget ? handleEditWidgetSave : (w) => addWidgetSectionId && addWidget(addWidgetSectionId, w, addWidgetParentId ?? undefined)}
        organizationId={organizationId}
        projectName={projectName}
        editWidget={editingWidget ?? undefined}
        selectedRunIds={selectedRunIds}
      />

      {/* Fullscreen Chart Dialog */}
      {fullscreenWidget && fullscreenWidget.type === "chart" && (
        <ChartFullscreenDialog
          open={true}
          onOpenChange={(open) => { if (!open) setFullscreenWidget(null); }}
          title={fullscreenWidget.config.title || (fullscreenWidget.config as ChartWidgetConfig).metrics[0] || "Chart"}
          logXAxis={(fullscreenWidget.config as ChartWidgetConfig).xAxisScale === "log"}
          logYAxis={(fullscreenWidget.config as ChartWidgetConfig).yAxisScale === "log"}
          onLogScaleChange={(axis, value) => {
            updateWidgetScale(fullscreenWidget.id, axis, value);
            const scaleValue = value ? "log" : "linear";
            setFullscreenWidget((prev) =>
              prev
                ? { ...prev, config: { ...prev.config, ...(axis === "x" ? { xAxisScale: scaleValue } : { yAxisScale: scaleValue }) } }
                : null
            );
          }}
        >
          <WidgetRenderer
            widget={fullscreenWidget}
            groupedMetrics={groupedMetrics}
            selectedRuns={selectedRuns}
            organizationId={organizationId}
            projectName={projectName}
            settingsRunId={settingsRunId}
            yZoomRange={widgetYZoomRanges[fullscreenWidget.id] ?? null}
            onYZoomRangeChange={(range) => setWidgetYZoomRanges((prev) => ({ ...prev, [fullscreenWidget.id]: range }))}
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
