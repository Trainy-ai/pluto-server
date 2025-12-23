import { useMemo, useState } from "react";
import type { RunLog } from "@/lib/grouping/types";
import { processLogsIntoGroups } from "../~components/utils";

/**
 * Represents a group of logs with a common name
 */
export interface LogGroup {
  /** The name of the log group */
  groupName: string;
  /** Array of logs belonging to this group */
  logs: RunLog[];
}

/**
 * Props for the useFilteredLogs hook
 */
interface UseFilteredLogsProps {
  /** Array of logs to be filtered and grouped */
  logs: RunLog[];
  /** Optional filter function to filter log groups */
  groupFilter?: (group: LogGroup) => boolean;
}

/**
 * Return type for the useFilteredLogs hook
 */
interface UseFilteredLogsReturn {
  /** Array of filtered and grouped logs */
  filteredLogGroups: LogGroup[];
  /** Current search query string */
  searchQuery: string;
  /** Whether the search is using regex pattern */
  isRegexSearch: boolean;
  /** Function to handle search input changes */
  handleSearch: (query: string, isRegex: boolean) => void;
}

/**
 * Custom hook for filtering and grouping logs with search functionality
 *
 * @param {UseFilteredLogsProps} props - The props for the hook
 * @param {RunLog[]} props.logs - Array of logs to be filtered and grouped
 * @param {(group: LogGroup) => boolean} [props.groupFilter] - Optional filter function for log groups
 * @returns {UseFilteredLogsReturn} Object containing filtered logs and search controls
 */
export function useFilteredLogs({
  logs,
  groupFilter,
}: UseFilteredLogsProps): UseFilteredLogsReturn {
  const [searchQuery, setSearchQuery] = useState("");
  const [isRegexSearch, setIsRegexSearch] = useState(false);

  const handleSearch = (query: string, isRegex: boolean) => {
    setSearchQuery(query);
    setIsRegexSearch(isRegex);
  };

  const filteredLogGroups = useMemo(() => {
    const logGroups = processLogsIntoGroups(logs);
    let filteredGroups = groupFilter
      ? logGroups.filter(groupFilter)
      : logGroups;

    if (!searchQuery) return filteredGroups;

    return filteredGroups
      .map((group) => ({
        ...group,
        logs: group.logs.filter((log: RunLog) => {
          if (isRegexSearch) {
            try {
              const regex = new RegExp(searchQuery);
              return regex.test(log.logName);
            } catch {
              return false;
            }
          }
          return log.logName.toLowerCase().includes(searchQuery.toLowerCase());
        }),
      }))
      .filter((group) => group.logs.length > 0);
  }, [logs, searchQuery, isRegexSearch, groupFilter]);

  return {
    filteredLogGroups,
    searchQuery,
    isRegexSearch,
    handleSearch,
  };
}
