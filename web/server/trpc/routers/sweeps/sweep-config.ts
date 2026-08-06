/**
 * Reading a sweep's search space out of a run.
 *
 * There are two producers and they agree on the contents but not the shape, so
 * this is the one place that knows the difference:
 *
 * - **Migrated (wandb)** — nested, under
 *   `config.wandb.sweep = {id, name, config: {method, metric, parameters}}`.
 * - **Native (`pluto.sweep()`)** — flat, under
 *   `config.sweep = {id, method, metric, parameters}` (pluto `7225ba9`). No
 *   `name`, and the fields sit directly on the block rather than under a nested
 *   `config` key.
 *
 * Native runs logged before that SDK change carry only the sampled combination
 * and the `sweep:<id>` tag, so everything here stays optional and callers must
 * still degrade — see `inferSweptKeys`, which covers exactly that case.
 */

/** The two directions an objective can point. */
export type SweepGoal = "minimize" | "maximize";

export interface SweepMeta {
  name?: string;
  method?: string;
  metric?: { name: string; goal: SweepGoal };
  /** Declared search space, when the producer told us one. */
  parameters?: Record<string, unknown>;
}

/** Narrow an unknown JSON value to a plain object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Parse a `config.wandb.sweep` block. Returns an empty object for anything
 * unrecognised — a native sweep has no block at all, which is normal, not an
 * error.
 */
export function parseSweepBlock(block: unknown): SweepMeta {
  const root = asRecord(block);
  if (!root) {
    return {};
  }

  const meta: SweepMeta = {};
  if (typeof root.name === "string") {
    meta.name = root.name;
  }

  // wandb nests the spec under `config`; the native SDK puts it on the block
  // itself. Accept either so both kinds take one path from here on.
  const config = asRecord(root.config) ?? root;

  if (typeof config.method === "string") {
    meta.method = config.method;
  }

  const metric = asRecord(config.metric);
  if (metric && typeof metric.name === "string") {
    meta.metric = {
      name: metric.name,
      // wandb defaults an omitted goal to minimize; mirror that rather than
      // inventing a third state the UI would have to explain. Anything that is
      // neither direction gets the same treatment — the goal reaches a two-item
      // picker, and passing an unrecognised string through left it blank.
      goal: metric.goal === "maximize" ? "maximize" : "minimize",
    };
  }

  const parameters = asRecord(config.parameters);
  if (parameters) {
    meta.parameters = parameters;
  }

  return meta;
}

/**
 * Work out which config keys were actually swept.
 *
 * Prefers the declared search space when there is one. Otherwise — the native
 * case — infers it: a key that takes more than one distinct value across the
 * sweep's runs was varied, and a key that is constant was not. That inference
 * is why a native sweep still gets a useful parallel-coordinates chart without
 * the server knowing anything about the search space.
 *
 * Nested/object values are ignored: `config.wandb` is itself a config key, and
 * a swept hyperparameter is a scalar by construction.
 */
export function inferSweptKeys(
  configs: Record<string, unknown>[],
  declared?: Record<string, unknown>,
): string[] {
  if (declared && Object.keys(declared).length > 0) {
    return Object.keys(declared).sort();
  }

  const seen = new Map<string, Set<string>>();
  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      if (value === null || typeof value === "object") {
        continue;
      }
      if (!seen.has(key)) {
        seen.set(key, new Set());
      }
      seen.get(key)!.add(JSON.stringify(value));
    }
  }

  return [...seen.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key)
    .sort();
}
