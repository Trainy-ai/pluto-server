import type { Run } from "../../../~queries/list-runs";

/**
 * Build a minimal Run for unit tests. Only fields that the runs-table
 * helpers actually inspect are populated; pass `overrides` to add or
 * shadow anything else (e.g. `_flatConfig`, `metricSummaries`, custom
 * `name`, status, timestamps).
 *
 * Shared across the runs-table __tests__ folder so we don't drift four
 * copies of the same shape.
 */
export function makeRun(
  id: string,
  overrides: Partial<Run> & Record<string, any> = {},
): Run {
  return {
    id,
    name: `run-${id}`,
    status: "COMPLETED",
    tags: [],
    createdAt: "2025-03-01T12:00:00.000Z",
    updatedAt: "2025-03-02T14:30:00.000Z",
    ...overrides,
  } as Run;
}
