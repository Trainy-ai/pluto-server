import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { SignInCard } from "./~components/sign-in-card";
import { trpc } from "@/utils/trpc";
import { Footer } from "@/components/ui/footer";
import { env } from "@/lib/env";

// Demo org slug (must match seed-demo.ts)
const DEMO_ORG_SLUG = "dev-org";

export const Route = createFileRoute("/auth/sign-in")({
  component: RouteComponent,
  validateSearch: (search) => {
    if (typeof search.redirect === "string") {
      return { redirect: search.redirect };
    } else {
      return {};
    }
  },
  beforeLoad: async ({ context: { queryClient }, search }) => {
    // In demo mode, redirect directly to the demo org dashboard
    if (env.VITE_SKIP_AUTH_DEMO) {
      throw redirect({ to: `/o/$orgSlug`, params: { orgSlug: DEMO_ORG_SLUG } });
    }

    let auth = await queryClient.ensureQueryData(trpc.auth.queryOptions());
    if (auth) {
      throw redirect({ to: "/o", search: { redirect: search?.redirect } });
    }
  },
});

function RouteComponent() {
  const { redirect: unsafeRedirect } = Route.useSearch();

  // Only allow relative paths for redirect to prevent open redirect vulnerabilities.
  const redirect =
    unsafeRedirect &&
    unsafeRedirect.startsWith("/") &&
    !unsafeRedirect.startsWith("//")
      ? unsafeRedirect
      : undefined;

  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-background">
      <main className="px-4">
        <div className="mx-auto w-full max-w-sm min-w-[320px] space-y-6 py-12">
          <Link to="/" className="mx-auto block w-fit text-2xl font-semibold">
            🪐 Pluto
          </Link>
          <SignInCard redirect={redirect} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
