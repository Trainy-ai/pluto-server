import {
  createTRPCContext,
  createTRPCOptionsProxy,
} from "@trpc/tanstack-react-query";

import type { AppRouter } from "../../../server/trpc/router";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { httpLink, httpBatchStreamLink } from "@trpc/client";
import { createTRPCClient, splitLink } from "@trpc/client";
import { toast } from "@/components/ui/sonner";
import superjson from "superjson";
import { env } from "@/lib/env";

const isProduction = env.VITE_ENV === "production";

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
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
        url: `${env.VITE_SERVER_URL}/trpc`,
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        },
        transformer: superjson,
      }),
      false: httpBatchStreamLink({
        url: `${env.VITE_SERVER_URL}/trpc`,
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
