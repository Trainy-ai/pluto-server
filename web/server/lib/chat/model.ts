import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../env";

export function getChatModel() {
  if (!env.OPENAI_COMPATIBLE_BASE_URL || !env.OPENAI_COMPATIBLE_MODEL) {
    throw new Error("Chat model is not configured");
  }

  const provider = createOpenAICompatible({
    name: "private-openai-compatible",
    baseURL: env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, ""),
    apiKey: env.OPENAI_COMPATIBLE_API_KEY,
    includeUsage: true,
  });

  return provider.chatModel(env.OPENAI_COMPATIBLE_MODEL);
}
