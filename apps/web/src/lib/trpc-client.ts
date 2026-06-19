import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";

// Client-side tRPC for interactive actions (login flow, notes.add). Used only
// in the browser, so a relative URL is fine here — it resolves against the
// page origin. SSR data fetching uses the `listNotes` server function instead
// (see src/server/notes-fn.ts), which avoids the relative-URL-without-origin
// problem during server rendering.
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
