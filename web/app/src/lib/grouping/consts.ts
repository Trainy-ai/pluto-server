import type { RunLogType } from "./types";

export const LOG_GROUP_MAPPING: Record<RunLogType, string> = {
  METRIC: "metrics",
  AUDIO: "media",
  IMAGE: "media",
  VIDEO: "media",
  FILE: "files",
  TEXT: "files",
  ARTIFACT: "files",
  HISTOGRAM: "histogram",
  TABLE: "table",
  // String metrics are a metric whose values happen to be words, so they
  // belong beside the numeric charts rather than in a tab of their own.
  // `DATA` is the generic storage log type and is used by nothing else.
  DATA: "metrics",
};

export const LOG_GROUP_INDEX: Record<string, number> = {
  metrics: 0,
  media: 1,
  other: -7,
  files: -6,
  sys: -1,
  param: -3,
  grad: -4,
  audio: -5,
  image: -2,
} as const;

/**
 * The group real media is re-homed into by the all-runs Charts view.
 *
 * `LOG_GROUP_MAPPING` sends FILE/TEXT/ARTIFACT to `files`, and that is what the
 * *individual run* page renders — a run's Files section is a real, useful
 * thing there. The all-runs view overrides it: a migrated `wandb.Html` page or
 * an `Object3D` point cloud is media, and belongs beside the images and video
 * rather than in a bucket named after its storage type. See
 * `metrics-display.tsx`, which is the only place that override happens.
 *
 * Exported so that override reads off this file instead of hardcoding the
 * string — the two must agree or the re-homed metrics land in a group that
 * `LOG_GROUP_INDEX` has no sort position for.
 *
 * On saved layouts: `charts_layouts.config` keys `order`/`hidden`/`metricOrder`
 * by *section*, so a project whose artifacts move from `files` to `media`
 * leaves those `files` entries inert. That is safe by construction —
 * `applyChartsSections` drops sections that no longer exist and degrades
 * membership entries pointing at them back to the metric's derived home (see
 * `~lib/charts-layout.ts`). `membership` itself is keyed by *metric name*, not
 * by group, so a user's custom section assignments survive the move intact.
 */
export const MEDIA_GROUP = "media";

/**
 * Display-only labels for derived group keys.
 *
 * The keys above are also the ids saved layouts persist against
 * (charts_layouts.config order/hidden/metricOrder/membership), so they must
 * stay stable — renaming one would orphan a user's saved arrangement for that
 * section. These override the rendered heading instead, which is all the
 * singular/plural inconsistency ("table"/"histogram" next to
 * "metrics"/"files") ever was.
 */
export const LOG_GROUP_LABEL: Record<string, string> = {
  table: "tables",
  histogram: "histograms",
};

/** Heading text for a group key. Falls back to the key (user logGroups). */
export function getLogGroupLabel(groupName: string): string {
  return LOG_GROUP_LABEL[groupName] ?? groupName;
}
