import { createFileRoute } from "@tanstack/react-router";
import { app } from "../../server/hono-app";
import { getWorkerEnv } from "../../server/env";

// Catch-all server route: every /api/* request is delegated to the Hono app
// (tRPC + better-auth). This is the "approach B" seam — Start/Nitro owns the
// Worker entry, Hono is mounted under it. The full request URL is passed
// unchanged so Hono's absolute /api/trpc/* and /api/auth/* routes match.
// Page routes (/, /login) have no `server.handlers`, so they fall through to
// SSR automatically and are never swallowed by this handler.
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      // Pass the CF env as Hono's Bindings so c.env.LIBSQL_URL etc. resolve —
      // under Nitro the env is on globalThis.__env__, not the fetch signature.
      ANY: ({ request }) => app.fetch(request, getWorkerEnv()),
    },
  },
});
