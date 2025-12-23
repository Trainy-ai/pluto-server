export interface MetricData {
  runId: string;
  runName: string;
  color: string;
}

export interface GroupedMetrics {
  [group: string]: {
    metrics: {
      name: string;
      type: "METRIC" | "AUDIO" | "IMAGE";
      data: MetricData[];
    }[];
    groupName: string;
  };
}
