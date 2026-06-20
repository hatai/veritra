import { initTRPC, TRPCError } from "@trpc/server";
import type { Db } from "@veritra/db";

export type Session = { userId: string } | null;
export type Context = { db: Db; session: Session };

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});
