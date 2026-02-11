/**
 * Props comparison utilities for MultiGroup memoization
 * Extracted to a separate file for testing without React/trpc dependencies
 */

import type { RunLogType, RunStatus } from "@/lib/grouping/types";

export interface MultiGroupPropsForComparison {
  title: string;
  groupId: string;
  organizationId: string;
  projectName: string;
  className?: string;
  boundsResetKey?: number;
  metrics: {
    name: string;
    type: RunLogType;
    data: {
      runId: string;
      runName: string;
      color: string;
      status: RunStatus;
    }[];
  }[];
}

/**
 * Custom comparison function for deep equality of MultiGroup metrics
 * This prevents unnecessary re-renders when metrics content hasn't changed
 */
export function arePropsEqual(
  prevProps: MultiGroupPropsForComparison,
  nextProps: MultiGroupPropsForComparison
): boolean {
  // Quick checks for primitive values
  if (
    prevProps.title !== nextProps.title ||
    prevProps.groupId !== nextProps.groupId ||
    prevProps.organizationId !== nextProps.organizationId ||
    prevProps.projectName !== nextProps.projectName ||
    prevProps.className !== nextProps.className ||
    prevProps.boundsResetKey !== nextProps.boundsResetKey
  ) {
    return false;
  }

  // Deep comparison of metrics array
  const prevMetrics = prevProps.metrics;
  const nextMetrics = nextProps.metrics;

  if (prevMetrics.length !== nextMetrics.length) {
    return false;
  }

  for (let i = 0; i < prevMetrics.length; i++) {
    const prev = prevMetrics[i];
    const next = nextMetrics[i];

    if (prev.name !== next.name || prev.type !== next.type) {
      return false;
    }

    // Compare data arrays
    if (prev.data.length !== next.data.length) {
      return false;
    }

    for (let j = 0; j < prev.data.length; j++) {
      const prevData = prev.data[j];
      const nextData = next.data[j];

      if (
        prevData.runId !== nextData.runId ||
        prevData.runName !== nextData.runName ||
        prevData.color !== nextData.color ||
        prevData.status !== nextData.status
      ) {
        return false;
      }
    }
  }

  return true;
}
