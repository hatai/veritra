// Standalone Hono Worker entry (tRPC + better-auth + /healthz).
//
// Stack integration outcome (spike decision, spec §5.4): approach A — importing
// the TanStack Start SSR handler into this raw esbuild-bundled worker — is
// infeasible, because Start's createStartHandler resolves build-time virtual
// modules (#tanstack-router-entry, #tanstack-start-entry) and the client
// manifest that only the Vite/Nitro build graph can provide. We therefore use
// approach B: TanStack Start + Nitro (cloudflare_module preset) owns the Worker
// entry, and this Hono app is mounted under it via Start server routes
// (src/routes/api/$.tsx and src/routes/healthz.tsx). The built Worker lives in
// apps/web/.output and is what `wrangler dev` runs.
//
// This file is retained as the canonical definition of the Hono app and as a
// standalone entry usable without the SSR build.
export { app as default } from "./server/hono-app";
