/**
 * Pure utility function for translating zoom ranges between axis types.
 * Extracted from use-zoom-refetch.ts to keep it testable without React/tRPC deps.
 */

import { interpolate } from "@/components/charts/context/chart-sync-context";

/** Mapping of run ID → sorted parallel arrays of relative-time seconds and steps */
export type TimeStepMapping = Map<string, { relTimeSecs: number[]; steps: number[] }>;

/**
 * Translate a zoom range to step bounds based on the selectedLog mode.
 *
 * - "Step": passes through with floor/ceil rounding.
 * - "Relative Time": translates seconds → step range using the mapping.
 *   For multi-run, takes the widest step range across all runs.
 * - Other modes: returns null (no zoom refetch support).
 */
export function translateZoomToStepRange(
  rawZoomRange: [number, number] | null,
  selectedLog: string,
  timeStepMapping?: TimeStepMapping | null,
): [number, number] | null {
  if (!rawZoomRange) return null;

  if (selectedLog === "Step") {
    return [Math.floor(rawZoomRange[0]), Math.ceil(rawZoomRange[1])];
  }

  if (
    selectedLog === "Relative Time" &&
    timeStepMapping &&
    timeStepMapping.size > 0
  ) {
    // Translate time range to step range across all runs.
    // Use the widest step range that covers the time window for any run.
    let minStep = Infinity;
    let maxStep = -Infinity;
    for (const { relTimeSecs, steps } of timeStepMapping.values()) {
      if (relTimeSecs.length === 0) continue;
      const s0 = interpolate(relTimeSecs, steps, rawZoomRange[0]);
      const s1 = interpolate(relTimeSecs, steps, rawZoomRange[1]);
      minStep = Math.min(minStep, s0);
      maxStep = Math.max(maxStep, s1);
    }
    if (minStep !== Infinity && maxStep !== -Infinity) {
      return [Math.floor(minStep), Math.ceil(maxStep)];
    }
  }

  return null;
}
