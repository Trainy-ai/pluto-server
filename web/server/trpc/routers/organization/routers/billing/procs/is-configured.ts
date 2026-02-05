import { publicProcedure } from "../../../../../../lib/trpc";
import { isStripeConfigured } from "../../../../../../lib/stripe";

export const isConfiguredProcedure = publicProcedure.query(() => {
  return {
    isConfigured: isStripeConfigured(),
  };
});
