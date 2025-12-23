import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { prisma } from "./prisma";
import superjson from "superjson";
import { z } from "zod";

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      user: ctx.session?.user,
      prisma,
    },
  });
});

export const protectedOrgProcedure = protectedProcedure
  .input(
    z.object({
      organizationId: z.string(),
    })
  )
  .use(async ({ ctx, next, input }) => {
    const { organizationId } = input;
    const member = await ctx.prisma.member.findFirst({
      where: {
        userId: ctx.user.id,
        organizationId,
      },
    });

    if (!member) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You are not a member of this organization",
      });
    }

    return next({
      ctx: {
        ...ctx,
        member,
      },
    });
  });
