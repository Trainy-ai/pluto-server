import {
  createTRPCContext,
  createTRPCOptionsProxy,
} from "@trpc/tanstack-react-query";

import type { AppRouter } from "../../../server/trpc/router";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { httpLink, httpBatchLink, httpBatchStreamLink } from "@trpc/client";
import { createTRPCClient, splitLink } from "@trpc/client";
import { toast } from "@/components/ui/sonner";
import superjson from "superjson";
import { env } from "@/lib/env";

const isProduction = env.VITE_ENV === "production";
const isTest = env.VITE_ENV === "test";

// In test/Docker environments, use relative URLs to go through Vite proxy
// This ensures same-origin requests for proper cookie handling
const getTRPCUrl = () => {
  if (isTest || env.VITE_IS_DOCKER) {
    return "/trpc"; // Relative URL, proxied by Vite dev server
  }
  return `${env.VITE_SERVER_URL}/trpc`; // Absolute URL for production
};

const trpcUrl = getTRPCUrl();

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

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
      condition(op) {
        // return Boolean(op.path == "runs.data.graph");
        return false;
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
            maxURLLength: 2083,
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
            maxItems: env.VITE_IS_DOCKER ? 1 : 30,
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
