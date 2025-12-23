import { router } from "../../../lib/trpc";
import { checkSlugAvailabilityProcedure } from "./procs/check-slug-availability";
import { finishOnboardingProcedure } from "./procs/finish-onboarding";

export const onboardingRouter = router({
  finishOnboarding: finishOnboardingProcedure,
  checkSlugAvailability: checkSlugAvailabilityProcedure,
});
