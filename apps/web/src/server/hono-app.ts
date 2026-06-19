import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./router";
import { createDb } from "@veritra/db";
import { createAuth } from "./auth";
import type { WorkerEnv } from "./env";

function requireEnv(env: WorkerEnv): { secret: string; baseURL: string } {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  if (!env.BASE_URL) throw new Error("BASE_URL is required");
  return { secret: env.AUTH_SECRET, baseURL: env.BASE_URL };
}

// The Hono app carries tRPC (/api/trpc/*), better-auth (/api/auth/*) and
// /healthz. It is mounted under TanStack Start as a server-route catch-all
// (see src/routes/api/$.ts) and also exported as the Worker entry for
// standalone `wrangler dev` use without the SSR build.
export const app = new Hono<{ Bindings: WorkerEnv }>();

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const db = createDb(c.env.LIBSQL_URL, c.env.LIBSQL_AUTH_TOKEN);
  const auth = createAuth(db, requireEnv(c.env));
  return auth.handler(c.req.raw);
});

app.use("/api/trpc/*", (c) =>
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext: async () => {
      const db = createDb(c.env.LIBSQL_URL, c.env.LIBSQL_AUTH_TOKEN);
      const auth = createAuth(db, requireEnv(c.env));
      const s = await auth.api.getSession({ headers: c.req.raw.headers });
      return { db, session: s ? { userId: s.user.id } : null };
    },
  })(c, async () => {}),
);

app.get("/healthz", (c) => c.text("ok"));
