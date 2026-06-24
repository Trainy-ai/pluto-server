// `{bars}` pseudo-metric encoding.
//
// A {bars} rollup is a categorical bar chart synthesized from N scalar
// metrics that share a path prefix (e.g. `training/dataset/ag_news`,
// `training/dataset/arxiv`, ... rolls up into `training/dataset{bars}`).
// It is NOT a real metric name in mlop_metrics — it's a UI affordance
// that selects all siblings under the prefix.
//
// The encoding here represents that rollup as a string that looks like
// a metric name (`${prefix}{bars}`) so it can flow through every
// dropdown / regex / search code path that already handles metric
// names: the Distributions tab's picker (distributions-config-form),
// dynamic-section pattern matching (use-dynamic-section), the dynamic-
// section preview list (dynamic-pattern-preview). Storage uses the
// typed shape (`DistributionsEntry.kind === "bars"`); the encoded
// string only exists in transit between picker UI and the storage
// layer.
//
// The `{bars}` suffix was chosen specifically to NOT collide with `*`
// glob notation or with regex metachars used in dynamic sections.

export const CATEGORICAL_BARS_SUFFIX = "{bars}";

export function encodeBarsEntry(prefix: string): string {
  return `${prefix}${CATEGORICAL_BARS_SUFFIX}`;
}

export function isBarsEntry(displayValue: string): boolean {
  return displayValue.endsWith(CATEGORICAL_BARS_SUFFIX);
}

export function decodeBarsEntry(displayValue: string): string {
  if (!isBarsEntry(displayValue)) return displayValue;
  return displayValue.slice(0, -CATEGORICAL_BARS_SUFFIX.length);
}
