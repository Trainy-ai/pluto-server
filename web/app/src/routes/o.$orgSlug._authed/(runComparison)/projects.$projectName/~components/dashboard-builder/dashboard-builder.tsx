import { useState, useCallback, useRef, useEffect } from "react";
import { PlusIcon, SaveIcon, XIcon, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionContainer, AddSectionButton } from "./section-container";
import { WidgetGrid } from "./widget-grid";
import { WidgetRenderer } from "./widget-renderer";
import { AddWidgetModal } from "./add-widget-modal";
import {
  useUpdateDashboardView,
  type DashboardView,
} from "../../~queries/dashboard-views";
import {
  generateId,
  type DashboardViewConfig,
  type Section,
  type Widget,
} from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";

interface DashboardBuilderProps {
  view: DashboardView;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  onClose?: () => void;
}

export function DashboardBuilder({
  view,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  onClose,
}: DashboardBuilderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [isEditing, setIsEditing] = useState(false);
  const [config, setConfig] = useState<DashboardViewConfig>(view.config);
  const [hasChanges, setHasChanges] = useState(false);
  const [addWidgetSectionId, setAddWidgetSectionId] = useState<string | null>(null);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const updateMutation = useUpdateDashboardView(organizationId, projectName);

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

  // Update config when view changes
  useEffect(() => {
    setConfig(view.config);
    setHasChanges(false);
  }, [view.config]);

  const handleSave = useCallback(() => {
    updateMutation.mutate(
      {
        organizationId,
        viewId: view.id,
        config,
      },
      {
        onSuccess: () => {
          setHasChanges(false);
          setIsEditing(false);
        },
      }
    );
  }, [updateMutation, organizationId, view.id, config]);

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
    setIsEditing(false);
    setShowCancelConfirm(false);
  }, [view.config]);

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

  const addSection = useCallback((name: string) => {
    const newSection: Section = {
      id: `section-${generateId()}`,
      name,
      collapsed: false,
      widgets: [],
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
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{view.name}</h2>
          {hasChanges && (
            <span className="text-xs text-muted-foreground">(unsaved changes)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
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
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              Edit Dashboard
            </Button>
          )}
        </div>
      </div>

      {/* Sections */}
      {config.sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground mb-4">
            This dashboard is empty. Start by adding a section.
          </p>
          {isEditing && (
            <Button
              variant="outline"
              onClick={() => addSection("New Section")}
            >
              <PlusIcon className="mr-2 size-4" />
              Add Section
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {config.sections.map((section) => (
            <SectionContainer
              key={section.id}
              section={section}
              onUpdate={(s) => updateSection(section.id, s)}
              onDelete={() => deleteSection(section.id)}
              onAddWidget={() => setAddWidgetSectionId(section.id)}
              isEditing={isEditing}
            >
              <WidgetGrid
                widgets={section.widgets}
                onLayoutChange={(widgets) => updateWidgets(section.id, widgets)}
                onEditWidget={(widget) => editWidget(section.id, widget)}
                onDeleteWidget={(widgetId) => deleteWidget(section.id, widgetId)}
                isEditing={isEditing}
                containerWidth={containerWidth - 48} // Account for padding
                renderWidget={(widget) => (
                  <WidgetRenderer
                    widget={widget}
                    groupedMetrics={groupedMetrics}
                    selectedRuns={selectedRuns}
                    organizationId={organizationId}
                    projectName={projectName}
                  />
                )}
              />
            </SectionContainer>
          ))}

          {isEditing && (
            <AddSectionButton onAddSection={addSection} />
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
        groupedMetrics={groupedMetrics}
        editWidget={editingWidget ?? undefined}
      />

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
    </div>
  );
}
