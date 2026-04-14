import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { env } from "./env";

// Singleton ClickHouse client - reused across all requests
const client = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
});

// Optional per-call metadata for slow-query logging. `label` tags the call
// site so the warning line is greppable (e.g. "queryDistinctMetrics").
export interface ClickhouseQueryOpts {
  label?: string;
}

// Cap log payloads so one pathological query can't flood the log buffer.
const SLOW_QUERY_SQL_CAP = 2000;
const SLOW_QUERY_PARAMS_CAP = 1000;
// Summarize arrays larger than this before stringifying, to avoid allocating
// huge JSON strings (e.g. thousands of runIds) that would hit V8 string limits.
const PARAMS_ARRAY_SUMMARY_LIMIT = 20;

function truncate(value: string, cap: number): string {
  return value.length > cap
    ? `${value.slice(0, cap)}… (+${value.length - cap} chars)`
    : value;
}

function paramsReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value) && value.length > PARAMS_ARRAY_SUMMARY_LIMIT) {
    return [
      ...value.slice(0, PARAMS_ARRAY_SUMMARY_LIMIT),
      `…(+${value.length - PARAMS_ARRAY_SUMMARY_LIMIT} more)`,
    ];
  }
  return value;
}

function formatParams(
  query_params: Record<string, unknown> | undefined
): string {
  if (!query_params || Object.keys(query_params).length === 0) return "";
  try {
    return ` params=${truncate(JSON.stringify(query_params, paramsReplacer), SLOW_QUERY_PARAMS_CAP)}`;
  } catch {
    return " params=<unserializable>";
  }
}

// Singleton wrapper with query helper method
export const clickhouse = {
  async query(
    query: string,
    query_params: Record<string, unknown> | undefined,
    opts?: ClickhouseQueryOpts
  ) {
    const t0 = performance.now();
    const result = await client.query({
      query,
      format: "JSONEachRow",
      query_params,
    });
    const ms = performance.now() - t0;
    if (ms > 1000) {
      // Log slow queries (>1s) with enough context to identify the call site:
      // full (capped) query text, serialized params, and an optional label.
      // Slice before normalizing so the regex doesn't scan multi-MB queries.
      const normalized = query
        .slice(0, SLOW_QUERY_SQL_CAP * 2)
        .replace(/\s+/g, " ")
        .trim();
      const sql = truncate(normalized, SLOW_QUERY_SQL_CAP);
      const tag = opts?.label ? ` [${opts.label}]` : "";
      console.warn(
        `[clickhouse] slow query (${ms.toFixed(0)}ms)${tag}: ${sql}${formatParams(query_params)}`
      );
    }
    return result;
  },
};

// Legacy class export for backwards compatibility (deprecated)
export class Clickhouse {
  async query(
    query: string,
    query_params: Record<string, unknown> | undefined,
    opts?: ClickhouseQueryOpts
  ) {
    return clickhouse.query(query, query_params, opts);
  }
}
