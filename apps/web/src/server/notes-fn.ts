import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@veritra/db";
import { appRouter } from "./router";
import { getWorkerEnv } from "./env";

// SSR-safe notes fetch: the index loader runs on the server during SSR AND on
// the client during client-side navigation. Wrapping the tRPC call in a
// server function keeps the DB access server-only and avoids the relative-URL
// problem of an httpBatchLink with no origin during SSR. We call the router
// directly (createCaller) — `notes.list` is a publicProcedure that only needs
// ctx.db, so no auth/session plumbing is required here.
export const listNotes = createServerFn().handler(async () => {
  const env = getWorkerEnv();
  const db = createDb(env.LIBSQL_URL, env.LIBSQL_AUTH_TOKEN);
  const caller = appRouter.createCaller({ db, session: null });
  return caller.notes.list();
});
