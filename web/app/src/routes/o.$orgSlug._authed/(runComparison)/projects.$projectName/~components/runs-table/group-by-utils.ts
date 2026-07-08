/** Shared helpers for the W&B-style grouping picker / chip stack.
 *  Mirrors `web/server/lib/group-field.ts` on the frontend side. */

export type GroupFieldKind = "system" | "config" | "systemMetadata" | "tag-prefix";

/** Display name for each system field exposed in the picker. */
export const SYSTEM_FIELD_LABELS: Record<string, string> = {
  status: "Status",
  name: "Name",
  "creator.name": "Owner",
};

/** Display name for each supported tag prefix. */
export const TAG_PREFIX_LABELS: Record<string, string> = {
  group: "Group",
};

export const SUPPORTED_SYSTEM_GROUP_FIELDS = ["status", "name", "creator.name"] as const;
export const SUPPORTED_TAG_PREFIXES = ["group"] as const;

export interface ParsedGroupField {
  kind: GroupFieldKind;
  key: string;
}

export function parseGroupField(field: string): ParsedGroupField | null {
  const idx = field.indexOf(":");
  if (idx <= 0 || idx === field.length - 1) return null;
  const kind = field.slice(0, idx) as GroupFieldKind;
  if (!["system", "config", "systemMetadata", "tag-prefix"].includes(kind)) return null;
  return { kind, key: field.slice(idx + 1) };
}

export function encodeGroupField(kind: GroupFieldKind, key: string): string {
  return `${kind}:${key}`;
}

/** Pretty label for a chip / row header. Falls back to the raw key for
 *  unknown system fields so we don't silently drop new server values. */
export function groupFieldLabel(field: string): string {
  const parsed = parseGroupField(field);
  if (!parsed) return field;
  if (parsed.kind === "system") return SYSTEM_FIELD_LABELS[parsed.key] ?? parsed.key;
  if (parsed.kind === "tag-prefix") return TAG_PREFIX_LABELS[parsed.key] ?? parsed.key;
  return parsed.key;
}

/** Short source label rendered as a Badge next to the field name in the
 *  picker and chip rows. */
export function groupFieldSourceLabel(field: string): string {
  const parsed = parseGroupField(field);
  if (!parsed) return "";
  switch (parsed.kind) {
    case "system":
      return "system";
    case "config":
      return "config";
    case "systemMetadata":
      return "sysmeta";
    case "tag-prefix":
      return "tag";
  }
}

/** Read a single grouping field's value off a Run. Returns `null` when
 *  the run has no value for that field (lands in the "(unset)" bucket
 *  server-side). Mirrors `applyGroupFiltersToInput` in the backend
 *  (web/server/lib/group-field.ts) — kind/key parsing identical, value
 *  lookup matches the run-shape the frontend already uses for the
 *  flat table (columns-utils.ts:50 for creator.name, _flatConfig /
 *  _flatSystemMetadata for config/sysmeta).
 *
 *  Used by display-only-selected / pin-selected-to-top in grouped mode
 *  to figure out which buckets/sub-buckets/leaf-runs contain at least
 *  one selected run, all client-side, without round-tripping the
 *  server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractRunGroupValue(run: any, field: string): string | null {
  const parsed = parseGroupField(field);
  if (!parsed) return null;
  switch (parsed.kind) {
    case "system": {
      if (parsed.key === "name") return run?.name ?? null;
      if (parsed.key === "status") return run?.status ?? null;
      // Mirror the server's `COALESCE(usort.name, usort.email)` in
      // distinct-group-values.ts:963 so email-only users don't fall
      // through to "(unset)" here while the server bucket is
      // labelled with their email — the mismatch made Owner buckets
      // read as un-selected on the bucket tree. Same fix already
      // applied to computeRunGroupTrail (c82a82800); both mirrors
      // must stay in lockstep.
      if (parsed.key === "creator.name") return run?.creator?.name ?? run?.creator?.email ?? null;
      return null;
    }
    case "config": {
      const v = run?._flatConfig?.[parsed.key];
      return v == null ? null : String(v);
    }
    case "systemMetadata": {
      const v = run?._flatSystemMetadata?.[parsed.key];
      return v == null ? null : String(v);
    }
    case "tag-prefix": {
      const prefix = `${parsed.key}:`;
      const tags: string[] = Array.isArray(run?.tags) ? run.tags : [];
      const match = tags.find((t) => typeof t === "string" && t.startsWith(prefix));
      return match ? match.slice(prefix.length) : null;
    }
  }
}

/** A path of bucket values from depth 0 down to some level, encoded as
 *  a JSON string so it's hashable. `null` entries match "(unset)"
 *  buckets server-side. Use {@link encodePath} / {@link pathAtDepth}
 *  to construct/query. */
export type EncodedAncestorPath = string;

export function encodePath(values: ReadonlyArray<string | null>): EncodedAncestorPath {
  return JSON.stringify(values);
}

/** For each depth `d` in `groupBy`, returns a Map from the encoded
 *  path of a selected run (truncated at depth `d`) to the COUNT of
 *  selected runs sharing that path. Used by the bucket tree to:
 *   - decide which buckets are "selected-containing" in O(1) (DOS
 *     filtering, Pin reordering — `map.has(path)`),
 *   - derive synthetic buckets when DOS is on so we can render
 *     selected-containing buckets that aren't on the server's current
 *     page (count comes straight from the map), and
 *   - show "N selected of M total" counts in headers if/when we
 *     decide to surface the selected count separately.
 *
 *  Example: groupBy=["system:status", "system:name"], 1 selected run
 *  with status=Failed, name=heavy-a-bs2048-005 →
 *    [ Map(['["Failed"]' → 1]),
 *      Map(['["Failed","heavy-a-bs2048-005"]' → 1]) ]
 *
 *  Use `.has(path)` for the membership question (replaces the older
 *  Set-shaped return) and `.get(path)` for the count.
 */
export function computeSelectedAncestorPaths(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedRunsWithColors: Record<string, { run: any; color: string }>,
  groupBy: readonly string[],
): Array<Map<EncodedAncestorPath, number>> {
  const levels: Array<Map<EncodedAncestorPath, number>> = groupBy.map(() => new Map());
  if (groupBy.length === 0) return levels;
  for (const entry of Object.values(selectedRunsWithColors)) {
    const run = entry.run;
    const values: Array<string | null> = groupBy.map((f) => extractRunGroupValue(run, f));
    for (let depth = 0; depth < groupBy.length; depth++) {
      const key = encodePath(values.slice(0, depth + 1));
      levels[depth].set(key, (levels[depth].get(key) ?? 0) + 1);
    }
  }
  return levels;
}
