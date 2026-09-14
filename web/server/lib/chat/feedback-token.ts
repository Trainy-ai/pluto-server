import { createHmac, timingSafeEqual } from "node:crypto";

export type ChatFeedbackClaims = {
  organizationId: string;
  userId: string;
  projectName: string;
  conversationId: string;
  turnId: string;
  issuedAt: number;
};

const FEEDBACK_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

export function createChatFeedbackToken(
  claims: ChatFeedbackClaims,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyChatFeedbackToken(
  token: string,
  secret: string,
): ChatFeedbackClaims | undefined {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return undefined;

  const expected = createHmac("sha256", secret).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return undefined;
  }
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return undefined;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<ChatFeedbackClaims>;
    if (
      !claims.organizationId ||
      !claims.userId ||
      !claims.projectName ||
      !claims.conversationId ||
      !claims.turnId ||
      typeof claims.issuedAt !== "number" ||
      claims.issuedAt > Date.now() + 60_000 ||
      Date.now() - claims.issuedAt > FEEDBACK_TOKEN_TTL_MS
    ) {
      return undefined;
    }
    return claims as ChatFeedbackClaims;
  } catch {
    return undefined;
  }
}
