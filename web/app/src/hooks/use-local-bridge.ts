import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadLocalBridgeSettings,
  probeLocalBridge,
  saveLocalBridgeSettings,
  type LocalBridgeSettings,
} from "@/lib/local-bridge";

/**
 * Local agent bridge state: persisted connection settings plus a lightweight
 * health probe against the user's loopback bridge.
 */
export function useLocalBridge() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<LocalBridgeSettings | null>(() =>
    loadLocalBridgeSettings(),
  );

  // Sticky "this bridge has answered at least once", per pairing.
  //
  // A probe failure is not proof the user is done: `probeLocalBridge` resolves
  // `{ ok: false }` for a 2s timeout or any network error, the query runs every
  // 15s with `retry: false`, and the chat route decides whether to MOUNT the
  // workspace from `isConnected`. Messages live inside that component and chat
  // history is in-memory only, so one blip would silently discard the
  // conversation. Callers gate mounting on this and surface `isConnected` as a
  // banner instead.
  const [hasConnected, setHasConnected] = useState(false);

  const save = useCallback(
    (next: LocalBridgeSettings | null) => {
      saveLocalBridgeSettings(next);
      setSettings(next);
      // A different pairing is a different bridge; the old success does not
      // vouch for it.
      setHasConnected(false);
      void queryClient.invalidateQueries({ queryKey: ["local-bridge-status"] });
    },
    [queryClient],
  );

  const status = useQuery({
    queryKey: ["local-bridge-status", settings?.port, settings?.token],
    enabled: Boolean(settings),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
    queryFn: () => probeLocalBridge(settings!),
  });

  const isConnected = status.data?.ok === true;

  useEffect(() => {
    if (isConnected) setHasConnected(true);
  }, [isConnected]);

  return {
    settings,
    saveSettings: save,
    isConnected,
    hasConnected,
    agentName: status.data?.agent,
    isProbing: Boolean(settings) && status.isLoading,
    refetchStatus: status.refetch,
  };
}

export type UseLocalBridgeResult = ReturnType<typeof useLocalBridge>;
