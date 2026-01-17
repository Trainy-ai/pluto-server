import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { env } from "./env";

// Singleton ClickHouse client - reused across all requests
const client = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
});

// Singleton wrapper with query helper method
export const clickhouse = {
  async query(
    query: string,
    query_params: Record<string, unknown> | undefined
  ) {
    const result = await client.query({
      query,
      format: "JSONEachRow",
      query_params,
    });
    return result;
  },
};

// Legacy class export for backwards compatibility (deprecated)
export class Clickhouse {
  async query(
    query: string,
    query_params: Record<string, unknown> | undefined
  ) {
    return clickhouse.query(query, query_params);
  }
}
