/** Client-side mirror of the backend's `computeRunGroupKey`. Given a
 *  Run object and a groupBy chain, returns the JSON-stringified
 *  `[{field, value}, …]` trail — the same canonical pathKey shape
 *  the bucket tree uses on both sides.
 *
 *  We can do this on the client because every Run carries the columns
 *  needed: `name` / `status` / `tags` directly, `_flatConfig` /
 *  `_flatSystemMetadata` from the list-runs proc's denormalisation
 *  step. So for any user-selected run we can compute its bucket trail
 *  without a backend round-trip — driving the "is this group selected"
 *  signal for the bucket-header eye's 3rd state.
 *
 *  Mirrors `web/server/lib/group-field.ts` parseGroupField + the
 *  per-kind branches of `web/server/lib/group-run-assignment.ts`
 *  `valueForRun`. Keep in lockstep when adding new field kinds. */

interface RunForGrouping {
  name: string;
  status: string;
  tags: string[];
  /** Denormalised creator info from runs.list's Prisma
   *  `creator: { select: { name, email } }` — used so a run grouped
   *  by `system:creator.name` can map back to the same bucket the
   *  server placed it in. Without this the client returned null
   *  here and every "Owner" bucket showed as un-selected on the
   *  bucket tree even when the leaf run WAS selected. */
  creator?: { name?: string | null; email?: string | null } | null;
  _flatConfig?: Record<string, unknown>;
  _flatSystemMetadata?: Record<string, unknown>;
}

interface ParsedField {
  kind: "system" | "config" | "systemMetadata" | "tag-prefix";
  key: string;
}

const KINDS = new Set(["system", "config", "systemMetadata", "tag-prefix"]);

function parseField(field: string): ParsedField | null {
  const idx = field.indexOf(":");
  if (idx <= 0 || idx === field.length - 1) return null;
  const kind = field.slice(0, idx);
  if (!KINDS.has(kind)) return null;
  return { kind: kind as ParsedField["kind"], key: field.slice(idx + 1) };
}

function valueForRun(run: RunForGrouping, field: string): string | null {
  const parsed = parseField(field);
  if (!parsed) return null;

  if (parsed.kind === "system") {
    if (parsed.key === "status") return run.status;
    if (parsed.key === "name") return run.name;
    if (parsed.key === "creator.name") {
      // Mirror the server's `COALESCE(u.name, u.email)` in
      // distinct-group-values.ts so the client-computed trail matches
      // the bucket the server placed the run in.
      return run.creator?.name ?? run.creator?.email ?? null;
    }
    return null;
  }

  if (parsed.kind === "config") {
    const v = run._flatConfig?.[parsed.key];
    return v == null ? null : String(v);
  }

  if (parsed.kind === "systemMetadata") {
    const v = run._flatSystemMetadata?.[parsed.key];
    return v == null ? null : String(v);
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

/** Returns the run's group trail as an array (un-stringified). Use
 *  this when you need to derive ancestor pathKeys cheaply — e.g.
 *  building a Set of all bucket pathKeys (at every depth) that a run
 *  contributes to. JSON.stringify-ing each prefix length 1..N yields
 *  the canonical pathKey at each depth. */
export function computeRunGroupTrail(
  run: RunForGrouping,
  groupBy: readonly string[],
): Array<{ field: string; value: string | null }> {
  return groupBy.map((field) => ({
    field,
    value: valueForRun(run, field),
  }));
}
