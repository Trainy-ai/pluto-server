import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { env } from "./env";

export const client = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
});

export class Clickhouse {
  private client: ClickHouseClient;

  constructor() {
    this.client = createClient({
      url: env.CLICKHOUSE_URL,
      username: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
    });
  }

  async query(
    query: string,
    query_params: Record<string, unknown> | undefined
  ) {
    const result = await this.client.query({
      query,
      format: "JSONEachRow",
      query_params,
    });
    return result;
  }
}
