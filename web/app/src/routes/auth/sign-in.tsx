import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { SignInCard } from "./~components/sign-in-card";
import { trpc } from "@/utils/trpc";
import { Footer } from "@/components/ui/footer";

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
    let auth = await queryClient.ensureQueryData(trpc.auth.queryOptions());
    if (auth) {
      throw redirect({ to: "/o", search: { redirect: search?.redirect } });
    }
  },
});

function RouteComponent() {
  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-background">
      <main className="px-4">
        <div className="mx-auto w-full max-w-sm min-w-[320px] space-y-6 py-12">
          <Link to="/" className="mx-auto block w-fit text-2xl font-semibold">
            m:lop
          </Link>
          <SignInCard />
        </div>
      </main>
      <Footer />
    </div>
  );
}
