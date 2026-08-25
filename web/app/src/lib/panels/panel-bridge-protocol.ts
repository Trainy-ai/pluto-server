// Python Panels — postMessage bridge protocol.
//
// Pure module (no React, no tRPC): message shapes + runtime guards for
// the parent app ↔ sandboxed stlite iframe channel. The iframe runs with
// sandbox="allow-scripts" (opaque origin), so postMessage targetOrigin
// is forced to "*"; the compensating controls are (a) the parent checks
// `event.source === iframe.contentWindow`, (b) both sides check the
// per-instance crypto-random `token` delivered in the `init` message,
// and (c) every payload is validated against the Zod schemas below.
// No secrets ever cross this bridge (the session cookie stays with the
// parent; the iframe only sees query RESULTS the viewer could already
// read).
//
// Envelope objects are `.strict()` on purpose: both sides ship in the
// same app build, so unknown keys can only mean a confused or hostile
// sender and are rejected.

import { z } from "zod";

/** Protocol version stamped on every message as `mlop: 1`. */
export const PANEL_BRIDGE_VERSION = 1 as const;

// ─── Shared pieces ───────────────────────────────────────────────────
//
// NOTE: standalone type aliases for the individual messages/enums (e.g.
// PanelStatusPhase, PanelInitMessage) are deliberately NOT exported yet
// — knip fails CI on unused exports. Derive them with
// `z.infer<typeof XxxSchema>` and export them when their consumers land
// (PR 2's sandbox/hook code).

/** Execution phases reported by the iframe while booting/running a panel. */
export const PanelStatusPhaseSchema = z.enum([
  "loading-runtime",
  "installing",
  "running",
  "done",
  "error",
]);

/** Error codes the parent can return for a bridge RPC. */
export const PanelRpcErrorCodeSchema = z.enum([
  "FORBIDDEN_METHOD",
  "BAD_PARAMS",
  "UPSTREAM",
  "TIMEOUT",
]);

export const PanelRpcErrorSchema = z
  .object({
    code: PanelRpcErrorCodeSchema,
    message: z.string(),
  })
  .strict();
export type PanelRpcError = z.infer<typeof PanelRpcErrorSchema>;

/**
 * Host state snapshot handed to the panel (via `init` and
 * `context-update`). Run ids are the SQID-encoded strings the rest of
 * the frontend uses.
 */
export const PanelContextSchema = z.object({
  projectName: z.string(),
  orgSlug: z.string(),
  organizationId: z.string(),
  theme: z.enum(["light", "dark"]),
  runs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
    }),
  ),
  panel: z.object({
    width: z.number(),
    height: z.number(),
  }),
});
export type PanelContext = z.infer<typeof PanelContextSchema>;

/**
 * RPC correlation id chosen by the iframe side. Numeric ids must be
 * finite integers — NaN never equals itself (a response could never be
 * matched to its request) and non-integers invite float-equality bugs.
 */
const RpcIdSchema = z.union([z.string().min(1), z.number().int()]);

const versionField = z.literal(PANEL_BRIDGE_VERSION);
const tokenField = z.string().min(1);

// ─── iframe → parent ─────────────────────────────────────────────────

export const PanelReadyMessageSchema = z
  .object({
    mlop: versionField,
    token: tokenField,
    type: z.literal("ready"),
  })
  .strict();

export const PanelRpcMessageSchema = z
  .object({
    mlop: versionField,
    token: tokenField,
    type: z.literal("rpc"),
    id: RpcIdSchema,
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export const PanelStatusMessageSchema = z
  .object({
    mlop: versionField,
    token: tokenField,
    type: z.literal("status"),
    phase: PanelStatusPhaseSchema,
    detail: z.string().optional(),
  })
  .strict();

export const PanelToParentMessageSchema = z.discriminatedUnion("type", [
  PanelReadyMessageSchema,
  PanelRpcMessageSchema,
  PanelStatusMessageSchema,
]);
export type PanelToParentMessage = z.infer<typeof PanelToParentMessageSchema>;

// ─── parent → iframe ─────────────────────────────────────────────────

export const PanelInitMessageSchema = z
  .object({
    mlop: versionField,
    type: z.literal("init"),
    /** Per-instance secret echoed back on every iframe→parent message. */
    token: tokenField,
    code: z.string(),
    requirements: z.array(z.string()),
    /**
     * Source of the `mlop` Python SDK (src/lib/panels/mlop_sdk.py,
     * bundled into the parent via Vite `?raw`). Delivered over the
     * bridge because the iframe host page is a static file that must
     * not depend on the app bundle's hashed asset names.
     */
    sdk: z.string(),
    context: PanelContextSchema,
  })
  .strict();

export const PanelRpcResultOkMessageSchema = z
  .object({
    mlop: versionField,
    type: z.literal("rpc-result"),
    id: RpcIdSchema,
    ok: z.literal(true),
    data: z.unknown(),
  })
  .strict();

export const PanelRpcResultErrorMessageSchema = z
  .object({
    mlop: versionField,
    type: z.literal("rpc-result"),
    id: RpcIdSchema,
    ok: z.literal(false),
    error: PanelRpcErrorSchema,
  })
  .strict();

export const PanelContextUpdateMessageSchema = z
  .object({
    mlop: versionField,
    type: z.literal("context-update"),
    context: PanelContextSchema,
  })
  .strict();

export const PanelRerunMessageSchema = z
  .object({
    mlop: versionField,
    type: z.literal("rerun"),
  })
  .strict();

export const PanelDisposeMessageSchema = z
  .object({
    mlop: versionField,
    type: z.literal("dispose"),
  })
  .strict();

// Not a discriminatedUnion: "rpc-result" appears twice (ok/error split).
export const ParentToPanelMessageSchema = z.union([
  PanelInitMessageSchema,
  PanelRpcResultOkMessageSchema,
  PanelRpcResultErrorMessageSchema,
  PanelContextUpdateMessageSchema,
  PanelRerunMessageSchema,
  PanelDisposeMessageSchema,
]);
export type ParentToPanelMessage = z.infer<typeof ParentToPanelMessageSchema>;

// ─── Guards ──────────────────────────────────────────────────────────

/** True when `value` is a structurally valid iframe→parent message. */
export function isPanelToParentMessage(
  value: unknown,
): value is PanelToParentMessage {
  return PanelToParentMessageSchema.safeParse(value).success;
}

/**
 * True when `value` is a valid iframe→parent message carrying exactly
 * the expected per-instance token. Use this on the parent side — a
 * valid shape with the wrong token is another panel instance (or an
 * attacker guessing) and must be ignored.
 */
export function isPanelToParentMessageForToken(
  value: unknown,
  expectedToken: string,
): value is PanelToParentMessage {
  return isPanelToParentMessage(value) && value.token === expectedToken;
}

/** True when `value` is a structurally valid parent→iframe message. */
export function isParentToPanelMessage(
  value: unknown,
): value is ParentToPanelMessage {
  return ParentToPanelMessageSchema.safeParse(value).success;
}

/**
 * Create the per-panel-instance bridge token. Cryptographically random;
 * generated by the parent and delivered to the iframe only via `init`.
 *
 * crypto.randomUUID is secure-context-only — self-hosted deployments
 * are routinely served over plain HTTP on a LAN IP, where it is simply
 * absent. crypto.getRandomValues has no such restriction, so fall back
 * to 128 random bits hex-encoded (same entropy as a UUIDv4).
 */
export function createBridgeToken(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
