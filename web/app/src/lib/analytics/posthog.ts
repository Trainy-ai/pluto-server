import posthog from "posthog-js";
import { env } from "@/lib/env";

/**
 * Check if PostHog is enabled
 */
export function isPostHogEnabled(): boolean {
  return Boolean(env.VITE_POSTHOG_KEY && env.VITE_POSTHOG_HOST);
}

/**
 * Reset PostHog user (call on logout)
 */
export function resetPostHogUser(): void {
  if (!isPostHogEnabled()) {
    return;
  }

  posthog.reset();
}

/**
 * Track a custom event
 */
export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  if (!isPostHogEnabled()) {
    return;
  }

  posthog.capture(eventName, properties);
}
