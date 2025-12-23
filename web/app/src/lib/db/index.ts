import { LocalCache } from "./local-cache";
// Types
export type MetricDataPoint = {
  step: number;
  time: string;
  value: number;
};

const MAX_DB_SIZE = 1024 * 1024 * 1024; // 1GB in bytes

export const metricsCache = new LocalCache<MetricDataPoint[]>(
  "metricsDB",
  "metrics",
  MAX_DB_SIZE,
);
