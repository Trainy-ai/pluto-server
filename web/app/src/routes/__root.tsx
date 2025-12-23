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
import { trpc } from "@/utils/trpc";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { env } from "@/lib/env";
import { PostHogProvider } from "posthog-js/react";

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
        name: "mlop",
        content:
          "mlop is a next-gen experiment tracking app for machine learning",
      },
      {
        title: "mlop",
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
      options={{ api_host: hasPostHogHost }}
    >
      {children}
    </PostHogProvider>
  );
};

function RootComponent() {
  return (
    <>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <PostHogProviderWrapper>
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
