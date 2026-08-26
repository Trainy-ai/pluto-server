/**
 * Authenticated API docs (Swagger UI).
 *
 * `GET /api/docs` renders Swagger UI for `/api/openapi.json`, but only for a
 * caller who already holds a valid better-auth session — the same login the web
 * app uses. There is no anonymous view: an unauthenticated request gets a
 * sign-in page and a 401.
 *
 * Once the page loads it mints a short-lived API key from the caller's OWN
 * organization membership and preauthorizes Swagger UI with it. That makes
 * "Try it out" send a real `Authorization: Bearer <key>` header, and — the
 * point of the exercise — the curl command Swagger UI prints is copy-pasteable
 * and succeeds verbatim in a terminal.
 *
 * Properties that matter for a pentest of this surface:
 *   - The key is bound to an org the session user is a member of. The org can
 *     be chosen, but only from that user's memberships (an unknown or
 *     non-member org id is a 403), so the page cannot be used to widen access.
 *   - The key expires (`DOCS_KEY_TTL_MINUTES`) and is hashed at rest like every
 *     other secure key; the plaintext is returned exactly once, at mint time.
 *   - Exactly one live docs key exists per (user, org): minting revokes the
 *     previous one, and the banner's Revoke button kills it on demand.
 *   - The mint/revoke endpoints require a custom request header, which forces a
 *     CORS preflight and so cannot be driven cross-site by a simple form POST.
 *   - Minting can be turned off entirely with `DOCS_TEMP_KEYS_DISABLED=true`;
 *     the UI then falls back to Swagger's own Authorize dialog.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { nanoid } from "nanoid";

import {
  apiKeyToStore,
  createKeyString,
  generateApiKey,
} from "../lib/api-key";
import { auth } from "../lib/auth";
import { env } from "../lib/env";
import { prisma } from "../lib/prisma";
import { buildTrpcOpenApiDocument } from "../lib/trpc-surface";
import { renderDocsPage, renderSignInPage } from "./docs-page";

const router = new Hono();

/** Name every auto-minted key carries, so they are identifiable and revocable. */
export const DOCS_KEY_NAME = "Swagger UI (temporary)";

/** Lifetime of an auto-minted docs key. */
export const DOCS_KEY_TTL_MINUTES = 60;

/**
 * Required on mint/revoke. A cross-site page can send a cookie-bearing form
 * POST, but it cannot set a custom header without a preflight the browser will
 * refuse — so this header is what keeps the mint endpoint from being a CSRF
 * credential factory.
 */
const DOCS_REQUEST_HEADER = "x-mlop-docs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type SessionUser = { id: string; email: string; name: string | null };

type Membership = {
  organizationId: string;
  role: string;
  organization: { id: string; name: string; slug: string };
};

async function getSessionUser(
  c: Context,
): Promise<{ user: SessionUser; activeOrganizationId: string | null } | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return null;
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    },
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  };
}

