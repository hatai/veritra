# Veritra Foundation & Integration Spike — Implementation Plan (Plan 1 / 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Veritra monorepo and prove the bleeding-edge stack integrates by building one authenticated vertical slice — sign-in → an authed tRPC call that reads/writes libSQL → an SSR page — running locally on workerd via `wrangler dev`.

**Architecture:** pnpm-workspace monorepo. A Hono app is the Cloudflare Worker entry: it serves `/api/trpc/*` (tRPC + valibot), `/api/auth/*` (better-auth), and delegates everything else to the TanStack Start SSR handler. Drizzle (sqlite dialect) talks to libSQL — a local `sqld` container in dev, Turso in production (deferred). Domain logic lives in a pure, framework-free `packages/core`.

**Tech Stack:** Node.js + pnpm · Vite+ (Vite 8/Rolldown, Vitest, Oxlint, Oxfmt) · TypeScript v7 (RC) · TanStack Start · Hono.js · tRPC v11 · valibot · Drizzle ORM + libSQL/Turso · better-auth · shadcn/ui · TanStack Table · Storybook · wrangler/workerd (local).

## Why this plan exists (spec §5.4)

The spec marks the TanStack Start × Hono integration as "not self-evidently sound" and requires a spike before the data/API/UI layers are planned in executable detail. **This plan is that spike plus the scaffold it produces.** Plans 2–4 (data model + core, tRPC API + authz, UI + coverage) are detailed only after this plan de-risks the stack, because the exact server shape they build on is one of this plan's outputs.

## Global Constraints

- **Workers-compatible code only.** Production target is Cloudflare Workers (workerd). No Node-only or Bun-only APIs in app code. Use `@libsql/client/web` (HTTP client), not the native client.
- **Local development only for now.** "Deploy" means `wrangler dev` (local workerd), not a real Cloudflare deploy.
- **TypeScript v7 (RC)** is the language. **Vite+ is a replaceable tool layer** — if a Vite+ command is broken, fall back to the underlying tool (`vitest`, `oxlint`, `vite`) invoked directly, and record the substitution in `README.md`.
- **better-auth requires `nodejs_compat`** in `wrangler.toml` (AsyncLocalStorage).
- **Schema validation is valibot** everywhere (tRPC inputs, forms). Never zod.
- **TDD.** Pure logic gets a failing test first. Integration/scaffold tasks end with an explicit, runnable acceptance check.
- **Frequent commits.** One commit per task minimum, at the step indicated.
- Package manager is **pnpm** (`pnpm-workspace.yaml`). Never `npm install`/`bun install` for workspace deps.

---

## File Structure

```
veritra/
├─ pnpm-workspace.yaml
├─ package.json                 # root scripts (lint/format/test/dev) wrapping Vite+
├─ tsconfig.base.json
├─ vite.config.ts               # Vite+ unified config (test/lint/format/build)
├─ wrangler.toml                # worker config, nodejs_compat, libSQL vars
├─ docker-compose.yml           # local libSQL (sqld)
├─ .env.example
├─ packages/
│  ├─ core/                     # pure domain logic (no framework imports)
│  │  ├─ package.json
│  │  ├─ src/index.ts
│  │  └─ src/health.ts          # trivial fn used to prove Vitest works (removed in Plan 2)
│  └─ db/                       # Drizzle schema + client
│     ├─ package.json
│     ├─ src/client.ts          # libSQL/web client factory
│     ├─ src/schema.ts          # tables (auth tables + a spike `notes` table)
│     └─ drizzle.config.ts
└─ apps/
   └─ web/                      # TanStack Start app + Hono worker entry
      ├─ package.json
      ├─ app.config.ts          # TanStack Start config (CF target)
      ├─ src/
      │  ├─ worker.ts           # Hono entry: /api/trpc, /api/auth, fallback → Start
      │  ├─ server/
      │  │  ├─ trpc.ts          # tRPC init: context, t, publicProcedure, protectedProcedure
      │  │  ├─ router.ts        # appRouter (ping + notes for the slice)
      │  │  └─ auth.ts          # better-auth instance (Drizzle adapter)
      │  ├─ lib/trpc-client.ts  # client for use in routes
      │  └─ routes/
      │     ├─ __root.tsx
      │     ├─ index.tsx        # SSR page calling the authed tRPC
      │     └─ login.tsx        # email+password sign-in form
      └─ tests/
         ├─ trpc.integration.test.ts
         └─ auth.integration.test.ts
```

