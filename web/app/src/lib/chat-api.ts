import { useQuery } from "@tanstack/react-query";

export function getChatApiUrl(path = ""): string {
  // Vite proxies /api in development and the production nginx image proxies
  // it in deployment, keeping auth cookies and streaming same-origin.
  return `/api/chat${path}`;
}

export function useChatConfig(organizationId?: string) {
  return useQuery({
    queryKey: ["chat-config", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(
        `${getChatApiUrl("/config")}?organizationId=${encodeURIComponent(organizationId!)}`,
        { credentials: "include" },
      );

      // A backend without the chat routes (older deploys, previews) is the
      // same as chat being disabled — local-agent mode still works. That is a
      // durable fact about the deployment, so cache it.
      if (response.status === 404 || response.status === 501) {
        return { enabled: false };
      }

      // Anything else that fails is transient: a 5xx, a dropped connection, a
      // window-focus refetch during a deploy. Throwing keeps React Query's
      // last successful value instead of overwriting it with `disabled`.
      // Swallowing these would flip `serverEnabled` false, which flips `mode`
      // for anyone who has not picked a backend, which changes the
      // `ChatWorkspace` key and remounts it — silently discarding the
      // in-memory conversation.
      if (!response.ok) {
        throw new Error(`chat config request failed: ${response.status}`);
      }

      return (await response.json()) as { enabled: boolean };
    },
  });
}