async function listMemberships(userId: string): Promise<Membership[]> {
  return prisma.member.findMany({
    where: { userId },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The org a docs key is minted for. `requestedId` is caller-supplied and is
 * only ever used to *select* from the caller's own memberships — never to look
 * an org up directly — so a key can never be issued for an org the session
 * user does not belong to.
 */
function resolveMembership(
  memberships: Membership[],
  requestedId: string | null,
  activeOrganizationId: string | null,
): Membership | null {
  if (requestedId) {
    return memberships.find((m) => m.organizationId === requestedId) ?? null;
  }
  return (
    memberships.find((m) => m.organizationId === activeOrganizationId) ??
    memberships[0] ??
    null
  );
}

function requiresDocsHeader(c: Context): boolean {
  return c.req.header(DOCS_REQUEST_HEADER) !== "1";
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Revoke (soft-delete) every live auto-minted docs key for a user+org. */
async function revokeDocsKeys(userId: string, organizationId: string) {
  const { count } = await prisma.apiKey.updateMany({
    where: {
      userId,
      organizationId,
      name: DOCS_KEY_NAME,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * The docs page itself. Session-gated: no session, no UI.
 */
router.get("/", async (c) => {
  const session = await getSessionUser(c);
  if (!session) {
    return c.html(renderSignInPage(), 401, {
      ...NO_STORE,
      "X-Robots-Tag": "noindex",
    });
  }
  return c.html(renderDocsPage(), 200, { ...NO_STORE, "X-Robots-Tag": "noindex" });
});

/**
 * OpenAPI document for the tRPC surface, so the same Swagger UI can drive the
 * procedures the web app calls — not just the REST API.
 *
 * Session-gated, unlike /api/openapi.json: a machine-readable map of every
 * internal procedure and its input shape is exactly the reconnaissance an
 * unauthenticated visitor should not be handed. Built once per process (94
 * Zod schemas to convert) and reused.
 */
let trpcDocument: ReturnType<typeof buildTrpcOpenApiDocument> | null = null;

router.get("/openapi-trpc.json", async (c) => {
  const session = await getSessionUser(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401, NO_STORE);
  }
  if (!trpcDocument) {
    trpcDocument = buildTrpcOpenApiDocument(env.PUBLIC_URL);
  }
  return c.json(trpcDocument, 200, NO_STORE);
});

/**
 * Who the browser is signed in as, and which orgs a key can be minted for.
 * Drives the banner's org picker.
 */
router.get("/session", async (c) => {
  const session = await getSessionUser(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401, NO_STORE);
  }

  const memberships = await listMemberships(session.user.id);
  return c.json(
    {
      user: { email: session.user.email, name: session.user.name },
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
      activeOrganizationId: session.activeOrganizationId,
      tempKeysEnabled: !env.DOCS_TEMP_KEYS_DISABLED,
      ttlMinutes: DOCS_KEY_TTL_MINUTES,
    },
    200,
    NO_STORE,
  );
});

/**
 * Mint a short-lived API key for the signed-in user, scoped to one of their
 * own orgs. The plaintext is returned once and never stored.
 */
router.post("/key", async (c) => {
  if (env.DOCS_TEMP_KEYS_DISABLED) {
    return c.json(
      {
        error: "Not Found",
        message: "Temporary docs keys are disabled on this deployment",
      },
      404,
      NO_STORE,
    );
  }

  const session = await getSessionUser(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401, NO_STORE);
  }
  if (requiresDocsHeader(c)) {
    return c.json(
      {
        error: "Forbidden",
        message: `Missing ${DOCS_REQUEST_HEADER} request header`,
      },
      403,
      NO_STORE,
    );
  }

  const body = await readJsonBody(c);
  const requestedId =
    typeof body.organizationId === "string" ? body.organizationId : null;

  const memberships = await listMemberships(session.user.id);
  if (memberships.length === 0) {
    return c.json(
      {
        error: "Forbidden",
        message: "You are not a member of any organization",
      },
      403,
      NO_STORE,
    );
  }

  const membership = resolveMembership(
    memberships,
    requestedId,
    session.activeOrganizationId,
  );
  if (!membership) {
    return c.json(
      {
        error: "Forbidden",
        message: "You are not a member of this organization",
      },
      403,
      NO_STORE,
    );
  }

  // One live docs credential per user+org: issuing a new one kills the old.
  await revokeDocsKeys(session.user.id, membership.organizationId);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DOCS_KEY_TTL_MINUTES * 60 * 1000);
  const plaintext = generateApiKey(true);

  await prisma.apiKey.create({
    data: {
      id: nanoid(),
      name: DOCS_KEY_NAME,
      organizationId: membership.organizationId,
      userId: session.user.id,
      key: await apiKeyToStore(plaintext),
      keyString: createKeyString(plaintext),
      isHashed: true,
      createdAt: now,
      expiresAt,
    },
  });

  return c.json(
    {
      apiKey: plaintext,
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: DOCS_KEY_TTL_MINUTES,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
      },
      user: { email: session.user.email },
    },
    200,
    NO_STORE,
  );
});

/** Revoke the caller's live docs keys (all orgs, or one via `organizationId`). */
router.post("/key/revoke", async (c) => {
  const session = await getSessionUser(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401, NO_STORE);
  }
  if (requiresDocsHeader(c)) {
    return c.json(
      {
        error: "Forbidden",
        message: `Missing ${DOCS_REQUEST_HEADER} request header`,
      },
      403,
      NO_STORE,
    );
  }

  const body = await readJsonBody(c);
  const requestedId =
    typeof body.organizationId === "string" ? body.organizationId : null;

  const memberships = await listMemberships(session.user.id);
  const targets = requestedId
    ? memberships.filter((m) => m.organizationId === requestedId)
    : memberships;

  let revoked = 0;
  for (const membership of targets) {
    revoked += await revokeDocsKeys(session.user.id, membership.organizationId);
  }

  return c.json({ revoked }, 200, NO_STORE);
});

export default router;
