import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./server/router";
import { createDb } from "@veritra/db";

type Env = { LIBSQL_URL: string; LIBSQL_AUTH_TOKEN?: string };

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/api/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext: (_opts, c) => ({
      db: createDb(c.env.LIBSQL_URL, c.env.LIBSQL_AUTH_TOKEN),
      session: null,
    }),
  }),
);

app.get("/healthz", (c) => c.text("ok"));

export default app;
