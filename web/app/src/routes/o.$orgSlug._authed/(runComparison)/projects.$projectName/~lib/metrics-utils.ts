import { getLogGroupName } from "@/lib/grouping/index";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { trpc } from "@/utils/trpc";

type Run = inferOutput<typeof trpc.runs.list>["runs"][number];
type LogsByRunId = inferOutput<typeof trpc.runs.getLogsByRunIds>;
type RunLog = LogsByRunId[string][number];

/**
 * Cache structure for stable output references.
 * Uses a Map keyed by project context to ensure isolation between projects.
 * This prevents cross-project data leakage when multiple tabs are open.
 */
interface CacheEntry {
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
    entry = { inputKey: null, output: null };
    projectCaches.set(projectKey, entry);
  }
  return entry;
}

/**
 * Generates a cache key from the input that captures what actually matters for rendering:
 * - Which runs are selected (by ID)
 * - What color each run has
 * - Run status (affects chart behavior)
 * - Which logs are loaded
 */
function generateCacheKey(
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
  logsByRunId: LogsByRunId | undefined,
): string {
  const runEntries = Object.entries(selectedRunsWithColors)
    .map(([id, { color, run }]) => `${id}:${color}:${run.status}`)
    .sort()
    .join("|");

  // Include log count per run in cache key to detect when logs are loaded
  const logCounts = Object.entries(logsByRunId || {})
    .map(([id, logs]) => `${id}:${logs.length}`)
    .sort()
    .join(",");

  return `${runEntries}::${logCounts}`;
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
 * @param logsByRunId - Logs fetched separately, keyed by run ID
 * @param organizationId - Organization ID for cache scoping
 * @param projectName - Project name for cache scoping
 * @returns Grouped metrics organized by log group
 */
export const groupMetrics = (
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
  logsByRunId: LogsByRunId | undefined,
  organizationId: string,
  projectName: string,
): GroupedMetrics => {
  // Get project-scoped cache
  const projectKey = `${organizationId}:${projectName}`;
  const cache = getCacheEntry(projectKey);

  // Check if content actually changed using cache key
  const newCacheKey = generateCacheKey(selectedRunsWithColors, logsByRunId);
  if (newCacheKey === cache.inputKey && cache.output) {
    // Content hasn't changed, return cached output
    return cache.output;
  }

  // Content changed, compute new result
  const groups: GroupedMetrics = {};

  if (!logsByRunId) {
    // No logs loaded yet, return empty
    cache.inputKey = newCacheKey;
    cache.output = groups;
    return groups;
  }

  // Media types that fetch their data independently - should include all selected runs
  const MEDIA_TYPES = new Set(["IMAGE", "AUDIO", "VIDEO"]);

  // First pass: build metric groups from logs
  Object.entries(selectedRunsWithColors).forEach(([runId, { run, color }]) => {
    const logs = logsByRunId[runId] || [];

    logs.forEach((log: RunLog) => {
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

  // Second pass: for media types, ensure ALL selected runs are included
  // This allows media components to fetch data for newly selected runs
  // even if their logs haven't loaded yet (placeholderData scenario)
  Object.values(groups).forEach((group) => {
    group.metrics.forEach((metric) => {
      if (MEDIA_TYPES.has(metric.type)) {
        const existingRunIds = new Set(metric.data.map((d) => d.runId));

        // Add any missing selected runs
        Object.entries(selectedRunsWithColors).forEach(([, { run, color }]) => {
          if (!existingRunIds.has(run.id)) {
            metric.data.push({
              runId: run.id,
              runName: run.name,
              color,
              status: run.status,
            });
          }
        });
      }
    });
  });

  // Update cache
  cache.inputKey = newCacheKey;
  cache.output = groups;

  return groups;
};
