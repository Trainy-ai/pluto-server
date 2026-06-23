import type { PinSource } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { formatAxisLabel } from "@/components/charts/lib/format";

/**
 * Provenance for a `best-step` pin — surfaced in the pin badge tooltip.
 * Shared across image / video / audio media widgets so the pin badge looks
 * and reads the same regardless of media type.
 */
export interface PinBestStepMeta {
  metricStep: number;
  metricValue: number | null;
  metricLogName: string;
  operation: "argmin" | "argmax";
  distance: number;
  tiedAlternativeImageStep: number | null;
}

/** Ring (border) class for a pinned media tile, keyed by pin source. */
export function pinRingClass(source: PinSource | null | undefined): string {
  switch (source) {
    case "best-step":
      return "ring-2 ring-amber-500/40";
    case "cross-panel":
      return "ring-2 ring-violet-500/40";
    case "local":
      return "ring-2 ring-primary/30";
    default:
      return "";
  }
}

/** Badge background/text class for the "Step N" pin badge, keyed by source. */
export function pinBadgeClass(source: PinSource | null | undefined): string {
  switch (source) {
    case "best-step":
      return "bg-amber-500/15 text-amber-400";
    case "cross-panel":
      return "bg-violet-500/15 text-violet-400";
    case "local":
      return "bg-muted text-muted-foreground";
    default:
      return "";
  }
}

/** Glyph suffix shown after "Step N" to telegraph the pin source. */
export function pinBadgeSymbol(source: PinSource | null | undefined): string {
  switch (source) {
    case "local":
      return "◇";
    case "cross-panel":
      return "◈";
    case "best-step":
      return "★";
    default:
      return "";
  }
}

/**
 * Build the provenance lines shown in the pin badge's hover tooltip. Only
 * populated for `best-step` pins — other sources return null (no extra hint).
 *
 * `noun` lets the caller scope the wording to the media type ("Image",
 * "Video", "Audio") so the same helper reads correctly everywhere.
 */
export function buildPinBadgeLines(
  pinSource: PinSource | null | undefined,
  pinBestStepMeta: PinBestStepMeta | null | undefined,
  pinnedStep: number | null | undefined,
  noun: string = "Image",
): string[] | null {
  if (pinSource !== "best-step" || !pinBestStepMeta) return null;
  const {
    metricStep,
    metricValue,
    metricLogName,
    operation,
    distance,
    tiedAlternativeImageStep,
  } = pinBestStepMeta;
  const opLabel = operation === "argmin" ? "min" : "max";
  // Headline reminds the user *what* they pinned (metric + op + value) so
  // they don't have to remember which button they hit.
  const headline = metricLogName
    ? metricValue != null
      ? `Pinned at ${opLabel} ${metricLogName} = ${formatAxisLabel(metricValue)}`
      : `Pinned at ${opLabel} ${metricLogName}`
    : `Pinned at ${opLabel} value`;
  const lines = [
    headline,
    `Metric step: ${metricStep}`,
    distance === 0
      ? `${noun} step matches metric step exactly`
      : `${noun} step ${pinnedStep} is ${distance} step${distance === 1 ? "" : "s"} away`,
  ];
  if (tiedAlternativeImageStep != null) {
    lines.push(
      `Tied with step ${tiedAlternativeImageStep} at the same distance — later step preferred`,
    );
  }
  return lines;
}
