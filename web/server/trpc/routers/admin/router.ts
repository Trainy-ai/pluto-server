import { router } from "../../../lib/trpc";
import { statusProcedure } from "./procs/status";
import { listOrganizationsProcedure } from "./procs/list-organizations";
import { createCheckoutSessionProcedure } from "./procs/create-checkout-session";

export const adminRouter = router({
  status: statusProcedure,
  listOrganizations: listOrganizationsProcedure,
  createCheckoutSession: createCheckoutSessionProcedure,
});
