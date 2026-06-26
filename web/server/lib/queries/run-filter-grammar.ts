// Single source of truth for the run-filter grammar *vocabulary* — the boolean
// operators, leaf operators, and field names/prefixes the `/api/runs/list`
// `filter` query accepts. The compiler (run-filter.ts) validates against these,
// the OpenAPI `RunFilterGrammar` component (index.ts) publishes them, and the
// Pluto client contract-tests its own copy against that published component
// (tests/test_contract.py). Change the grammar here and nowhere else; the
// client/docs drift-checks then flag themselves until updated to match.
//
// NOTE: this covers only the vocabulary/structure (what's accepted), which is
// what drifts across the server/client/docs. Per-leaf semantics (the wandb-state
// alias map, operator→SQL/ClickHouse translation) stay private to run-filter.ts.

export const RUN_FILTER_BOOLEAN_OPERATORS = ["$and", "$or", "$not"] as const;

export const RUN_FILTER_LEAF_OPERATORS = [
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$regex",
] as const;

// Exact leaf field names (wandb + snake/camel aliases).
export const RUN_FILTER_FIELDS = [
  "state",
  "status",
  "heartbeat_at",
  "heartbeatAt",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "name",
  "displayName",
  "display_name",
  "tags",
] as const;

// Dotted-prefix field families (e.g. `config.lr`, `summaryMetrics.loss`).
export const RUN_FILTER_FIELD_PREFIXES = [
  "config.",
  "systemMetadata.",
  "summaryMetrics.",
  "summary_metrics.",
] as const;

export const RUN_FILTER_LEAF_OPERATOR_SET: ReadonlySet<string> = new Set(
  RUN_FILTER_LEAF_OPERATORS,
);
export const RUN_FILTER_FIELD_SET: ReadonlySet<string> = new Set(RUN_FILTER_FIELDS);

/** True if a leaf field name is in the grammar (exact name or known prefix). */
export function isKnownFilterField(field: string): boolean {
  if (RUN_FILTER_FIELD_SET.has(field)) return true;
  return RUN_FILTER_FIELD_PREFIXES.some(
    (p) => field.startsWith(p) && field.length > p.length,
  );
}
