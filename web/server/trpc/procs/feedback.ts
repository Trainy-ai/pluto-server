import { z } from "zod";
import { protectedOrgProcedure } from "../../lib/trpc";

export const feedbackProcedure = protectedOrgProcedure
  .input(
    z.object({
      feedback: z.string(),
      feedbackSentiment: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId } = input;

    const feedback = await ctx.prisma.feedback.create({
      data: {
        organizationId,
        userId: ctx.session.user.id,
        feedback: input.feedback,
        feedbackSentiment: input.feedbackSentiment,
      },
    });

    // TODO: send email to founders

    return feedback;
  });
