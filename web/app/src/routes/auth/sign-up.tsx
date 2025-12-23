import { createFileRoute, Link } from "@tanstack/react-router";
import { SignUpCard } from "./~components/sign-up-card";
import { Footer } from "@/components/ui/footer";

export const Route = createFileRoute("/auth/sign-up")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-background">
      <main className="px-4">
        <div className="mx-auto w-full max-w-sm min-w-[320px] space-y-6 py-12">
          <Link to="/" className="mx-auto block w-fit text-2xl font-semibold">
            m:lop
          </Link>
          <SignUpCard />
        </div>
      </main>
      <Footer />
    </div>
  );
}
