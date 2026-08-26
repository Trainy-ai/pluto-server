import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { prisma } from "./prisma";
import superjson from "superjson";
import { z } from "zod";

/**
 * Custom superjson wrapper that skips serialization for plain JSON-safe data.
 * superjson walks the entire object graph looking for Dates/BigInts/Maps,
 * adding ~2s overhead on 7+ MB responses that only contain numbers and strings.
 * Objects tagged with __json_safe skip the traversal.
 */
const fastSuperjson = {
  serialize(object: unknown) {
    if (object && typeof object === "object" && "__json_safe" in object) {
      const { __json_safe, ...data } = object as Record<string, unknown>;
      return { json: data, meta: undefined };
    }
    return superjson.serialize(object);
  },
  deserialize: superjson.deserialize.bind(superjson),
};

/**
 * Per-procedure metadata. `auth` records which credential a procedure demands,
 * set once on each base procedure below and inherited by everything derived
 * from it. Nothing at runtime reads it — the enforcement is the middleware —
 * but it makes the auth tier of all ~94 procedures machine-readable, which is
 * what `scripts/generate-api-inventory.ts` publishes so the tRPC surface can be
 * reviewed and security-tested without reading every proc file.
 */
export interface ProcedureMeta {
  auth: "public" | "session" | "session+org";
}

export const t = initTRPC.context<Context>().meta<ProcedureMeta>().create({
  transformer: fastSuperjson,
});

export const router = t.router;

export const publicProcedure = t.procedure.meta({ auth: "public" });

export const protectedProcedure = t.procedure
  .meta({ auth: "session" })
  .use(({ ctx, next }) => {
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
  .meta({ auth: "session+org" })
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
