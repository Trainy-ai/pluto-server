import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SignUpCard } from "./~components/sign-up-card";
import { Footer } from "@/components/ui/footer";
import { env } from "@/lib/env";

// Demo org slug (must match seed-demo.ts)
const DEMO_ORG_SLUG = "dev-org";

export const Route = createFileRoute("/auth/sign-up")({
  component: RouteComponent,
  beforeLoad: async () => {
    // In demo mode, redirect directly to the demo org dashboard
    if (env.VITE_SKIP_AUTH_DEMO) {
      throw redirect({ to: `/o/$orgSlug`, params: { orgSlug: DEMO_ORG_SLUG } });
    }
  },
});

function RouteComponent() {
  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-background">
      <main className="px-4">
        <div className="mx-auto w-full max-w-sm min-w-[320px] space-y-6 py-12">
          <Link to="/" className="mx-auto block w-fit text-2xl font-semibold">
            🪐 Pluto
          </Link>
          <SignUpCard />
        </div>
      </main>
      <Footer />
    </div>
  );
}
