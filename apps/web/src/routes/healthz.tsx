import { createFileRoute } from "@tanstack/react-router";
import { app } from "../server/hono-app";
import { getWorkerEnv } from "../server/env";

// /healthz lives outside /api, so it needs its own server route to reach the
// Hono app (preserves the Task 3 health endpoint through the Start entry).
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      ANY: ({ request }) => app.fetch(request, getWorkerEnv()),
    },
  },
});
