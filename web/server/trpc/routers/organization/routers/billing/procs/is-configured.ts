import { publicProcedure } from "../../../../../../lib/trpc";
import { isStripeConfigured, SEAT_PRICE_DOLLARS } from "../../../../../../lib/stripe";

export const isConfiguredProcedure = publicProcedure.query(() => {
  return {
    isConfigured: isStripeConfigured(),
    seatPriceDollars: SEAT_PRICE_DOLLARS,
  };
});
