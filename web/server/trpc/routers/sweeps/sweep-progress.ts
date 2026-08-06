/**
 * Sweep-level facts derived from its runs, with no sweep entity needed.
 *
 * There is no server-side sweep record yet — a sweep is just the set of runs
 * sharing a `sweep:<id>` tag — so state and progress are computed from those
 * runs rather than stored. That turns out to be enough for everything read-only:
 * a sweep with a live run is running, and a grid sweep's total is the size of
 * the space it declared.
 */

export type SweepState = "RUNNING" | "FINISHED" | "INCOMPLETE";

export interface StatusCounts {
  total: number;
  running: number;
  completed: number;
  failed: number;
  other: number;
}

export function summarizeStatuses(statuses: string[]): StatusCounts {
  const counts: StatusCounts = {
    total: statuses.length,
    running: 0,
    completed: 0,
    failed: 0,
    other: 0,
  };
  for (const status of statuses) {
    switch (status) {
      case "RUNNING":
        counts.running++;
        break;
      case "COMPLETED":
        counts.completed++;
        break;
      // TERMINATED and CANCELLED are grouped with FAILED: for judging a sweep,
      // what matters is that the run produced no usable result, not how it
      // stopped producing one.
      case "FAILED":
      case "TERMINATED":
      case "CANCELLED":
        counts.failed++;
        break;
      default:
        counts.other++;
    }
  }
  return counts;
}

/**
 * A sweep's state, inferred from its runs.
 *
 * Unlike a run, a sweep never reports its own completion — there is no
 * `finish()` for a sweep and no entity to record one — so this is inference,
 * not fact. Two of the three cases are still solid:
 *
 * - **RUNNING** — a run is running.
 * - **INCOMPLETE** — a grid sweep that has not *completed* all of its declared
 *   combinations, with nothing running now. Either the agent died partway, or
 *   it reached the end of the grid with runs that crashed. This is the case
 *   worth separating: without it, a sweep holding results for 6 of 12
 *   combinations is indistinguishable from one that covered all 12, and you
 *   would read its "best run" as the best of the space rather than the best of
 *   a fragment.
 * - **FINISHED** — everything else. Honest for a completed grid; for random and
 *   bayes it means only "nothing is running", since those have no target count
 *   and stop when the agent is told to stop.
 *
 * Coverage counts *completed* runs, not attempted ones. A grid where all 12
 * combinations ran and 6 crashed leaves the same six-combination hole as one
 * whose agent died halfway, and the hole is what the caller needs to know
 * about — the reason for it is a separate question the status counts answer.
 *
 * The blind spot that remains: an agent alive but between runs looks idle, and
 * reads as FINISHED or INCOMPLETE. Closing that needs a sweep entity with a
 * heartbeat, the same way run liveness works.
 */
export function deriveState(
  counts: StatusCounts,
  gridTotal?: number | null,
): SweepState {
  if (counts.running > 0) {
    return "RUNNING";
  }
  if (gridTotal != null && counts.completed < gridTotal) {
    return "INCOMPLETE";
  }
  return "FINISHED";
}

/**
 * How many configurations a grid sweep will run in total: the product of each
 * parameter's value count.
 *
 * Only meaningful for `grid`. A random or bayes sweep runs until told to stop,
 * so "3 of 12" would be inventing a denominator — those return null.
 *
 * Fixed knobs (`{ value: ... }`, common in wandb configs) contribute a factor
 * of 1 — they pin a constant and do not expand the grid. Continuous axes
 * (`{min, max}`) still return null (no finite grid), as does an empty
 * parameter block — a declared-but-empty space is a space we do not know, not
 * a grid of one, and reporting 1 rendered "20 of 1 grid configurations".
 */
export function gridTotal(
  method: string | undefined,
  parameters: Record<string, unknown> | undefined,
): number | null {
  if (method !== "grid" || !parameters || Object.keys(parameters).length === 0) {
    return null;
  }

  let total = 1;
  for (const spec of Object.values(parameters)) {
    if (!spec || typeof spec !== "object") {
      return null;
    }
    const record = spec as { values?: unknown; value?: unknown };
    if (Array.isArray(record.values)) {
      if (record.values.length === 0) {
        return null;
      }
      total *= record.values.length;
      continue;
    }
    // Pinned constant — does not expand the combinatorial product.
    if (record.value !== undefined) {
      continue;
    }
    // Continuous ({min,max}) or unknown shape: no finite grid.
    return null;
  }
  return total;
}
