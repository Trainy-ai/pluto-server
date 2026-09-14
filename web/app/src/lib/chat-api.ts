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
      if (!response.ok) throw new Error("Could not load chat configuration");
      return (await response.json()) as { enabled: boolean };
    },
  });
}
