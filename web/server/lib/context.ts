import type { Context as HonoContext } from "hono";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { clickhouse } from "./clickhouse";
import { env } from "./env";

export type CreateContextOptions = {
  hono: HonoContext;
};

// Demo user constants (must match seed-demo.ts)
const DEMO_USER_EMAIL = "dev@example.com";
const DEMO_ORG_SLUG = "dev-org";

// Derive session type from better-auth to stay in sync with auth library
type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

// Cached demo session to avoid repeated DB lookups
let cachedDemoSession: AuthSession = null;

/**
 * Fetches the demo user and organization from the database and constructs
 * a session object that mimics what better-auth would return.
 */
async function getDemoSession(): Promise<AuthSession> {
  // Return cached session if available
  if (cachedDemoSession) {
    return cachedDemoSession;
  }

  // Find the demo user
  const user = await prisma.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
  });

  if (!user) {
    console.error("[SKIP_AUTH_DEMO] Demo user not found. Run seed-demo.ts first.");
    return null;
  }

  // Find the demo organization
  const org = await prisma.organization.findUnique({
    where: { slug: DEMO_ORG_SLUG },
  });

  if (!org) {
    console.error("[SKIP_AUTH_DEMO] Demo organization not found. Run seed-demo.ts first.");
    return null;
  }

  // Construct a session object that mimics better-auth's response
  cachedDemoSession = {
    session: {
      id: "demo-session-id",
      userId: user.id,
      token: "demo-token",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365), // 1 year
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "demo-mode",
      activeOrganizationId: org.id,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      twoFactorEnabled: user.twoFactorEnabled,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      finishedOnboarding: user.finishedOnboarding,
    },
  };

  console.log("[SKIP_AUTH_DEMO] Demo session initialized for user:", user.email);
  return cachedDemoSession;
}

export async function createContext({ hono }: CreateContextOptions) {
  let session;

  // In demo mode, inject a fake session for the pre-seeded demo user
  if (env.SKIP_AUTH_DEMO) {
    session = await getDemoSession();
  } else {
    session = await auth.api.getSession({
      headers: hono.req.raw.headers,
    });
  }

  return {
    session,
    prisma,
    user: session?.user,
    clickhouse,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
