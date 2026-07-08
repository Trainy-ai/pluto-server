import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "../../../server/trpc/router";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { httpLink, httpBatchLink, httpBatchStreamLink } from "@trpc/client";
import { createTRPCClient, splitLink } from "@trpc/client";
import { toast } from "@/components/ui/sonner";
import superjson from "superjson";
import { env } from "@/lib/env";

const isProduction = env.VITE_ENV === "production";
const isTest = env.VITE_ENV === "test";
// Split batched GET requests well BELOW the smallest server URI limit
// (nginx default large_client_header_buffers = 8k) so the request line
// ("GET <uri> HTTP/1.1") always fits. 8192 left zero headroom and caused
// intermittent 414 (Request-URI Too Large) on big batches (e.g. histogram
// dashboards firing runs.data.histogram per-run). 6000 keeps margin.
const MAX_URL_LENGTH = 6000;

// In test/Docker environments, use relative URLs to go through Vite proxy
// This ensures same-origin requests for proper cookie handling
const getTRPCUrl = () => {
  if (isTest || env.VITE_IS_DOCKER) {
    return "/trpc"; // Relative URL, proxied by Vite dev server
  }
  return `${env.VITE_SERVER_URL}/trpc`; // Absolute URL for production
};

const trpcUrl = getTRPCUrl();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 30_000, // 30s — skip refetch on rapid tab switches
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (isProduction) {
        console.error(error);
      } else {
        toast.error(error.message, {
          action: {
            label: "retry",
            onClick: () => {
              queryClient.invalidateQueries();
            },
          },
        });
      }
    },
  }),
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      // Route MUTATIONS through the plain non-streaming httpLink and
      // let queries/subscriptions keep using the batch stream link.
      //
      // The stream link parses responses as a newline-delimited JSON
      // stream (one line per op-completion). Under nginx's
      // `proxy_buffering off` (required so streams flow at all), if
      // the client-side stream reader errors mid-chunk — a transient
      // network hiccup, a connection reset, a mid-flight abort — the
      // whole mutation Promise rejects with "Failed to fetch" and
      // useUpdateNotes/useUpdateTags fire their error toasts even
      // though the server has already committed the write. Users
      // then think their edit failed and either retry (double-write)
      // or give up (thinking they lost data).
      //
      // Mutations don't benefit from batching (nothing else waits for
      // them) or streaming (single-response). A plain fetch is more
      // resilient and equally fast for the one-response case.
      condition(op) {
        return op.type === "mutation";
      },
      true: httpLink({
        url: trpcUrl,
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        },
        transformer: superjson,
      }),
      // Use non-streaming batch link for test environment (better Playwright compatibility)
      false: isTest
        ? httpBatchLink({
            url: trpcUrl,
            maxURLLength: MAX_URL_LENGTH,
            // Fall back to POST when a single op's encoded input would
            // push the GET URL past MAX_URL_LENGTH (the server rejects
            // with HTTP 414 otherwise). Hits the grouped chart query
            // first — its input carries every selected runId, and a
            // selection that covers several large groups can easily
            // top 8 KB of input alone. maxURLLength still drives batch
            // splitting; methodOverride only fires when even the
            // single-op URL is too long.
            methodOverride: "POST",
            fetch(url, options) {
              return fetch(url, {
                ...options,
                credentials: "include",
              });
            },
            transformer: superjson,
          })
        : httpBatchStreamLink({
            url: trpcUrl,
            maxItems: 30,
            maxURLLength: MAX_URL_LENGTH,
            methodOverride: "POST",
            fetch(url, options) {
              return fetch(url, {
                ...options,
                credentials: "include",
              });
            },
            transformer: superjson,
          }),
    }),
  ],
});
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
