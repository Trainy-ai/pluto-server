import { z } from "zod";
import { protectedProcedure } from "../../../../lib/trpc";

const onboardingDetailsSchema = z.object({
  location: z.string().optional(),
  background: z.string().optional(),
  company: z.string().optional(),
  howDidYouHearAboutUs: z.string().optional(),
  agreeToMarketing: z.boolean().default(false),
});

export const finishOnboardingProcedure = protectedProcedure
  .input(onboardingDetailsSchema)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    // Update user and create onboarding details in a transaction
    const result = await ctx.prisma.$transaction(async (tx) => {
      // Update user's finishedOnboarding status and create/update onboarding details
      try {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            finishedOnboarding: true,
            OnboardingDetails: {
              upsert: {
                create: {
                  id: `onb_${userId}`,
                  ...input,
                },
                update: input,
              },
            },
          },
        });

        return updatedUser;
      } catch (error) {
        console.error("Error updating user:", error);
        throw error;
      }
    });

    return result;
  });
