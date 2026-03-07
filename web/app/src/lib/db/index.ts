import { LocalCache } from "./local-cache";
// Types
export type MetricDataPoint = {
  step: number;
  time: string;
  value: number;
  valueFlag?: string; // "NaN" | "Inf" | "-Inf" | ""
};

export type BucketedMetricDataPoint = {
  step: number;
  time: string;
  value: number;      // avg(value) — the line
  minY: number;       // min(value) — envelope bottom
  maxY: number;       // max(value) — envelope top
  count: number;      // points in bucket
};

const MAX_DB_SIZE = 1024 * 1024 * 1024; // 1GB in bytes

export const metricsCache = new LocalCache<MetricDataPoint[]>(
  "metricsDB",
  "metrics",
  MAX_DB_SIZE,
);

export const bucketedMetricsCache = new LocalCache<BucketedMetricDataPoint[]>(
  "bucketedMetricsDB",
  "bucketedMetrics",
  MAX_DB_SIZE,
);
