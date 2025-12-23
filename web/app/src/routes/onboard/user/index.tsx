import { createFileRoute } from "@tanstack/react-router";
import UserDetailsForm from "./~components/user-details-form";
import { Footer } from "@/components/ui/footer";
import { userAuthCheck } from "@/lib/auth/check";

export const Route = createFileRoute("/onboard/user/")({
  component: RouteComponent,
  beforeLoad: async () => {
    await userAuthCheck({ isOnBoardingPage: true });
  },
});

function RouteComponent() {
  return (
    <div className="relative flex min-h-screen flex-col items-center dark:bg-black/60">
      <div className="mt-20 h-full w-full">
        <UserDetailsForm />
      </div>
      <Footer />
    </div>
  );
}