---

## Task 1: Monorepo scaffold + Vite+ toolchain + first passing test

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `vite.config.ts`, `.gitignore` (exists — extend)
- Create: `packages/core/package.json`, `packages/core/src/index.ts`, `packages/core/src/health.ts`
- Test: `packages/core/src/health.test.ts`

**Interfaces:**
- Produces: `add(a: number, b: number): number` exported from `packages/core` (throwaway, proves the test runner + TS path resolution work; deleted in Plan 2).
- Produces: root scripts `pnpm test`, `pnpm lint`, `pnpm format` wrapping Vite+.

- [ ] **Step 1: Initialize the workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Root `package.json`:
```json
{
  "name": "veritra",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vite-plus test",
    "test:run": "vite-plus test run",
    "lint": "vite-plus lint",
    "format": "vite-plus format",
    "dev": "wrangler dev",
    "db:up": "docker compose up -d",
    "db:migrate": "pnpm --filter @veritra/db migrate"
  },
  "devDependencies": {
    "vite-plus": "latest",
    "vite": "^8.0.0",
    "typescript": "7.0.0-beta",
    "wrangler": "^4.0.0"
  }
}
```

> **Vite+ fallback (Global Constraint):** if `vite-plus test` is not resolvable, set `"test": "vitest"`, `"lint": "oxlint"`, `"format": "oxfmt"`, add those as devDependencies, and note the substitution in `README.md`. Pin `typescript` to the latest published v7 RC tag if `7.0.0-beta` is unavailable (`pnpm view typescript versions | tail`).

