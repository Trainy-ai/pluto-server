import type { Context as HonoContext } from "hono";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { Clickhouse } from "./clickhouse";

export type CreateContextOptions = {
  hono: HonoContext;
};

export async function createContext({ hono }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: hono.req.raw.headers,
  });

  const clickhouse = new Clickhouse();

  return {
    session,
    prisma,
    user: session?.user,
    clickhouse,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
