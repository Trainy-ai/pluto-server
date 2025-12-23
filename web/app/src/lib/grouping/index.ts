import { LOG_GROUP_INDEX, LOG_GROUP_MAPPING } from "./consts";
import type { LogGroup, LogGroupName, RunLogType } from "./types";

/**
 * Get the log group for a given log
 * @param log - The log to get the group for
 * @returns The log group for the given log
 */
export function getLogGroupName(log: {
  logGroup: LogGroupName | null | undefined;
  logType: RunLogType;
}) {
  if (log.logGroup) {
    return log.logGroup;
  }

  // If there is no log group, we need to determine the log group based on the log type
  if (log.logType) {
    return LOG_GROUP_MAPPING[log.logType];
  }

  return "other";
}

/**
 * Sorts groups based on predefined LOG_GROUP_INDEX and custom sorting rules.
 *
 * @template T - Generic type that extends an object with a groupName property
 * @param {Record<string, T>} groups - Record of groups to sort, keyed by group name
 * @returns {Array<[string, T]>} Sorted array of [groupName, group] pairs according to the following rules:
 *
 * Sorting Priority:
 * 1. Groups with positive indices in LOG_GROUP_INDEX (sorted by index)
 * 2. User-defined groups (not in LOG_GROUP_INDEX, sorted alphabetically)
 * 3. Groups with negative indices in LOG_GROUP_INDEX (sorted from most negative)
 */
export function sortGroups<T extends { groupName: string }>(
  groups: Record<string, T>,
) {
  return Object.entries(groups).sort((a, b) => {
    const indexA = LOG_GROUP_INDEX[a[0] as keyof typeof LOG_GROUP_INDEX];
    const indexB = LOG_GROUP_INDEX[b[0] as keyof typeof LOG_GROUP_INDEX];

    // Both groups have defined indices
    if (indexA !== undefined && indexB !== undefined) {
      // Both are positive indices
      if (indexA >= 0 && indexB >= 0) {
        return indexA - indexB;
      }
      // Both are negative indices
      if (indexA < 0 && indexB < 0) {
        return indexB - indexA; // Most negative first
      }
      // One positive, one negative
      if (indexA >= 0) return -1;
      if (indexB >= 0) return 1;
    }

    // One or both groups are user-defined (not in LOG_GROUP_INDEX)
    if (indexA === undefined && indexB === undefined) {
      // Both are user-defined, sort alphabetically
      return a[0].localeCompare(b[0]);
    }
    if (indexA === undefined) {
      // A is user-defined
      if (indexB >= 0) return 1; // Positive indices come first
      if (indexB < 0) return -1; // User-defined comes before negative indices
    }
    if (indexB === undefined) {
      // B is user-defined
      if (indexA >= 0) return -1; // Positive indices come first
      if (indexA < 0) return 1; // User-defined comes before negative indices
    }

    return 0;
  });
}

interface IndexedLogGroup extends LogGroup {
  _index: number;
}

/**
 * Flattens and sorts log groups into a single array based on predefined indices and group names.
 *
 * @param {Record<string, LogGroup>} logGroups - Record of log groups to process, keyed by group name
 * @returns {LogGroup[]} Sorted array of LogGroups according to the following rules:
 *
 * Sorting Process:
 * 1. Groups with positive indices from LOG_GROUP_INDEX are placed at their specified positions
 * 2. Unindexed groups (not in LOG_GROUP_INDEX) are sorted alphabetically and used to fill gaps
 * 3. Groups with negative indices are appended at the end, sorted from most negative to least
 *
 * Note: The function maintains the relative order of indexed groups while intelligently
 * integrating unindexed groups into available positions.
 */
export function flattenAndSortLogGroups(logGroups: Record<string, LogGroup>) {
  const result: LogGroup[] = new Array(Object.keys(logGroups).length).fill(
    null,
  );
  const unindexedGroups: LogGroup[] = [];
  const negativeIndexedGroups: IndexedLogGroup[] = [];

  Object.entries(logGroups).forEach(([key, group]) => {
    const index = LOG_GROUP_INDEX[key as keyof typeof LOG_GROUP_INDEX];

    if (index !== undefined) {
      if (index >= 0) {
        // Handle positive indices (0, 1)
        result[index] = group;
      } else {
        // Handle negative indices by collecting them first
        negativeIndexedGroups.push({ ...group, _index: index });
      }
    } else {
      unindexedGroups.push(group);
    }
  });

  // Sort unindexed groups alphabetically
  unindexedGroups.sort((a, b) => a.groupName.localeCompare(b.groupName));

  // Sort negative indexed groups by their index (most negative first)
  negativeIndexedGroups.sort((a, b) => a._index - b._index);

  // Fill gaps with unindexed groups
  let unindexedIndex = 0;
  const filledResult = result
    .map((group) => {
      if (group === null && unindexedGroups[unindexedIndex]) {
        const nextGroup = unindexedGroups[unindexedIndex];
        unindexedIndex++;
        return nextGroup;
      }
      return group;
    })
    .filter((group): group is LogGroup => group !== null);

  // Append negative indexed groups at the end
  return [
    ...filledResult,
    ...negativeIndexedGroups.map((g) => ({
      groupName: g.groupName,
      logs: g.logs,
    })),
  ];
}
