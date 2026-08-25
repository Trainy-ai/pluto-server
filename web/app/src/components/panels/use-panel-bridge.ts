// Python Panels — parent-side bridge wiring.
//
// usePanelBridge registers a sandbox instance's token with the message
// hub, verifies every incoming message's `event.source` against that
// instance's iframe window, and executes allowlisted RPCs through the
// shared React Query cache (`queryClient.fetchQuery`), posting
// `rpc-result` messages back. targetOrigin is "*" — forced by the
// iframe's opaque origin — compensated by the event.source + token
// checks and by the fact that results contain only data the viewer's
// session could already read.

import { useEffect, useRef } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import type { PanelHostContext } from "@/lib/panels/panel-bridge-allowlist";
import { createPanelRpcExecutor } from "@/lib/panels/panel-rpc-executor";
import {
  PANEL_BRIDGE_VERSION,
  type PanelToParentMessage,
  type ParentToPanelMessage,
} from "@/lib/panels/panel-bridge-protocol";
import { registerPanelHandler } from "./panel-message-hub";

export type PanelStatusPhase = Extract<
  PanelToParentMessage,
  { type: "status" }
>["phase"];

/**
 * Resolve an allowlist `trpcPath` (e.g. "runs.data.logs") against the
 * tRPC options proxy and fetch it through the shared query cache —
 * the imperative counterpart of `useQuery(trpc.x.queryOptions(...))`.
 */
function executeTrpcQuery(
  trpcPath: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  let node: unknown = trpc;
  for (const segment of trpcPath.split(".")) {
    node = node ? (node as Record<string, unknown>)[segment] : undefined;
  }
  const procedure = node as
    | {
        queryOptions?: (
          input: unknown,
        ) => Parameters<typeof queryClient.fetchQuery>[0];
      }
    | undefined;
  if (typeof procedure?.queryOptions !== "function") {
    // Allowlist names a procedure that no longer exists — a bug on our
    // side, not panel input; surfaces to the panel as UPSTREAM.
    throw new Error(`tRPC procedure not found for path "${trpcPath}"`);
  }
  return queryClient.fetchQuery(procedure.queryOptions(input));
}

export interface UsePanelBridgeOptions {
  token: string;
  hostCtx: PanelHostContext;
  /** The sandbox iframe's contentWindow (source-verified per message). */
  getIframeWindow: () => Window | null;
  onReady?: () => void;
  onStatus?: (phase: PanelStatusPhase, detail?: string) => void;
}

export function usePanelBridge(options: UsePanelBridgeOptions) {
  // Refs so the (token-keyed) effect always sees current values without
  // re-registering on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { token } = options;

  useEffect(() => {
    const executor = createPanelRpcExecutor({ execute: executeTrpcQuery });

    const post = (message: ParentToPanelMessage) => {
      optionsRef.current.getIframeWindow()?.postMessage(message, "*");
    };

    return registerPanelHandler(token, (message, event) => {
      const iframeWindow = optionsRef.current.getIframeWindow();
      if (!iframeWindow || event.source !== iframeWindow) {
        return;
      }
      switch (message.type) {
        case "ready":
          optionsRef.current.onReady?.();
          break;
        case "status":
          optionsRef.current.onStatus?.(message.phase, message.detail);
          break;
        case "rpc":
          void executor(
            message.method,
            message.params,
            optionsRef.current.hostCtx,
          ).then((result) => {
            post(
              result.ok
                ? {
                    mlop: PANEL_BRIDGE_VERSION,
                    type: "rpc-result",
                    id: message.id,
                    ok: true,
                    data: result.data,
                  }
                : {
                    mlop: PANEL_BRIDGE_VERSION,
                    type: "rpc-result",
                    id: message.id,
                    ok: false,
                    error: result.error,
                  },
            );
          });
          break;
      }
    });
  }, [token]);
}
