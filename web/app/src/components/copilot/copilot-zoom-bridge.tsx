import { useEffect } from "react";
import { useChartSyncContext } from "@/components/charts/context/chart-sync-context";
import { useCopilotActions } from "./copilot-provider";

/**
 * Publishes the charts' current zoom to the copilot as a step window.
 *
 * Rendered inside a ChartSyncProvider because that is where the synced zoom
 * lives; the pages that publish the rest of the page context sit above every
 * provider and cannot read it. Renders nothing.
 *
 * Only a step-axis zoom is published. `zoomGroup` carries the source chart's
 * x-axis kind, and translating a time-axis zoom back to steps needs the
 * per-run time→step mapping each chart holds privately — so rather than
 * guess, a time-axis zoom publishes nothing and the model reads the full
 * range, as it did before.
 */
export function CopilotZoomBridge() {
  const sync = useChartSyncContext();
  const actions = useCopilotActions();
  const publish = actions?.publishStepWindow;
  const range = sync?.syncedZoomRange ?? null;
  // A ref, so it is not in the dependency list; it is written synchronously
  // before `syncedZoomRange` changes, so reading it here sees this zoom's group.
  const group = sync?.syncedZoomGroupRef.current ?? null;

  useEffect(() => {
    if (!publish) return;
    if (!range || group !== "step") {
      publish(null);
      return;
    }
    // Debounced: a drag fires setScale continuously, and each publish
    // re-renders the copilot's chips and composer.
    const timer = window.setTimeout(() => {
      publish({ min: Math.floor(range[0]), max: Math.ceil(range[1]) });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [publish, range, group]);

  useEffect(() => {
    if (!publish) return;
    return () => publish(null);
  }, [publish]);

  return null;
}
