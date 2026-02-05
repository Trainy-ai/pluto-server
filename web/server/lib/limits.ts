import { SubscriptionPlan } from "@prisma/client";
import { z } from "zod";

export const limitsSchema = z.object({
  dataUsageGB: z.number().min(0),
  trainingHoursPerMonth: z.number().min(0),
});

const FREE_LIMITS = {
  dataUsageGB: 2,
  trainingHoursPerMonth: 50,
};

const PRO_LIMITS = {
  dataUsageGB: 10000, // 10 TB
  trainingHoursPerMonth: 999999, // Effectively unlimited
};

export const getLimits = (plan: SubscriptionPlan) => {
  return plan === SubscriptionPlan.FREE ? FREE_LIMITS : PRO_LIMITS;
};
