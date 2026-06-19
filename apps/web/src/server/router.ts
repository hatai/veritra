import * as v from "valibot";
import { router, publicProcedure, protectedProcedure } from "./trpc";
import { schema } from "@veritra/db";

const PingInput = v.object({ name: v.pipe(v.string(), v.minLength(1)) });

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({ userId: ctx.session.userId })),

  ping: publicProcedure
    .input((raw) => v.parse(PingInput, raw))
    .query(({ input }) => ({ message: `hello ${input.name}` })),

  notes: router({
    add: publicProcedure
      .input((raw) => v.parse(v.object({ body: v.pipe(v.string(), v.minLength(1)) }), raw))
      .mutation(async ({ ctx, input }) => {
        const id = crypto.randomUUID();
        await ctx.db.insert(schema.notes).values({ id, body: input.body, createdAt: new Date() });
        return { id };
      }),
    list: publicProcedure.query(({ ctx }) => ctx.db.select().from(schema.notes)),
  }),
});

export type AppRouter = typeof appRouter;
