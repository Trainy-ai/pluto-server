import { env } from "./env";

/**
 * Platform admins operate the service itself (e.g. upgrading a customer's
 * organization to PRO) rather than belonging to any one organization, so they
 * are named by deployment config, not by a role stored in the database.
 */
export function isPlatformAdmin(
  user: { email: string; emailVerified: boolean } | null | undefined,
): boolean {
  if (!user?.emailVerified) {
    return false;
  }

  const adminEmails = new Set(
    (env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  return adminEmails.has(user.email.trim().toLowerCase());
}
