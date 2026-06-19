# Veritra

Test-design web app.

## Toolchain Notes

- **Vite+** (`vite-plus@0.2.1`): The local CLI binary is `vp` (not `vite-plus`). All root scripts (`test`, `test:run`, `lint`, `format`) invoke `vp` accordingly.
- **TypeScript**: The brief targeted `7.0.0-beta` (Go-based rewrite RC). `vite-plus@0.2.1` peer-requires `^5.0.0 || ^6.0.0`, so TypeScript **6.0.3** (latest stable) is used instead. This satisfies all toolchain constraints without peer-dep warnings.
- **vitest**: Bundled inside `vite-plus@0.2.1` (v4.1.9); also pinned as a direct root devDependency (`vitest@4.1.9`) so `tsconfig.base.json`'s `"types": ["vitest/globals"]` resolves without relying on transitive hoisting.
- **pnpm**: `packageManager` is set to `pnpm@10.32.1`. The brief specified `pnpm@9.15.0`, but pnpm 10 is the stable version present in the environment and is used throughout this repo.

## Stack integration outcome (Plan 1 spike, spec §5.4)

The vertical slice (TanStack Start SSR served alongside the Hono tRPC/auth API on
a single Cloudflare Worker) uses **Approach B — TanStack Start (+ Nitro) is the
outer Worker entry, and the Hono app is mounted under it** via Start server
routes. Approach A (Hono as the Worker entry with TanStack Start mounted as a
`app.all("*")` fallback) was attempted first and found **infeasible**; the
reasoning, gotchas, and dev-workflow changes are below.

### Why Approach A failed (recorded finding)

The original `apps/web/src/worker.ts` is fed **directly to wrangler** (esbuild
bundles it; there is no Vite build in the loop). TanStack Start's SSR request
handler (`createStartHandler(defaultStreamHandler)` from
`@tanstack/start-server-core`) cannot run in that context: its implementation
imports **build-time virtual modules** — `#tanstack-router-entry`,
`#tanstack-start-entry`, `#tanstack-start-plugin-adapters` — and reads the
client asset manifest via `getStartManifest()`. Those virtuals only exist inside
the bundle produced by the Start Vite plugin + Nitro build graph. There is no
way to `import { startHandler }` into a raw esbuild-bundled worker and have it
resolve. **The Vite/Nitro build must own the Worker entry**, which is exactly
what Approach B does. (Modern Start, v1.168, also delegates the server/deploy
layer to **Nitro** — `nitro/vite` with a Cloudflare preset — rather than letting
you hand-author the CF entry, which reinforces the same conclusion.)

### How Approach B is wired

- `apps/web/vite.config.ts` runs the Start plugin (`@tanstack/react-start/plugin/vite`)
  + `@vitejs/plugin-react` + `nitro({ preset: "cloudflare_module" })`. `vite build`
  emits a workerd worker to `apps/web/.output/server/index.mjs`, client assets to
  `apps/web/.output/public`, and a generated `apps/web/.output/server/wrangler.json`.
- The Hono app (tRPC `/api/trpc/*`, better-auth `/api/auth/*`, `/healthz`) lives in
  `apps/web/src/server/hono-app.ts` and is mounted under Start via two server
  routes: `src/routes/api/$.tsx` (catch-all `/api/*`) and `src/routes/healthz.tsx`,
  both `server.handlers.ANY = ({ request }) => app.fetch(request, getWorkerEnv())`.
  Page routes (`/`, `/login`) have no `server.handlers`, so they fall through to
  SSR and are **not** swallowed by the API mount.
- The original `apps/web/src/worker.ts` is retained but now just re-exports the
  Hono app as a standalone entry; it is no longer the production entry.

### Gotchas

- **CF env / bindings under Nitro.** The Worker `fetch(req, env, ctx)` env is not
  on a handler signature you control. The Nitro `cloudflare_module` runtime sets
  `globalThis.__env__ = env` on every request, so `apps/web/src/server/env.ts`
  reads `LIBSQL_URL` / `AUTH_SECRET` / `BASE_URL` from there. **Hono's `c.env` is
  empty when invoked as `app.fetch(request)`** — you must pass env explicitly:
  `app.fetch(request, getWorkerEnv())`. (This was the one regression caught during
  acceptance — tRPC initially threw `Cannot read properties of undefined (reading
  'LIBSQL_URL')` until env was threaded through.)
- **SSR tRPC without an origin.** The index loader runs on the server during SSR
  (and on the client during nav), so an `httpBatchLink({ url: "/api/trpc" })` has
  no origin server-side. Solution: `src/server/notes-fn.ts` wraps a direct
  `appRouter.createCaller({ db, session: null }).notes.list()` in `createServerFn()`.
  `notes.list` is a `publicProcedure` needing only `ctx.db`, so no auth plumbing.
  The relative-URL `httpBatchLink` client (`src/lib/trpc-client.ts`) is kept for
  browser-only actions (login, `notes.add`).
- **`nodejs_compat`.** Required and present (`compatibility_flags`); Nitro carries
  it into the generated `wrangler.json` from the root `wrangler.toml`.
- **Dev workflow change.** `pnpm dev` is now `pnpm build && wrangler dev -c
  apps/web/.output/server/wrangler.json` (it also copies `.dev.vars` into the
  output dir so wrangler loads `AUTH_SECRET`/`BASE_URL`). Nitro's own dev server
  is **not** used for acceptance because it would not load wrangler vars. Acceptance
  still runs on `http://localhost:8787`.

### Vite+ substitutions / coexistence

- **Two Vite configs.** The root `vite.config.ts` stays the Vite+ (`vp`) test/lint
  config; the Start build uses its **own** `apps/web/vite.config.ts` built by plain
  `vite` (`vite@8` is already a root devDep). They do not interfere — `vp test`
  (6 tests) and `vp lint` both stay green.
- **Lint ignores.** Added `ignorePatterns: ["**/.output/**", "**/routeTree.gen.ts",
  "**/dist/**"]` to the root lint config so `vp lint` does not flag the generated
  SSR build output or the `tsr`-generated route tree.

### Versions

`@tanstack/react-start` 1.168.26, `@tanstack/react-router` 1.170.16,
`@tanstack/router-plugin` 1.168.18, `nitro` (npm:nitro-nightly) 3.0.1, react /
react-dom 19.2.7, `@trpc/client` 11.x, better-auth 1.6.19.
