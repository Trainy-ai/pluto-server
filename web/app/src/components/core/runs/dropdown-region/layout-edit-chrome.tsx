import { Eye, EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useChartsLayoutEdit,
  type ChartsLayoutEditApi,
} from "@/components/charts/context/charts-layout-edit-context";

/**
 * Charts-view layout-edit chrome for DropdownRegion, kept out of the shared
 * grid/pagination render path. Every piece consumes the layout-edit context
 * itself and renders nothing (or returns no props) when the editor is
 * inactive, so non-Charts consumers of DropdownRegion are unaffected.
 */

/** Header grip that drags the whole section to reorder it. */
export function SectionDragHandle({ groupId }: { groupId: string }) {
  const layoutEdit = useChartsLayoutEdit();
  if (!layoutEdit) {
    return null;
  }
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", groupId);
        layoutEdit.startSectionDrag(groupId);
      }}
      onDragEnd={() => layoutEdit.endSectionDrag()}
      className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
      data-testid="charts-layout-section-handle"
      data-group-key={layoutEdit.getSectionKey(groupId)}
      aria-label="Drag to reorder section"
    >
      <GripVertical className="h-5 w-5" />
    </span>
  );
}

/** Header eye toggle that hides/shows the section in the shared layout. */
export function SectionHideToggle({ groupId }: { groupId: string }) {
  const layoutEdit = useChartsLayoutEdit();
  if (!layoutEdit) {
    return null;
  }
  const isHidden = layoutEdit.isSectionHidden(groupId);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => layoutEdit.toggleSectionHidden(groupId)}
      aria-label={isHidden ? "Show section" : "Hide section"}
      title={isHidden ? "Hidden — click to show" : "Visible — click to hide"}
      data-testid="charts-layout-section-hide"
    >
      {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}

/** Hover grip on a chart card that drags it to reorder within its section. */
export function ChartDragHandle({
  groupId,
  index,
  metricName,
  isDragged,
}: {
  groupId: string;
  index: number;
  metricName: string | undefined;
  isDragged: boolean;
}) {
  const layoutEdit = useChartsLayoutEdit();
  if (!layoutEdit) {
    return null;
  }
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", metricName ?? "");
        layoutEdit.startItemDrag(groupId, index);
      }}
      onDragEnd={() => layoutEdit.endItemDrag()}
      className={cn(
        "absolute -left-2 -top-2 z-30 h-6 w-6 cursor-grab rounded-full border bg-background p-1 text-muted-foreground shadow transition-opacity active:cursor-grabbing",
        "opacity-0 group-hover:opacity-100",
        isDragged && "!opacity-100",
      )}
      data-testid="charts-layout-chart-handle"
      data-metric-name={metricName}
      aria-label="Drag to reorder chart"
    >
      <GripVertical className="h-full w-full" />
    </span>
  );
}

type DropProps = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onDragOver" | "onDrop"
>;

const NO_DROP_PROPS: DropProps = {};

/**
 * Container drag handlers for a section: while another section is being
 * dragged over this one, live-preview the reorder (top half = before, bottom
 * half = after). Returns an empty prop bag when not a drop target. Plain
 * function (not a hook) so callers can use it per-item inside render loops.
 */
export function getSectionDropProps(
  layoutEdit: ChartsLayoutEditApi | null,
  groupId: string,
): DropProps {
  if (!layoutEdit?.draggedSectionId || layoutEdit.draggedSectionId === groupId) {
    return NO_DROP_PROPS;
  }
  return {
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      layoutEdit.moveSectionOver(
        groupId,
        e.clientY < rect.top + rect.height / 2 ? "before" : "after",
      );
    },
    onDrop: (e) => {
      e.preventDefault();
      layoutEdit.endSectionDrag();
    },
  };
}

/**
 * Drag handlers for a chart card: while a sibling chart is dragged over it,
 * live-preview the reorder (left half = before, right half = after). Plain
 * function (not a hook) so callers can use it per-card inside render loops.
 */
export function getChartDropProps(
  layoutEdit: ChartsLayoutEditApi | null,
  groupId: string,
  index: number,
  isDragged: boolean,
): DropProps {
  if (layoutEdit?.draggedItem?.groupId !== groupId) {
    return NO_DROP_PROPS;
  }
  return {
    onDragOver: isDragged
      ? undefined
      : (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          layoutEdit.moveItemOver(
            groupId,
            index,
            e.clientX < rect.left + rect.width / 2 ? "before" : "after",
          );
        },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      layoutEdit.endItemDrag();
    },
  };
}
