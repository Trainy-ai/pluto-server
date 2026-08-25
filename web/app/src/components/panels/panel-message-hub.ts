// Python Panels — window message multiplexer.
//
// Module singleton: ONE window "message" listener for the whole app,
// routing structurally-valid panel→parent messages to the handler
// registered for their per-instance token. Each PanelSandbox registers
// its token on mount and unregisters on unmount; the listener attaches
// on first registration and detaches when the last one leaves (so the
// hub is inert on pages without panels).
//
// Token-based routing IS the auth check for message shape + instance
// identity (see panel-bridge-protocol.ts) — but callers must still
// verify `event.source` against their own iframe's contentWindow
// before acting, which requires the iframe ref only they hold.

import {
  isPanelToParentMessageForToken,
  type PanelToParentMessage,
} from "@/lib/panels/panel-bridge-protocol";

export type PanelMessageHandler = (
  message: PanelToParentMessage,
  event: MessageEvent,
) => void;

const handlersByToken = new Map<string, PanelMessageHandler>();
let isListening = false;

function onWindowMessage(event: MessageEvent) {
  const data: unknown = event.data;
  // Cheap pre-filter before Zod validation — this listener sees every
  // window message in the app (react-devtools, other iframes, ...).
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { mlop?: unknown }).mlop !== 1
  ) {
    return;
  }
  const token = (data as { token?: unknown }).token;
  if (typeof token !== "string") {
    return;
  }
  // Map.get can't reach prototype members, but require a function
  // before invoking anyway — the message-supplied token picks the
  // callee, so validate the dispatch target explicitly (CodeQL
  // js/unvalidated-dynamic-method-call).
  const handler = handlersByToken.get(token);
  if (typeof handler !== "function") {
    return;
  }
  if (!isPanelToParentMessageForToken(data, token)) {
    return;
  }
  handler(data, event);
}

/**
 * Route messages carrying `token` to `handler`. Returns the unregister
 * function. Registering the same token twice replaces the handler (the
 * token is crypto-random per sandbox instance, so collisions mean the
 * same instance re-registered, e.g. an effect re-run).
 */
export function registerPanelHandler(
  token: string,
  handler: PanelMessageHandler,
): () => void {
  handlersByToken.set(token, handler);
  if (!isListening) {
    window.addEventListener("message", onWindowMessage);
    isListening = true;
  }
  return () => {
    if (handlersByToken.get(token) === handler) {
      handlersByToken.delete(token);
    }
    if (handlersByToken.size === 0 && isListening) {
      window.removeEventListener("message", onWindowMessage);
      isListening = false;
    }
  };
}
