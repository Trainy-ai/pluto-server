import { env } from "../env";

export function isChatModelConfigured(): boolean {
  return Boolean(env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL);
}

export function isChatEnabledForOrganization(organizationId: string): boolean {
  if (!isChatModelConfigured()) return false;

  const enabledOrganizations = new Set(
    (env.CHAT_ENABLED_ORG_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  return (
    enabledOrganizations.has("*") || enabledOrganizations.has(organizationId)
  );
}
