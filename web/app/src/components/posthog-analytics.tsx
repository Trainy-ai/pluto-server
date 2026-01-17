import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import { isPostHogEnabled } from "@/lib/analytics/posthog";
import type { RouterAppContext } from "@/routes/__root";

interface PostHogAnalyticsProps {
  auth: RouterAppContext["auth"] | null;
}

/**
 * PostHog Analytics component
 * Handles user identification, organization context, and page view tracking
 */
export function PostHogAnalytics({ auth }: PostHogAnalyticsProps) {
  const location = useLocation();
  const posthog = usePostHog();
  const lastIdentifiedUserId = useRef<string | null>(null);
  const lastOrganizationId = useRef<string | null>(null);

  // Identify user and set organization context on auth changes
  useEffect(() => {
    if (!isPostHogEnabled() || !posthog) {
      return;
    }

    const user = auth?.user;
    if (user && user.id !== lastIdentifiedUserId.current) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.name ?? undefined,
      });
      lastIdentifiedUserId.current = user.id;
    }

    const org = auth?.activeOrganization;
    if (org && org.id !== lastOrganizationId.current) {
      posthog.group("organization", org.id, {
        name: org.name,
        slug: org.slug,
      });
      lastOrganizationId.current = org.id;
    } else if (!org && lastOrganizationId.current) {
      // When a user has no active organization, we clear our internal state.
      // Note: PostHog doesn't support leaving a group without a full `reset()`,
      // so the user remains in the last group until logout or switching to a new one.
      lastOrganizationId.current = null;
    }
  }, [auth, posthog]);

  // Track page views on route changes
  useEffect(() => {
    if (!isPostHogEnabled() || !posthog) {
      return;
    }

    posthog.capture("$pageview", {
      $current_url: window.location.href,
    });
  }, [location.pathname, location.search, posthog]);

  return null;
}
