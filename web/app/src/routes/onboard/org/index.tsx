import { createFileRoute } from "@tanstack/react-router";
import OrganizationSetupForm from "./~components/organization-setup-form";
import { Footer } from "@/components/ui/footer";

export const Route = createFileRoute("/onboard/org/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative flex min-h-screen flex-col items-center dark:bg-black/60">
      <div className="mt-20 h-full w-full">
        <OrganizationSetupForm />
      </div>
      <Footer />
    </div>
  );
}
