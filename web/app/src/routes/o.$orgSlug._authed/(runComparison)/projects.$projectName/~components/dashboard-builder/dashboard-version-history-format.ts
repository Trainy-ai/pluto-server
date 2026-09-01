/**
 * Presentation helpers for the dashboard history sheet.
 *
 * These live apart from `dashboard-version-history.tsx` so they can be unit
 * tested: importing the component pulls in `~queries/dashboard-views`, which
 * reaches `@/utils/trpc` and validates env at import time, throwing under
 * vitest. The `DashboardVersion` import here is type-only, so it is erased and
 * nothing from the query layer is loaded at runtime.
 */

import type { DashboardVersion } from "../../~queries/dashboard-views";

const SOURCE_LABELS: Record<string, string> = {
  api: "API",
  migration: "Imported",
  restore: "Restore",
  seed: "Seed",
  web: "Web",
};

export function formatDashboardVersionActor(
  createdBy: DashboardVersion["createdBy"],
) {
  return createdBy?.name || createdBy?.id || "System";
}

export function formatDashboardVersionSource(source: string) {
  return SOURCE_LABELS[source] ?? source;
}

export function getDashboardVersionBadges(
  version: Pick<
    DashboardVersion,
    "isCurrent" | "restoredFromVersion" | "source"
  >,
) {
  return [
    ...(version.isCurrent ? ["Current"] : []),
    formatDashboardVersionSource(version.source),
    ...(version.restoredFromVersion !== null
      ? [`Restored v${version.restoredFromVersion}`]
      : []),
  ];
}
