import {
  QueryClient,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type InfiniteData,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import type { TRPCQueryKey } from "@trpc/tanstack-react-query";
import { LocalCache } from "@/lib/db/local-cache";
import { useCallback, useEffect, useMemo } from "react";

interface LocalQueryOptions<T> extends UseQueryOptions<T> {
  queryKey: TRPCQueryKey;
  queryFn: () => Promise<T>;
  staleTime: number;
  localCache: LocalCache<T>;
}

const stringifyQueryKey = (queryKey: TRPCQueryKey) => {
  const stringified = JSON.stringify(queryKey)
    .replace(/,/g, "_")
    .replace(/:/g, "_")
    .replace(/'/g, "_")
    .replace(/"/g, "_")
    .replace(/{/g, "")
    .replace(/}/g, "")
    .replace(/]/g, "")
    .replace(/\\/g, "")
    .replace(/\[/g, "")
    .replace(/=/g, "_");
  return stringified;
};

export function useLocalQuery<T>({
  queryKey,
  staleTime,
  queryFn,
  localCache,
  ...rest
}: LocalQueryOptions<T>) {
  // Get cached record synchronously using Dexie's live query.
  const storageKey = stringifyQueryKey(queryKey);
  const cachedRecord = useLiveQuery(
    () => localCache.getData(storageKey),
    [storageKey],
  );
  // console.log(cachedRecord);
  // Use cached data as placeholder (or initialData).
  const placeholderData = cachedRecord ? cachedRecord.data : undefined;

  const cachedQueryFn = async () => {
    // Re-read cached record (in case it was updated)
    const cached = await localCache.getData(storageKey);
    // Use cached data if it's already finished or if it has been recently synced.
    if (
      cached?.finishedAt ||
      (cached?.syncedAt &&
        new Date(cached.syncedAt) > new Date(Date.now() - staleTime))
    ) {
      return cached.data;
    }
    // Otherwise, fetch fresh data.
    const data = await queryFn();
    if (data) {
      // console.log("setting data", storageKey);
      await localCache.setData(storageKey, data);
    }
    return data;
  };

  return useQuery({
    queryKey: queryKey,
    queryFn: () => cachedQueryFn(),
    staleTime,
    // @ts-ignore No fucking clue on how to fix this.
    placeholderData,
    ...rest,
  });
}

export function useSuspenseLocalQuery<T>({
  queryKey,
  staleTime,
  queryFn,
  localCache,
  ...rest
}: LocalQueryOptions<T>) {
  // Get cached record synchronously using Dexie's live query.
  const storageKey = stringifyQueryKey(queryKey);
  const cachedRecord = useLiveQuery(
    () => localCache.getData(storageKey),
    [storageKey],
  );
  // Use cached data as placeholder (or initialData).
  const placeholderData = cachedRecord ? cachedRecord.data : undefined;

  const cachedQueryFn = useCallback(async () => {
    // Re-read cached record (in case it was updated)
    const cached = await localCache.getData(storageKey);
    // Use cached data if it's already finished or if it has been recently synced.
    if (
      cached?.finishedAt ||
      (cached?.syncedAt &&
        new Date(cached.syncedAt) > new Date(Date.now() - staleTime))
    ) {
      return cached.data;
    }
    // Otherwise, fetch fresh data.
    const data = await queryFn();
    if (data) {
      // console.log("setting data", storageKey);
      await localCache.setData(storageKey, data);
    }
    return data;
  }, [queryFn, localCache, storageKey, staleTime]);

  return useSuspenseQuery({
    queryKey: queryKey,
    queryFn: () => cachedQueryFn(),
    staleTime,
    // @ts-ignore No fucking clue on how to fix this.
    placeholderData,
    ...rest,
  });
}

export function useLocalQueries<T>(
  queriesOptions: Array<LocalQueryOptions<T[]>>,
): Array<UseQueryResult<T[]>> {
  // Get cached records for all queries
  const storageKeys = useMemo(
    () => queriesOptions.map((opt) => stringifyQueryKey(opt.queryKey)),
    [queriesOptions],
  );

  // Get all cached records using a single Dexie liveQuery
  const cachedRecords = useLiveQuery(async () => {
    const records = await Promise.all(
      storageKeys.map((key) =>
        queriesOptions[storageKeys.indexOf(key)].localCache.getData(key),
      ),
    );
    return records;
  }, [storageKeys.join(",")]);

  // Prepare query options with cached data and wrapped queryFn
  const combinedQueryOptions = useMemo(() => {
    return queriesOptions.map((opt, index) => {
      const storageKey = storageKeys[index];
      const cachedRecord = cachedRecords?.[index];
      const placeholderData = cachedRecord ? cachedRecord.data : undefined;

      const cachedQueryFn = async () => {
        // Re-read cached record (in case it was updated)
        const cached = await opt.localCache.getData(storageKey);

        // Use cached data if it's already finished or if it has been recently synced.
        if (
          cached?.finishedAt ||
          (cached?.syncedAt &&
            new Date(cached.syncedAt) > new Date(Date.now() - opt.staleTime))
        ) {
          return cached.data;
        }

        // Otherwise, fetch fresh data.
        const data = await opt.queryFn();
        if (data) {
          // console.log("setting data", storageKey);
          await opt.localCache.setData(storageKey, data);
        }
        return data;
      };

      return {
        ...opt,
        queryFn: cachedQueryFn,
        placeholderData,
      };
    });
  }, [queriesOptions, cachedRecords, storageKeys]);

  return useQueries({ queries: combinedQueryOptions });
}

/**
 * prefetchLocalQuery first checks for local cached data and uses it to set
 * the query cache immediately. Then it prefetches fresh data (updating both
 * localCache and query cache). This function mimics queryClient.prefetchQuery,
 * but prefills from local cache.
 */
export async function prefetchLocalQuery<T>(
  queryClient: QueryClient,
  options: LocalQueryOptions<T>,
  onlyUseCache = false,
) {
  const storageKey = stringifyQueryKey(options.queryKey);

  const cachedQueryFn = async () => {
    // Re-read the local cache in case it has been updated meanwhile.
    const cached = await options.localCache.getData(storageKey);
    // If the cache is either marked finished or has been synced recently, return it.
    if (onlyUseCache) {
      return cached?.data;
    }
    if (
      cached?.finishedAt ||
      (cached?.syncedAt &&
        new Date(cached.syncedAt) > new Date(Date.now() - options.staleTime))
    ) {
      return cached.data;
    }
    // Otherwise, call the fresh fetch function.
    const data = await options.queryFn();
    if (data) {
      // Store the new data in the local cache.
      await options.localCache.setData(storageKey, data);
    }
    return data;
  };

  // Use prefetchQuery to fetch fresh data and update both caches.
  await queryClient.prefetchQuery({
    queryKey: options.queryKey,
    staleTime: options.staleTime,
    queryFn: () => cachedQueryFn(),
  });
}

export async function ensureLocalQuery<T>(
  queryClient: QueryClient,
  options: LocalQueryOptions<T>,
  onlyUseCache = false,
  forceFresh = false,
) {
  const storageKey = stringifyQueryKey(options.queryKey);

  const cachedQueryFn = async () => {
    // Re-read the local cache in case it has been updated meanwhile
    const cached = await options.localCache.getData(storageKey);
    // If the cache is either marked finished or has been synced recently, return it.
    if (onlyUseCache) {
      return cached?.data;
    }

    const isFresh =
      cached?.finishedAt ||
      (cached?.syncedAt &&
        new Date(cached.syncedAt) > new Date(Date.now() - options.staleTime));

    if (isFresh && !forceFresh) {
      return cached.data;
    }

    // Otherwise, call the fresh fetch function.
    const data = await options.queryFn();
    if (data) {
      // Store the new data in the local cache.
      await options.localCache.setData(storageKey, data);
    }
    return data;
  };

  // Use prefetchQuery to fetch fresh data and update both caches.
  return queryClient.fetchQuery({
    queryKey: options.queryKey,
    staleTime: options.staleTime,
    queryFn: () => cachedQueryFn(),
  });
}

/**
 * A hook that uses a local cache for infinite queries.
 *
 * It reads (reactively) from local cache using Dexie's live query
 * and supplies this as the initial data (or placeholder) for the infinite query.
 * Additionally, it uses React Query's onSuccess callback to update the local cache
 * whenever new data is fetched.
 */

interface LocalInfiniteQueryOptions<T> {
  queryKey: TRPCQueryKey;
  queryFn: ({ pageParam }: { pageParam?: unknown }) => Promise<T>;
  staleTime: number;
  localCache: LocalCache<InfiniteData<T>>;
  getNextPageParam?: (lastPage: T, pages: T[]) => unknown;
}

export function useLocalInfiniteQuery<T>({
  queryKey,
  staleTime,
  queryFn,
  localCache,
  getNextPageParam,
}: LocalInfiniteQueryOptions<T>) {
  const storageKey = stringifyQueryKey(queryKey);

  // Get cached record reactively using Dexie's useLiveQuery
  const cachedRecord = useLiveQuery(() => {
    return localCache.getData(storageKey);
  }, [storageKey]);

  const initialData = cachedRecord?.data;

  const placeholderData = initialData && {
    pages: initialData.pages,
    pageParams: initialData.pageParams,
  };

  // Use useInfiniteQuery with the cached data as initialData
  const { data, ...rest } = useInfiniteQuery({
    queryKey,
    queryFn,
    // @ts-ignore No clue why this is complaining.
    getNextPageParam,
    staleTime,
    placeholderData,
  });

  // Update the cache whenever the query data changes
  useEffect(() => {
    if (data) {
      localCache.setData(storageKey, data);
    }
  }, [data, storageKey, localCache]);

  return { data, ...rest };
}

/**
 * Options for prefetching an infinite query with local caching.
 */
interface PrefetchLocalInfiniteQueryOptions<T> {
  queryKey: TRPCQueryKey;
  queryFn: ({ pageParam }: { pageParam?: unknown }) => Promise<T>;
  staleTime: number;
  localCache: LocalCache<InfiniteData<T>>;
  getNextPageParam: (lastPage: T, pages: T[]) => unknown;
  pagesToPrefetch?: number; // Optional number of pages to prefetch, defaults to 1
}

/**
 * Prefetches an infinite query, using local cache if available and fresh.
 * Fetches a specified number of pages and updates both query cache and local cache.
 *
 * @param queryClient - The TanStack Query client instance.
 * @param options - Configuration options for the infinite query.
 * @param onlyUseCache - If true, only use cached data without fetching fresh data.
 * @param pagesToPrefetch - Number of pages to prefetch (defaults to 1).
 */
export async function prefetchLocalInfiniteQuery<T>(
  queryClient: QueryClient,
  options: PrefetchLocalInfiniteQueryOptions<T>,
  onlyUseCache = false,
  pagesToPrefetch = 1,
) {
  const { queryKey, queryFn, staleTime, localCache, getNextPageParam } =
    options;

  const storageKey = stringifyQueryKey(queryKey);

  // Check if there's cached data in the local cache
  const cached = await localCache.getData(storageKey);
  const isFresh =
    cached?.finishedAt ||
    (cached?.syncedAt &&
      new Date(cached.syncedAt) > new Date(Date.now() - staleTime));

  // If onlyUseCache is true or cached data is fresh, use it to set the query cache
  if (onlyUseCache || (isFresh && cached?.data)) {
    queryClient.setQueryData<InfiniteData<T>>(queryKey, cached?.data);
    return;
  }

  // Fetch fresh data for the specified number of pages
  let pageParam: unknown = undefined;
  const pages: T[] = [];
  const pageParams: unknown[] = [];

  for (let i = 0; i < pagesToPrefetch; i++) {
    const pageData = await queryFn({ pageParam });
    if (!pageData) break; // Stop if no data is returned
    pages.push(pageData);
    pageParams.push(pageParam);
    pageParam = getNextPageParam(pageData, pages);
    if (!pageParam) break; // Stop if there's no next page
  }

  // Construct the InfiniteData structure
  const infiniteData: InfiniteData<T> = {
    pages,
    pageParams,
  };

  // Update the query cache with the fetched data
  queryClient.setQueryData<InfiniteData<T>>(queryKey, infiniteData);

  // Update the local cache with the fetched data
  await localCache.setData(storageKey, infiniteData);
}

export const bustLocalCache = async (
  localCache: LocalCache<unknown>,
  queryKey: TRPCQueryKey,
) => {
  const storageKey = stringifyQueryKey(queryKey);
  await localCache.setData(storageKey, null);
};