- [ ] **Step 2: Base TS + Vite+ config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  }
}
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  test: { environment: "node", globals: true },
});
```

- [ ] **Step 3: Create `packages/core` and write the failing test**

`packages/core/package.json`:
```json
{
  "name": "@veritra/core",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/core/src/health.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { add } from "./health";

describe("add", () => {
  it("sums two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `pnpm install && pnpm test:run`
Expected: FAIL — `Cannot find module './health'` (or `add is not a function`).

- [ ] **Step 5: Implement minimally**

`packages/core/src/health.ts`:
```ts
export function add(a: number, b: number): number {
  return a + b;
}
```

`packages/core/src/index.ts`:
```ts
export { add } from "./health";
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm test:run`
Expected: PASS (1 test). Also run `pnpm lint` and confirm it executes (warnings OK, no crash).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with Vite+ toolchain and core package"
```

---

## Task 2: Local libSQL (Docker) + Drizzle client + schema + a read/write test

**Files:**
- Create: `docker-compose.yml`, `.env.example`
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`, `packages/db/src/client.ts`, `packages/db/src/schema.ts`
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces: `createDb(url: string, authToken?: string)` → Drizzle `LibSQLDatabase` typed with the schema.
- Produces: `notes` table `{ id: text pk, body: text, createdAt: integer }` (spike-only; replaced by the real model in Plan 2).
- Produces: better-auth tables (`user`, `session`, `account`, `verification`) — generated in Task 4, declared here as the same Drizzle schema file.

- [ ] **Step 1: Local libSQL container**

`docker-compose.yml`:
```yaml
services:
  libsql:
    image: ghcr.io/tursodatabase/libsql-server:latest
    ports:
      - "8080:8080"
    environment:
      - SQLD_NODE=primary
```

`.env.example`:
```
# local sqld over HTTP
LIBSQL_URL=http://127.0.0.1:8080
LIBSQL_AUTH_TOKEN=
```

Run: `cp .env.example .env && pnpm db:up` then `curl -s http://127.0.0.1:8080/health` → expect HTTP 200.

- [ ] **Step 2: db package + Drizzle config**

`packages/db/package.json`:
```json
{
  "name": "@veritra/db",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" },
  "scripts": { "migrate": "drizzle-kit push" },
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "drizzle-orm": "^0.38.0"
  },
  "devDependencies": { "drizzle-kit": "^0.30.0" }
}
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.LIBSQL_URL!,
    authToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
  },
});
```

- [ ] **Step 3: Web client factory (Workers-compatible)**

`packages/db/src/client.ts`:
```ts
import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function createDb(url: string, authToken?: string) {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}
export type Db = ReturnType<typeof createDb>;
```

`packages/db/src/index.ts`:
```ts
export * from "./client";
export * as schema from "./schema";
```

- [ ] **Step 4: Schema with the spike `notes` table**

`packages/db/src/schema.ts`:
```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 5: Write the failing read/write test**

`packages/db/src/schema.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createDb } from "./client";
import { notes } from "./schema";

const db = createDb(process.env.LIBSQL_URL ?? "http://127.0.0.1:8080");

describe("notes table", () => {
  beforeAll(async () => {
    await db.run(
      "CREATE TABLE IF NOT EXISTS notes (id text primary key, body text not null, created_at integer not null)",
    );
  });

  it("inserts and reads back a note", async () => {
    const id = "spike-1";
    await db.insert(notes).values({ id, body: "hello", createdAt: new Date() });
    const rows = await db.select().from(notes).where(eqId(id));
    expect(rows[0]?.body).toBe("hello");
  });
});

function eqId(id: string) {
  const { eq } = require("drizzle-orm");
  return eq(notes.id, id);
}
```

- [ ] **Step 6: Run the test, verify it fails then passes**

Run (DB must be up): `pnpm db:up && pnpm --filter @veritra/db exec vitest run`
Expected: FAIL first if container down (connection refused) → start container → PASS. Confirm a row round-trips.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): libSQL web client + Drizzle schema with local sqld and round-trip test"
```

---

## Task 3: Hono worker entry + tRPC `ping` round-trip (valibot input)

**Files:**
- Create: `apps/web/package.json`, `apps/web/src/worker.ts`, `apps/web/src/server/trpc.ts`, `apps/web/src/server/router.ts`
- Create: `wrangler.toml`
- Test: `apps/web/tests/trpc.integration.test.ts`

**Interfaces:**
- Consumes: `createDb` from `@veritra/db`.
- Produces: `appRouter` with `ping: query({ name: string }) → { message: string }` and `notes.add`/`notes.list`.
- Produces: tRPC context `{ db: Db; session: Session | null }`; `publicProcedure`; `protectedProcedure` (defined in Task 4).
- Produces: a Hono `app` (default export of `worker.ts`) mounting `/api/trpc/*`.

- [ ] **Step 1: web package deps**

`apps/web/package.json`:
```json
{
  "name": "@veritra/web",
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "@veritra/core": "workspace:*",
    "@veritra/db": "workspace:*",
    "@trpc/server": "^11.0.0",
    "hono": "^4.6.0",
    "valibot": "^1.0.0"
  }
}
```

- [ ] **Step 2: tRPC init**

`apps/web/src/server/trpc.ts`:
```ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { Db } from "@veritra/db";

export type Session = { userId: string } | null;
export type Context = { db: Db; session: Session };

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});
```

- [ ] **Step 3: Write the failing router test**

`apps/web/tests/trpc.integration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { appRouter } from "../src/server/router";
import { createDb } from "@veritra/db";

function caller() {
  const db = createDb(process.env.LIBSQL_URL ?? "http://127.0.0.1:8080");
  return appRouter.createCaller({ db, session: null });
}

describe("appRouter.ping", () => {
  it("echoes the name", async () => {
    const res = await caller().ping({ name: "Veritra" });
    expect(res.message).toBe("hello Veritra");
  });

  it("rejects empty name (valibot)", async () => {
    await expect(caller().ping({ name: "" })).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `pnpm --filter @veritra/web exec vitest run tests/trpc.integration.test.ts`
Expected: FAIL — `appRouter` not found.

- [ ] **Step 5: Implement the router with valibot**

`apps/web/src/server/router.ts`:
```ts
import * as v from "valibot";
import { router, publicProcedure } from "./trpc";
import { schema } from "@veritra/db";

const PingInput = v.object({ name: v.pipe(v.string(), v.minLength(1)) });

export const appRouter = router({
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
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm db:up && pnpm --filter @veritra/web exec vitest run tests/trpc.integration.test.ts`
Expected: PASS (2 tests). The empty-name case throws via valibot.

- [ ] **Step 7: Hono worker mounting tRPC + wrangler config**

`apps/web/src/worker.ts`:
```ts
import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./server/router";
import { createDb } from "@veritra/db";

type Env = { LIBSQL_URL: string; LIBSQL_AUTH_TOKEN?: string };

const app = new Hono<{ Bindings: Env }>();

app.use("/api/trpc/*", (c) =>
  trpcServer({
    router: appRouter,
    createContext: () => ({
      db: createDb(c.env.LIBSQL_URL, c.env.LIBSQL_AUTH_TOKEN),
      session: null, // wired in Task 4
    }),
  })(c, async () => {}),
);

app.get("/healthz", (c) => c.text("ok"));

export default app;
```

Add `@hono/trpc-server` to `apps/web/package.json` deps (`"^0.3.0"`).

`wrangler.toml` (repo root):
```toml
name = "veritra"
main = "apps/web/src/worker.ts"
compatibility_date = "2026-06-01"
compatibility_flags = ["nodejs_compat"]

[vars]
LIBSQL_URL = "http://127.0.0.1:8080"
```

- [ ] **Step 8: Verify via wrangler dev (acceptance)**

Run: `pnpm db:up && pnpm dev` (wrangler dev), then in another shell:
```bash
curl -s "http://localhost:8787/api/trpc/ping?input=%7B%22name%22%3A%22Veritra%22%7D"
```
Expected: JSON containing `"message":"hello Veritra"`. `curl http://localhost:8787/healthz` → `ok`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): Hono worker entry with tRPC ping/notes and valibot validation"
```

---

## Task 4: better-auth (email+password, cookie sessions) wired into Hono + protected procedure

**Files:**
- Modify: `packages/db/src/schema.ts` (add auth tables), `apps/web/src/worker.ts`, `apps/web/src/server/trpc.ts`
- Create: `apps/web/src/server/auth.ts`
- Test: `apps/web/tests/auth.integration.test.ts`

**Interfaces:**
- Consumes: `Db` from `@veritra/db`; `appRouter` from Task 3.
- Produces: `createAuth(db: Db, opts: { secret: string; baseURL: string })` → better-auth instance.
- Produces: tRPC context now resolves `session` from the better-auth session cookie; `protectedProcedure` enforces it.
- Produces: a `me` protected query `→ { userId: string }`.

- [ ] **Step 1: Add better-auth + Drizzle adapter deps**

Add to `apps/web/src/server/auth.ts` deps in `apps/web/package.json`: `"better-auth": "^1.2.0"`.

- [ ] **Step 2: Auth tables in schema**

Append to `packages/db/src/schema.ts` the better-auth core tables (`user`, `session`, `account`, `verification`) per better-auth's Drizzle schema (generate with `pnpm dlx @better-auth/cli generate` and paste the output, or hand-write the four tables it documents). Then `pnpm db:migrate`.

> Acceptance for this step: `pnpm db:migrate` applies cleanly and the four tables exist (`curl` a `SELECT name FROM sqlite_master` via a quick script, or inspect with `drizzle-kit studio`).

- [ ] **Step 3: better-auth instance**

`apps/web/src/server/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "@veritra/db";

export function createAuth(db: Db, opts: { secret: string; baseURL: string }) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    emailAndPassword: { enabled: true },
    secret: opts.secret,
    baseURL: opts.baseURL,
    trustedOrigins: [opts.baseURL],
  });
}
export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 4: Write the failing auth integration test**

`apps/web/tests/auth.integration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import app from "../src/worker";

const base = "http://localhost";

describe("auth + protected procedure", () => {
  it("rejects me when anonymous", async () => {
    const res = await app.request("/api/trpc/me", {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("signs up, then me returns the user id", async () => {
    const signup = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "pw-12345678", name: "A" }),
      },
      testEnv(),
    );
    expect(signup.ok).toBe(true);
    const cookie = signup.headers.get("set-cookie")!;
    const me = await app.request("/api/trpc/me", { headers: { cookie } }, testEnv());
    expect(me.ok).toBe(true);
  });
});

function testEnv() {
  return {
    LIBSQL_URL: process.env.LIBSQL_URL ?? "http://127.0.0.1:8080",
    AUTH_SECRET: "test-secret-please-change",
    BASE_URL: "http://localhost",
  };
}
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `pnpm db:up && pnpm --filter @veritra/web exec vitest run tests/auth.integration.test.ts`
Expected: FAIL — `/api/auth/*` not mounted and `me` not defined.

- [ ] **Step 6: Mount auth in the worker + resolve session in context**

Update `apps/web/src/worker.ts`:
```ts
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
```

Add `me` to `apps/web/src/server/router.ts`:
```ts
import { protectedProcedure } from "./trpc";
// inside router({ ... }):
me: protectedProcedure.query(({ ctx }) => ({ userId: ctx.session.userId })),
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `pnpm --filter @veritra/web exec vitest run tests/auth.integration.test.ts`
Expected: PASS (2 tests) — anonymous `me` is 401; after sign-up the session cookie makes `me` return a user id.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): better-auth email/password with cookie session and protected tRPC procedure"
```

---

## Task 5: TanStack Start SSR page served via Hono fallback (the vertical slice)

**Files:**
- Create: `apps/web/app.config.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`, `apps/web/src/routes/login.tsx`, `apps/web/src/lib/trpc-client.ts`
- Modify: `apps/web/src/worker.ts` (fallback → TanStack Start handler)

**Interfaces:**
- Consumes: `AppRouter` type from Task 3; `/api/auth/*` from Task 4.
- Produces: an SSR `/` page that calls `notes.list` and renders rows; a `/login` page posting to `/api/auth/sign-in/email`.

> **Spike decision point (spec §5.4).** The hard part is making Hono the outer entry while TanStack Start handles SSR. Attempt **approach A** first; if it fails, fall back to **approach B**, and record the outcome in `README.md` — this recorded decision is a primary deliverable of Plan 1 that Plans 2–4 build on.
>
> - **Approach A — Hono outer, Start as fallback:** scaffold the app with `pnpm dlx create-cloudflare@latest -- apps/web --framework=tanstack-start` into a temp dir and lift its CF server handler; in `worker.ts` add a final `app.all("*", (c) => startHandler(c.req.raw, c.env))`. Acceptance: `/` renders SSR and `/api/trpc/*` still works.
> - **Approach B — Start outer, Hono mounted:** keep TanStack Start's own CF worker entry and mount the Hono app (tRPC + auth) under it via a server route / API handler. Acceptance: same as A.

- [ ] **Step 1: Scaffold TanStack Start (CF target) into apps/web**

Run: `pnpm dlx create-cloudflare@latest -- veritra-web-tmp --framework=tanstack-start` in a scratch dir, then copy its `app.config.ts`, `src/routes/__root.tsx`, and CF entry into `apps/web`, adapting imports. Install the resulting deps (`@tanstack/react-start`, `react`, `react-dom`) into `apps/web/package.json`.

- [ ] **Step 2: tRPC client for routes**

`apps/web/src/lib/trpc-client.ts`:
```ts
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
```

- [ ] **Step 3: Index route renders notes (loader = SSR data)**

`apps/web/src/routes/index.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../lib/trpc-client";

export const Route = createFileRoute("/")({
  loader: async () => ({ notes: await trpc.notes.list.query() }),
  component: Home,
});

function Home() {
  const { notes } = Route.useLoaderData();
  return (
    <main>
      <h1>Veritra spike</h1>
      <ul>{notes.map((n) => <li key={n.id}>{n.body}</li>)}</ul>
      <a href="/login">login</a>
    </main>
  );
}
```

- [ ] **Step 4: Login route (email+password)**

`apps/web/src/routes/login.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    window.location.href = "/";
  }
  return (
    <form onSubmit={submit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <button type="submit">sign in</button>
    </form>
  );
}
```

- [ ] **Step 5: Wire the fallback in worker.ts (approach A or B)**

Apply the chosen approach from the decision point. The fallback must come **after** the `/api/*` routes so API calls are not swallowed by SSR.

- [ ] **Step 6: Acceptance — full slice via wrangler dev**

Run: `pnpm db:up && pnpm dev`. Then:
1. `curl -s http://localhost:8787/ | grep "Veritra spike"` → SSR HTML present.
2. Seed a note: `curl -s -X POST http://localhost:8787/api/trpc/notes.add -H 'content-type: application/json' -d '{"body":"first"}'` → `{ id }`.
3. Reload `/` → the note appears in SSR output.
4. `curl -s http://localhost:8787/api/trpc/ping?input=%7B%22name%22%3A%22x%22%7D` still returns the message (API not swallowed by fallback).

- [ ] **Step 7: Record the spike outcome + commit**

Add a "Stack integration outcome" section to `README.md` stating which approach (A/B) worked, any `nodejs_compat`/cookie/SSR gotchas, and any Vite+ substitutions made.

```bash
git add -A
git commit -m "feat(web): TanStack Start SSR slice served via Hono; record stack integration outcome"
```

---

## Task 6: Dev docs + CI smoke (lock the workflow)

**Files:**
- Create/Modify: `README.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: documented `pnpm` workflow; CI that runs lint + tests against a libSQL service and a `wrangler dev` smoke check.

- [ ] **Step 1: README dev workflow**

Document: prerequisites (Node ≥22, pnpm, Docker), `pnpm install`, `pnpm db:up`, `pnpm db:migrate`, `pnpm dev`, `pnpm test`. Include the spike outcome section from Task 5.

- [ ] **Step 2: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      libsql:
        image: ghcr.io/tursodatabase/libsql-server:latest
        ports: ["8080:8080"]
        env: { SQLD_NODE: primary }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test:run
        env: { LIBSQL_URL: "http://127.0.0.1:8080" }
```

- [ ] **Step 3: Verify CI config locally + commit**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm test:run` (with DB up). Expected: all green.

```bash
git add -A
git commit -m "ci: lint + tests against libSQL service; document dev workflow"
```

---

## Self-Review (against spec)

- **§5.4 spike (Hono+tRPC, better-auth cookie, Start SSR, Turso r/w, workerd):** Tasks 3–5 cover each; real CF deploy is replaced by `wrangler dev` per the local-only constraint. ✓
- **§5.1 stack (Node+pnpm, Vite+, TS7 RC, TanStack Start, Hono, tRPC, valibot, Drizzle+libSQL, better-auth):** Tasks 1–5. ✓ Vite+ fallback documented (Global Constraints). ✓
- **§5.3 workerd CI early:** Task 6. ✓
- **valibot not zod:** Task 3 uses valibot. ✓
- **`@libsql/client/web` (no native client):** Task 2 Step 3. ✓
- **`nodejs_compat`:** Task 3 `wrangler.toml`. ✓
- **Not yet covered (deferred to Plans 2–4, by design):** real domain entities/edges/project_id (Plan 2), coverage rules (Plan 2), CRUD routers + authz/roles (Plan 3), tree + case-table UI + coverage view + shadcn/Storybook + minimal E2E (Plan 4). The spike's `notes` table and `add()` are throwaway and removed in Plan 2.

## Next plans (detailed after this spike de-risks the stack)

- **Plan 2 — Data model + domain core:** real Drizzle schema (Requirement/Viewpoint/Condition/TestCase + 3 edge tables, `project_id`, timestamps, `archived_at`, `provenance`, fractional `position`, composite UNIQUE); `packages/core` placement ops + deterministic coverage rules (§4 contract) under TDD.
- **Plan 3 — tRPC API + auth/roles:** CRUD + edge procedures, `protectedProcedure` membership checks, permission table (§6), invites, last-admin protection.
- **Plan 4 — UI + coverage:** TanStack Start routes, tree component + TanStack Table case grid, coverage badges/summary, shadcn/ui, Storybook, minimal E2E (§7).
