let langfuseInitialized = false;

export async function initializeLangfuse(): Promise<void> {
  if (
    langfuseInitialized ||
    !process.env.LANGFUSE_PUBLIC_KEY ||
    !process.env.LANGFUSE_SECRET_KEY ||
    !process.env.LANGFUSE_BASE_URL
  ) {
    return;
  }

  try {
    const [{ NodeSDK }, { LangfuseSpanProcessor }] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@langfuse/otel"),
    ]);
    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    sdk.start();
    langfuseInitialized = true;
    console.log("[Langfuse] tracing initialized");
  } catch (error) {
    // Observability is fail-open: a tracing outage must not take down chat.
    console.warn("[Langfuse] tracing initialization failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
