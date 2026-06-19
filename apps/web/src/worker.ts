import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./server/router";
import { createDb } from "@veritra/db";
import { createAuth } from "./server/auth";

type Env = { LIBSQL_URL: string; LIBSQL_AUTH_TOKEN?: string; AUTH_SECRET: string; BASE_URL: string };

const app = new Hono<{ Bindings: Env }>();

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const db = createDb(c.env.LIBSQL_URL, c.env.LIBSQL_AUTH_TOKEN);
  const auth = createAuth(db, { secret: c.env.AUTH_SECRET, baseURL: c.env.BASE_URL });
  return auth.handler(c.req.raw);
});

app.use("/api/trpc/*", (c) =>
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext: async () => {
      const db = createDb(c.env.LIBSQL_URL, c.env.LIBSQL_AUTH_TOKEN);
      const auth = createAuth(db, { secret: c.env.AUTH_SECRET, baseURL: c.env.BASE_URL });
      const s = await auth.api.getSession({ headers: c.req.raw.headers });
      return { db, session: s ? { userId: s.user.id } : null };
    },
  })(c, async () => {}),
);

app.get("/healthz", (c) => c.text("ok"));

export default app;
