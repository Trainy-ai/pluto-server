import { getLogGroupName } from "@/lib/grouping/index";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { trpc } from "@/utils/trpc";

type Run = inferOutput<typeof trpc.runs.list>["runs"][number];
type RunLog = Run["logs"][number];

/**
 * Cache structure for stable output references.
 * Uses a Map keyed by project context to ensure isolation between projects.
 * This prevents cross-project data leakage when multiple tabs are open.
 */
interface CacheEntry {
  inputRef: Record<string, { run: Run; color: string }> | null;
  inputKey: string | null;
  output: GroupedMetrics | null;
}

// Project-scoped cache - ensures isolation between different projects
const projectCaches = new Map<string, CacheEntry>();

/**
 * Gets or creates a cache entry for the given project context
 */
function getCacheEntry(projectKey: string): CacheEntry {
  let entry = projectCaches.get(projectKey);
  if (!entry) {
    entry = { inputRef: null, inputKey: null, output: null };
    projectCaches.set(projectKey, entry);
  }
  return entry;
}

/**
 * Generates a cache key from the input that captures what actually matters for rendering:
 * - Which runs are selected (by ID)
 * - What color each run has
 * - Run status (affects chart behavior)
 */
function generateCacheKey(
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): string {
  const entries = Object.entries(selectedRunsWithColors)
    .map(([id, { color, run }]) => `${id}:${color}:${run.status}`)
    .sort()
    .join("|");
  return entries;
}

/**
 * Groups metrics from selected runs by their log groups
 *
 * This function takes selected runs with their assigned colors and organizes
 * their metrics into groups based on log type and group. Each metric within
 * a group includes reference to the runs it belongs to with their colors.
 *
 * PERFORMANCE: Uses caching to return stable references when the input
 * hasn't meaningfully changed, preventing unnecessary downstream re-renders.
 *
 * SECURITY: Cache is scoped by organizationId and projectName to prevent
 * cross-project data leakage when multiple tabs are open.
 *
 * @param selectedRunsWithColors - Record of selected runs with their assigned colors
 * @param organizationId - Organization ID for cache scoping
 * @param projectName - Project name for cache scoping
 * @returns Grouped metrics organized by log group
 */
export const groupMetrics = (
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
  organizationId: string,
  projectName: string,
): GroupedMetrics => {
  // Get project-scoped cache
  const projectKey = `${organizationId}:${projectName}`;
  const cache = getCacheEntry(projectKey);

  // Fast path: same reference as last call
  if (cache.inputRef === selectedRunsWithColors && cache.output) {
    return cache.output;
  }

  // Check if content actually changed using cache key
  const newCacheKey = generateCacheKey(selectedRunsWithColors);
  if (newCacheKey === cache.inputKey && cache.output) {
    // Content hasn't changed, return cached output
    cache.inputRef = selectedRunsWithColors;
    return cache.output;
  }

  // Content changed, compute new result
  const groups: GroupedMetrics = {};

  Object.values(selectedRunsWithColors).forEach(({ run, color }) => {
    run.logs.forEach((log: RunLog) => {
      if (!log.logType) return;

      const groupKey = getLogGroupName({
        logGroup: log.logGroup,
        logType: log.logType,
      });
      const metricName = log.logName;
      const logType = log.logType;

      if (!groups[groupKey]) {
        groups[groupKey] = {
          metrics: [],
          groupName: groupKey,
        };
      }

      let metricGroup = groups[groupKey].metrics.find(
        (metric) => metric.name === metricName && metric.type === logType,
      );

      if (!metricGroup) {
        metricGroup = {
          name: metricName,
          type: logType,
          data: [],
        };
        groups[groupKey].metrics.push(metricGroup);
      }

      metricGroup.data.push({
        runId: run.id,
        runName: run.name,
        color,
        status: run.status,
      });
    });
  });

  // Update cache
  cache.inputRef = selectedRunsWithColors;
  cache.inputKey = newCacheKey;
  cache.output = groups;

  return groups;
};