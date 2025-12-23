import type { GroupedMetrics } from "@/lib/grouping/types";

/**
 * Interface for the search index which stores terms and metrics
 * for efficient searching across metric groups
 */
export interface SearchIndex {
  terms: Set<string>;
  metrics: Set<string>;
}

/**
 * Interface for the search state including query string and regex support
 */
export interface SearchState {
  query: string;
  isRegex: boolean;
  regex: RegExp | null;
}

/**
 * Utility functions for handling search functionality in run comparisons
 */
export const searchUtils = {
  /**
   * Creates a search index from grouped metrics for efficient searching
   * @param groupedMetrics - The grouped metrics to index
   * @returns A map of group keys to their search indices
   */
  createSearchIndex(groupedMetrics: GroupedMetrics): Map<string, SearchIndex> {
    const index = new Map<string, SearchIndex>();

    Object.entries(groupedMetrics).forEach(([groupKey, group]) => {
      const terms = new Set<string>();
      const metricNames = new Set<string>();

      terms.add(group.groupName.toLowerCase());
      group.metrics.forEach((metric) => {
        const name = metric.name.toLowerCase();
        terms.add(name);
        metricNames.add(name);
      });

      index.set(groupKey, { terms, metrics: metricNames });
    });

    return index;
  },

  /**
   * Checks if a group matches the current search criteria
   * @param groupKey - The key of the group to check
   * @param searchIndex - The search index to use
   * @param searchState - The current search state
   * @returns Whether the group matches the search criteria
   */
  doesGroupMatch(
    groupKey: string,
    searchIndex: Map<string, SearchIndex>,
    searchState: SearchState,
  ): boolean {
    const indexEntry = searchIndex.get(groupKey);
    if (!indexEntry) return false;

    if (searchState.isRegex && searchState.regex) {
      return Array.from(indexEntry.terms).some((term) =>
        searchState.regex!.test(term),
      );
    }
    return Array.from(indexEntry.terms).some((term) =>
      term.includes(searchState.query.toLowerCase()),
    );
  },

  /**
   * Filters metrics within a group based on search criteria
   * @param groupKey - The key of the group containing the metrics
   * @param metrics - The metrics to filter
   * @param searchIndex - The search index to use
   * @param searchState - The current search state
   * @returns Filtered metrics that match the search criteria
   */
  filterMetrics(
    groupKey: string,
    metrics: GroupedMetrics[string]["metrics"],
    searchIndex: Map<string, SearchIndex>,
    searchState: SearchState,
  ) {
    if (!searchState.query.trim()) return metrics;

    if (searchState.isRegex && !searchState.regex) return [];

    if (searchState.isRegex && searchState.regex) {
      return metrics.filter((m) =>
        searchState.regex!.test(m.name.toLowerCase()),
      );
    }
    return metrics.filter((m) =>
      m.name.toLowerCase().includes(searchState.query.toLowerCase()),
    );
  },

  /**
   * Creates a search state object from a query string and regex flag
   * @param query - The search query
   * @param isRegex - Whether the query is a regular expression
   * @returns A search state object
   */
  createSearchState(query: string, isRegex: boolean): SearchState {
    let regex: RegExp | null = null;
    if (isRegex && query) {
      try {
        regex = new RegExp(query, "i");
      } catch {
        regex = null;
      }
    }

    return {
      query,
      isRegex,
      regex,
    };
  },

  /**
   * Filters groups based on the current search criteria
   * @param sortedGroups - The sorted groups to filter
   * @param searchIndex - The search index to use
   * @param searchState - The current search state
   * @returns Filtered groups that match the search criteria
   */
  filterGroups(
    sortedGroups: [string, GroupedMetrics[string]][],
    searchIndex: Map<string, SearchIndex>,
    searchState: SearchState,
  ) {
    if (!searchState.query.trim()) {
      return sortedGroups;
    }

    if (searchState.isRegex && !searchState.regex) {
      return [];
    }

    return sortedGroups.filter(([groupKey]) =>
      searchUtils.doesGroupMatch(groupKey, searchIndex, searchState),
    );
  },
};