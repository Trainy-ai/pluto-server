import { protectedProcedure } from "../../../../lib/trpc";
import { isPlatformAdmin } from "../../../../lib/platform-admin";

// Lets the UI decide whether to show the admin page link. The admin
// procedures enforce the gate themselves; this only reports it.
export const statusProcedure = protectedProcedure.query(({ ctx }) => {
  return { isPlatformAdmin: isPlatformAdmin(ctx.user) };
});
