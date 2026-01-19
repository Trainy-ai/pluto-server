import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import "../index.css";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { env } from "@/lib/env";
import { PostHogProvider } from "posthog-js/react";
import { PostHogAnalytics } from "@/components/posthog-analytics";

type Auth = inferOutput<typeof trpc.auth>;
export interface RouterAppContext {
  auth: Auth;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        name: "Pluto",
        content:
          "Pluto is a next-gen experiment tracking app for machine learning",
      },
      {
        title: "Pluto",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon_dark.svg",
      },
    ],
  }),
});

const PostHogProviderWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const hasPostHogKey = env.VITE_POSTHOG_KEY;
  const hasPostHogHost = env.VITE_POSTHOG_HOST;

  if (!hasPostHogKey || !hasPostHogHost) {
    return children;
  }

  return (
    <PostHogProvider
      apiKey={hasPostHogKey!}
      options={{
        api_host: hasPostHogHost,
        capture_pageview: false, // We handle this manually in PostHogAnalytics
        capture_pageleave: true,
        persistence: "localStorage",
      }}
    >
      {children}
    </PostHogProvider>
  );
};

function RootComponent() {
  // Use the auth query directly to get auth state for analytics
  const { data: auth } = useQuery(trpc.auth.queryOptions());

  return (
    <>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <PostHogProviderWrapper>
          <PostHogAnalytics auth={auth ?? null} />
          <HeadContent />
          <Outlet />
          <Toaster richColors />
        </PostHogProviderWrapper>
      </ThemeProvider>
      {env.VITE_ENV === "development" && (
        <>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        </>
      )}
    </>
  );
}
