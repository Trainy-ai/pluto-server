import { router } from "../../../../../lib/trpc";
import { createCheckoutSessionProcedure } from "./procs/create-checkout-session";
import { createPortalSessionProcedure } from "./procs/create-portal-session";
import { isConfiguredProcedure } from "./procs/is-configured";

export const billingRouter = router({
  isConfigured: isConfiguredProcedure,
  createCheckoutSession: createCheckoutSessionProcedure,
  createPortalSession: createPortalSessionProcedure,
});
