/** Compute each run's leaf-bucket trail under a given `groupBy` chain.
 *  Used by the grouped chart endpoint to map runId → bucket pathKey
 *  so ClickHouse can aggregate at the bucket level.
 *
 *  The pathKey shape mirrors the frontend's `pathKey(filters)` exactly
 *  (`JSON.stringify([{field, value}, ...])`) so a run's bucket trail
 *  here matches the same trail the runs-table tree builds. */

import { parseGroupField } from "./group-field";

/** Minimal run shape this helper needs. Mirrors the columns the
 *  grouped chart proc fetches before calling in. */
export interface RunForGrouping {
  id: bigint;
  name: string;
  status: string;
  tags: string[];
  /** May be missing — runs without a Postgres user record fall through
   *  to the "unset" bucket for `system:creator.name`. */
  creatorName: string | null;
  creatorEmail: string | null;
}

/** Per-run, per-(source, key) field values pulled from
 *  `run_field_values`. Caller fetches this once, in bulk, before
 *  invoking `computeRunGroupKey`. */
export type FieldValuesByRun = Map<bigint, Map<string, string | null>>;
//                                          ^^^^^^ key = "source:key"

interface GroupValue {
  field: string;
  value: string | null;
}

/** Extract the value a run carries for one encoded group field.
 *  Returns null for the "(unset)" bucket. */
function valueForRun(
  run: RunForGrouping,
  field: string,
  fieldValues: Map<string, string | null> | undefined,
): string | null {
  const parsed = parseGroupField(field);
  if (!parsed) return null;

  if (parsed.kind === "system") {
    if (parsed.key === "status") return run.status;
    if (parsed.key === "name") return run.name;
    if (parsed.key === "creator.name") {
      return run.creatorName ?? run.creatorEmail ?? null;
    }
    return null;
  }

  if (parsed.kind === "config" || parsed.kind === "systemMetadata") {
    const v = fieldValues?.get(`${parsed.kind}:${parsed.key}`);
    return v == null ? null : v;
  }

  if (parsed.kind === "tag-prefix") {
    const prefix = `${parsed.key}:`;
    for (const tag of run.tags) {
      if (tag.startsWith(prefix)) {
        const body = tag.slice(prefix.length);
        return body.length > 0 ? body : null;
      }
    }
    return null;
  }

  return null;
}

/** Compute the leaf-bucket trail for one run under a groupBy chain.
 *  Returns the JSON-stringified `GroupValue[]` — the canonical
 *  pathKey form the frontend uses. */
export function computeRunGroupKey(
  run: RunForGrouping,
  groupBy: readonly string[],
  fieldValues: Map<string, string | null> | undefined,
): string {
  const trail: GroupValue[] = [];
  for (const field of groupBy) {
    trail.push({ field, value: valueForRun(run, field, fieldValues) });
  }
  return JSON.stringify(trail);
}

/** Compute group keys for every run in one pass. Returns a Map keyed
 *  by numeric runId — the shape the grouped CH helper expects. */
export function buildRunGroupKeyMap(
  runs: readonly RunForGrouping[],
  groupBy: readonly string[],
  allFieldValues: FieldValuesByRun,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const run of runs) {
    const fv = allFieldValues.get(run.id);
    out.set(Number(run.id), computeRunGroupKey(run, groupBy, fv));
  }
  return out;
}

/** Which (source, key) pairs do we need to pre-fetch from
 *  run_field_values for a given groupBy chain? Only config and
 *  systemMetadata fields land here — system / tag-prefix come from
 *  columns on Runs itself. */
export function fieldValueKeysNeeded(
  groupBy: readonly string[],
): Array<{ source: "config" | "systemMetadata"; key: string }> {
  const out: Array<{ source: "config" | "systemMetadata"; key: string }> = [];
  for (const field of groupBy) {
    const parsed = parseGroupField(field);
    if (parsed && (parsed.kind === "config" || parsed.kind === "systemMetadata")) {
      out.push({ source: parsed.kind, key: parsed.key });
    }
  }
  return out;
}
