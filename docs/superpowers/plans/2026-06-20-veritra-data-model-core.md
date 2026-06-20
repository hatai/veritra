# Veritra Data Model + Domain Core — Implementation Plan (Plan 2 / 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan 1 spike scaffolding with Veritra's real typed-entity data model (Drizzle schema: 6 domain tables + 3 many-to-many edge tables, with `project_id` tenant boundary, soft-archive, `provenance`/`derivation`, fractional `position`, and **DB-enforced same-project composite foreign keys**) and a pure, framework-free domain core (`packages/core`) implementing fractional-index placement operations and the deterministic coverage rules from spec §4 — all under TDD.

**Architecture:** Two workspace packages do the work. `packages/db` owns the Drizzle schema (sqlite dialect → libSQL/Turso) and the libSQL/web client; cross-project integrity is enforced at the database level via composite FKs `(project_id, child_id) → parent(project_id, id)` with `ON DELETE CASCADE`. `packages/core` is pure and depends on no framework — it owns the domain value types + valibot validators, the fractional-index position helpers, the placement operations (add/remove/reorder edges, "remove-from-here vs delete" semantics), and the coverage computation, which operates over an **in-memory graph passed in by the caller** (the fetch/scope/active-filter happens in the db/API layer — tRPC is Plan 3). The Plan 1 spike `notes` table / `add()` / `health.ts` are removed; a minimal real-entity (Project) tRPC slice replaces the `notes` slice so the SSR / `__env__` / Start-server-route integration seam stays covered by an automated test.

**Tech Stack:** Node 24 + pnpm 10.32.1 · Vite+ 0.2.1 (CLI `vp`) / vite 8.0.16 / vitest 4.1.9 · TypeScript 7.0.1-rc · Drizzle ORM (bumped to ^0.45 — see Task 1) / drizzle-kit 0.30.6 (dialect `turso`) / `@libsql/client/web` 0.14.0 · valibot 1.4.1 · `fractional-indexing` (new, zero-dep) · TanStack Start 1.168.26 / Hono 4.12.26 / @hono/trpc-server 0.3.4 / @trpc/server 11.18.0 · better-auth 1.6.19.

---

## Global Constraints (carried from Plan 1 — do not violate)

- **Workers-compatible code only.** No Node-only / Bun-only APIs in `packages/core`, `packages/db`, or `apps/web` app code. libSQL access is `@libsql/client/web` **only** — a bare `@libsql/client` or `/node` import is already lint-blocked (`no-restricted-imports` in `vite.config.ts`). Do not unblock it.
- **Schema validation is valibot everywhere. Never zod.**
- **TypeScript is 7.0.1-rc**, forced via `pnpm-workspace.yaml` `overrides` + `peerDependencyRules`. Do not change those mechanisms. Vite+ is kept.
- **TanStack Start + Nitro own the Worker entry (Approach B).** Hono is mounted under the Start server route `apps/web/src/routes/api/$.tsx`. SSR→tRPC uses `createServerFn` + `appRouter.createCaller` (relative-URL `httpBatchLink` is not usable in SSR). CF env is read via `globalThis.__env__` (`apps/web/src/server/env.ts` `getWorkerEnv`). **Do not** bump nitro-nightly (exact-pinned `3.0.1-20260619-111502-ca57c6e5`).
- **TDD.** Pure logic (`packages/core`) gets a failing test first. Schema/integration tasks end with an explicit, runnable acceptance check (RED before GREEN where a test exists).
- **Frequent commits.** One commit per task minimum, at the step indicated. Package manager is **pnpm** (never `npm`/`bun` for workspace deps).
- **The controller verifies green, not the subagent's word.** At the points marked **CONTROLLER VERIFY**, the controller itself runs `pnpm test:run` / `pnpm typecheck` / `pnpm build`.

## Environment preconditions (check before starting)

libSQL runs in a **Windows-side** container (WSL docker socket is broken — `pnpm db:up` does **not** work here). Before any DB task:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/health
```

Expected: `200`. If not 200, **stop and ask the user to start the container on the Windows side** (you cannot start it yourself). All `packages/db` and `apps/web` integration tests require `LIBSQL_URL=http://127.0.0.1:8080`.

## Design decisions locked in brainstorming (spec left these open)

1. **Same-project integrity = composite FK, DB-enforced** (spec §3.2 option 1). Each parent entity carries `UNIQUE(project_id, id)`; each edge's parent/child FK is the composite `(project_id, X_id) → parent(project_id, id)` with `ON DELETE CASCADE`. **This requires `PRAGMA foreign_keys=ON` to be in effect** over the libSQL/web client — Task 8 verifies this empirically and is a hard gate (if FK enforcement cannot be made to work over the HTTP client, escalate to the user, since they chose DB-enforced integrity).
2. **Coverage core = pure functions over an in-memory graph** (spec §4). `packages/core` never touches the DB; the caller passes already active-filtered, project-scoped arrays. Core additionally filters each edge list to edges whose both endpoints are present in the active node sets (defensive — keeps results correct regardless of caller).
3. **Coverage gap rules are local child-count checks** (spec §4.2 table), not full reachability: `uncovered-requirement` = 0 child viewpoint edges; `uncovered-viewpoint` = 0 child condition edges; `uncovered-condition` = 0 child case edges; `orphan` = a Viewpoint/Condition/TestCase with 0 parent edges (Requirement is the root → never orphan). `reach-count` is the only full-reachability metric: per requirement, `COUNT(DISTINCT case_id)` over `requirement→viewpoint→condition→case`.
4. **`position` uses the `fractional-indexing` library** (zero-dep, pure TS, Workers-safe), wrapped by thin `packages/core` helpers — chosen over a hand-rolled implementation because correct fractional indexing (jitter, prefix/edge cases) is subtle and the library is battle-tested. DRY/YAGNI.
5. **`provenance` / `derivation` / `steps` are JSON-text columns** (`text(..., { mode: "json" })`) typed via `$type<>()` using domain types from `packages/core`. **Runtime row validation is deferred to Plan 3.** `$type<>()` is compile-time only — it does not parse rows. Plan 2 *defines and unit-tests* the valibot validators (Task 3) so the Plan 3 tRPC write/read boundary can parse with them; Plan 2 does not wire runtime parsing into any read/write path (the only Plan 2 writer, the minimal Project slice in Task 9, writes no JSON value-objects). Do not claim Plan 2 enforces JSON/enum validity at runtime — it does not.
6. **`created_by` is a plain text column (no FK)** so it survives user deletion (spec §3.4 "created_by は保持"). `membership.user_id` keeps a FK with `ON DELETE CASCADE` (spec "User 削除時は Membership を外す").
7. **Last-admin protection is NOT encoded in schema** (it is a per-project admin-count invariant, not expressible in SQLite). `membership.role` column only; enforcement is Plan 3.

---

## File Structure

```
packages/
├─ core/
│  ├─ package.json              # MODIFY: add deps valibot, fractional-indexing
│  ├─ tsconfig.json             # CREATE: extends ../../tsconfig.base.json (prereq #4)
│  └─ src/
│     ├─ index.ts               # MODIFY: re-export types/position/placement/coverage (drop add)
│     ├─ types.ts               # CREATE: domain value types + valibot validators
│     ├─ position.ts            # CREATE: fractional-index helpers (wrap fractional-indexing)
│     ├─ position.test.ts       # CREATE
│     ├─ placement.ts           # CREATE: pure add/remove/reorder edge ops + same-project guard
│     ├─ placement.test.ts      # CREATE
│     ├─ coverage.ts            # CREATE: deterministic coverage computation (spec §4)
│     ├─ coverage.test.ts       # CREATE
│     ├─ types.test.ts          # CREATE: valibot validator round-trip tests
│     ├─ health.ts              # DELETE (spike residue)
│     └─ health.test.ts         # DELETE (spike residue)
└─ db/
   ├─ package.json              # MODIFY: bump drizzle-orm ^0.45; add @veritra/core (types)
   ├─ tsconfig.json             # CREATE: extends base; EXCLUDE src/**/*.test.ts (tests use process.env — Node-only)
   └─ src/
      ├─ client.ts              # MODIFY (Task 8 only if needed): PRAGMA foreign_keys handling
      ├─ schema.ts              # MODIFY: remove notes; add 6 entity + 3 edge tables
      └─ schema.test.ts         # MODIFY: drop notes round-trip; add entity + FK/CASCADE tests
apps/web/
   ├─ tsconfig.json               # MODIFY: drop "node" from types; add workers types (prereq #3)
   └─ src/
      ├─ server/router.ts         # MODIFY: remove notes.*; add minimal project.create/list
      ├─ server/notes-fn.ts       # RENAME → projects-fn.ts: createServerFn calling caller.project.list()
      ├─ routes/index.tsx         # MODIFY: import projects-fn; render projects instead of notes
      └─ tests/
         ├─ trpc.integration.test.ts   # MODIFY: notes → project round-trip
         └─ seam.integration.test.ts   # CREATE: __env__ → Hono → tRPC → libSQL seam (prereq #7)
package.json                    # MODIFY: typecheck script → all packages (prereq #2)
.github/workflows/ci.yml        # MODIFY: add typecheck + build steps (prereq #5)
```

---

## Task 1: Resolve drizzle-orm version (prereq #5 / decision D)

**Why:** `drizzle-orm` is 0.38.4; `@better-auth/drizzle-adapter` declares peer `^0.45.2` (currently an *optional* peer, so it works but is unverified). Before laying 9 new tables on Drizzle, settle the version. This is **empirical, not a preference** — bump forward, then prove the whole toolchain stays green (same playbook the user used for TS7). Fall back only if it genuinely breaks.

**Files:**
- Modify: `packages/db/package.json` (drizzle-orm version)
- Possibly modify: `pnpm-workspace.yaml` (only if an override is needed)

- [ ] **Step 1: Bump drizzle-orm forward**

In `packages/db/package.json`, change the `drizzle-orm` dependency from `^0.38.0` (resolved 0.38.4) to `^0.45.2`. Then:

```bash
pnpm install
```

- [ ] **Step 2: Confirm the resolved version and peer satisfaction**

Run:
```bash
pnpm why drizzle-orm
```
Expected: a single resolved `drizzle-orm` at `0.45.x` (≥ 0.45.2). No duplicate major-conflicting copies. The better-auth adapter peer is now satisfied (no peer warning for it on install).

- [ ] **Step 3: CONTROLLER VERIFY — full toolchain green under the bump**

Run (DB must be up — check `/health` first):
```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```
Expected: all green. The existing 6 Plan 1 tests pass; `tsc` clean; Start+Nitro build succeeds.

> **If GREEN:** proceed. **If `drizzle-orm@0.45` breaks the build/typecheck/tests** (e.g., a `turso` dialect or `drizzle-orm/libsql` API change in `packages/db/src/client.ts`): revert the bump, instead **pin `better-auth`/`@better-auth/drizzle-adapter` to a release whose peer accepts `0.38`**, re-run this step, and record which path was taken in `.git/sdd/progress.md`. If neither is green, **stop and report to the user** — do not proceed onto a broken ORM.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(db): resolve drizzle-orm version (^0.45) to satisfy better-auth adapter peer"
```

---

## Task 2: Per-package tsconfig, typecheck-all, Workers type guard, CI build+typecheck (prereqs #2, #3, #4, #5)

**Why:** Plan 1 left `typecheck` covering only `apps/web`; `packages/core` has no tsconfig; `apps/web/tsconfig.json` includes `"node"` types (masks Workers-incompatible globals); CI runs neither `typecheck` nor `build`. Fix all four before writing real code so every later task is typechecked end-to-end.

**Files:**
- Create: `packages/core/tsconfig.json`, `packages/db/tsconfig.json`
- Modify: `package.json` (root `typecheck` script), `apps/web/tsconfig.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Inspect the current tsconfigs**

```bash
cat tsconfig.base.json apps/web/tsconfig.json
```
Note the exact `compilerOptions.types` array in `apps/web/tsconfig.json` and what `tsconfig.base.json` already sets (Plan 1 base: `types: ["vitest/globals"]`).

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/tsconfig.json` (exclude tests — they are Node-only)**

`packages/db/src/schema.test.ts` reads `process.env.LIBSQL_URL`, which needs Node globals. The base tsconfig sets `types: ["vitest/globals"]` only (no `@types/node`), and `packages/db` production code must stay Workers-safe (no Node types). So the **production** typecheck excludes test files; the tests run under vitest (Node env) where `process.env` exists at runtime.

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

> Do **not** add `"node"` to `packages/db` types to silence the test's `process.env` — that would let Node-only APIs leak into Workers-bound production code (`client.ts`/`schema.ts`) undetected. Excluding test files keeps the type guard meaningful. (`packages/core` tests use no Node globals, so its config in Step 2 includes `src` without an exclude.) If full test typechecking is wanted later, add a separate Node-aware `tsconfig.test.json` in Plan 3+.

- [ ] **Step 4: Expand the root `typecheck` script to all packages**

In `package.json`, replace:
```json
"typecheck": "tsc -p apps/web/tsconfig.json"
```
with:
```json
"typecheck": "tsc -p apps/web/tsconfig.json && tsc -p packages/core/tsconfig.json && tsc -p packages/db/tsconfig.json"
```

> Note: `apps/web` must be typechecked **after** `pnpm build` has generated `routeTree.gen.ts` at least once (Plan 1 carry-forward). In CI, the `build` step (Step 6) runs before `typecheck`. Locally, if `tsc -p apps/web` errors on a missing `routeTree.gen.ts`, run `pnpm build` first.

- [ ] **Step 5: Drop `"node"` from `apps/web` types (Workers type guard, prereq #3)**

In `apps/web/tsconfig.json`, remove `"node"` from `compilerOptions.types`. Add `@cloudflare/workers-types` so Worker globals (`Request`, `Response`, `crypto`, etc.) still resolve:

- Add dev dep: `pnpm --filter @veritra/web add -D @cloudflare/workers-types`
- Set `compilerOptions.types` to include `"@cloudflare/workers-types"` and `"vitest/globals"` (keep whatever non-`node` entries already existed), and **remove** `"node"`.

Then run:
```bash
pnpm build && pnpm typecheck
```
Expected: GREEN. **If new type errors surface**, they indicate real Node-only globals leaking into Worker code — each is a genuine finding to fix (e.g., a `process.env.X` read should go through `getWorkerEnv()`/`globalThis.__env__` per `apps/web/src/server/env.ts`; a `Buffer`/`node:*` usage should be replaced with a Workers-safe equivalent). Fix each at its source; do not re-add `"node"` to silence them. If a dependency's *type* (not your code) demands `node` and cannot be isolated, record the specific blocker in `.git/sdd/progress.md` and ask the user before re-adding.

- [ ] **Step 6: Add `typecheck` + `build` to CI (prereq #5)**

In `.github/workflows/ci.yml`, the existing job runs: install (`--frozen-lockfile`) → lint → wait-for-libSQL → `db:migrate` → `test:run`. Add a **`build` step before `typecheck`** (build regenerates `routeTree.gen.ts` which `apps/web` typecheck needs), and put both after `lint`. Concretely, insert these two steps (keep the existing libSQL service, readiness wait, and `db:migrate` exactly as they are):

```yaml
      - run: pnpm build
      - run: pnpm typecheck
```
Order in the job: `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` → `pnpm typecheck` → (wait for libSQL) → `pnpm db:migrate` → `pnpm test:run` (env `LIBSQL_URL`). Read the current file and splice — do not rewrite the libSQL service / readiness / migrate blocks.

- [ ] **Step 7: CONTROLLER VERIFY locally**

Run (DB up):
```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm typecheck && pnpm test:run
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(toolchain): per-package tsconfig, typecheck all packages, drop node types from web, CI build+typecheck"
```

---

## Task 3: `packages/core` domain value types + valibot validators (replaces spike `add()`/`health`)

**Why:** The JSON-column value objects (`Provenance`, `Derivation`, `Step`, plus `Role`/`Priority` enums) are domain types used by both `packages/db` (`$type<>()`) and the future API. They live in `packages/core` as the single source of truth, **with valibot validators that Plan 3 will use at the tRPC read/write boundary** (Plan 2 only defines and unit-tests them — it does not wire runtime parsing; see decision #5). This task also removes the spike `add()`/`health.ts`.

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/types.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`
- Delete: `packages/core/src/health.ts`, `packages/core/src/health.test.ts`

- [ ] **Step 1: Add valibot to `packages/core`**

```bash
pnpm --filter @veritra/core add valibot@1.4.1
```

- [ ] **Step 2: Write the failing validator test**

`packages/core/src/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as v from "valibot";
import {
  RoleSchema,
  PrioritySchema,
  ProvenanceSchema,
  DerivationSchema,
  StepsSchema,
} from "./types";

describe("domain validators", () => {
  it("accepts a valid role and rejects an unknown one", () => {
    expect(v.parse(RoleSchema, "admin")).toBe("admin");
    expect(() => v.parse(RoleSchema, "owner")).toThrow();
  });

  it("accepts a valid priority and rejects an unknown one", () => {
    expect(v.parse(PrioritySchema, "high")).toBe("high");
    expect(() => v.parse(PrioritySchema, "urgent")).toThrow();
  });

  it("accepts human provenance with optional model and approval", () => {
    const p = v.parse(ProvenanceSchema, { source: "human" });
    expect(p.source).toBe("human");
    const ai = v.parse(ProvenanceSchema, {
      source: "ai",
      model: "claude-opus-4-8",
      approval: "pending",
    });
    expect(ai.model).toBe("claude-opus-4-8");
  });

  it("rejects provenance with an unknown source", () => {
    expect(() => v.parse(ProvenanceSchema, { source: "robot" })).toThrow();
  });

  it("accepts a derivation with a known rule and optional memo", () => {
    const d = v.parse(DerivationSchema, { rule: "boundary", memo: "min/max" });
    expect(d.rule).toBe("boundary");
    expect(() => v.parse(DerivationSchema, { rule: "vibes" })).toThrow();
  });

  it("accepts an ordered list of string steps", () => {
    expect(v.parse(StepsSchema, ["open", "click", "assert"])).toHaveLength(3);
    expect(() => v.parse(StepsSchema, [1, 2])).toThrow();
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @veritra/core exec vitest run src/types.test.ts`
Expected: FAIL — cannot find `./types` / exports undefined.

- [ ] **Step 4: Implement `types.ts`**

`packages/core/src/types.ts`:
```ts
import * as v from "valibot";

// ---- enums / value objects ----
export const RoleSchema = v.picklist(["admin", "member"]);
export type Role = v.InferOutput<typeof RoleSchema>;

export const PrioritySchema = v.picklist(["high", "medium", "low"]);
export type Priority = v.InferOutput<typeof PrioritySchema>;

export const ProvenanceSourceSchema = v.picklist(["human", "ai"]);
export const ApprovalSchema = v.picklist(["pending", "approved", "rejected"]);
export const ProvenanceSchema = v.object({
  source: ProvenanceSourceSchema,
  model: v.optional(v.string()),
  approval: v.optional(ApprovalSchema),
});
export type Provenance = v.InferOutput<typeof ProvenanceSchema>;

export const DerivationRuleSchema = v.picklist([
  "boundary",
  "equivalence",
  "risk",
  "error-guess",
  "other",
]);
export type DerivationRule = v.InferOutput<typeof DerivationRuleSchema>;
export const DerivationSchema = v.object({
  rule: DerivationRuleSchema,
  memo: v.optional(v.string()),
});
export type Derivation = v.InferOutput<typeof DerivationSchema>;

export type Step = string;
export const StepsSchema = v.array(v.string());
```

- [ ] **Step 5: Rewire `index.ts` and delete the spike files**

`packages/core/src/index.ts`:
```ts
export * from "./types";
```

Delete the spike files:
```bash
git rm packages/core/src/health.ts packages/core/src/health.test.ts
```

- [ ] **Step 6: Run tests + typecheck, verify green**

Run:
```bash
pnpm --filter @veritra/core exec vitest run && pnpm typecheck
```
Expected: PASS (the new validator tests; `add` test is gone). `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): domain value types + valibot validators; remove spike add()/health"
```

---

## Task 4: Fractional-index position helpers (`packages/core/src/position.ts`)

**Why:** Edge order is stored as a fractional-index string `position` (O(1) insert, no resequencing). Wrap the `fractional-indexing` library in thin domain helpers so callers never touch the library directly and the semantics are tested.

**Files:**
- Create: `packages/core/src/position.ts`, `packages/core/src/position.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`

- [ ] **Step 1: Add the library**

```bash
pnpm --filter @veritra/core add fractional-indexing
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/position.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { positionBetween, appendPosition, sortByPosition } from "./position";

describe("position", () => {
  it("appends after nothing (first key) and stays sortable", () => {
    const first = appendPosition([]);
    const second = appendPosition([first]);
    expect(first < second).toBe(true);
  });

  it("generates a key strictly between two keys", () => {
    const a = appendPosition([]);
    const b = appendPosition([a]);
    const mid = positionBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
  });

  it("generates a key before all when before=null", () => {
    const a = appendPosition([]);
    const before = positionBetween(null, a);
    expect(before < a).toBe(true);
  });

  it("sorts edges by their position string", () => {
    const a = appendPosition([]);
    const b = appendPosition([a]);
    const c = appendPosition([a, b]);
    const shuffled = [{ position: c }, { position: a }, { position: b }];
    expect(sortByPosition(shuffled).map((e) => e.position)).toEqual([a, b, c]);
  });

  it("appendPosition is order-independent of input array order", () => {
    const a = appendPosition([]);
    const b = appendPosition([a]);
    // passing siblings out of order must still append after the max
    const next = appendPosition([b, a]);
    expect(next > b).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @veritra/core exec vitest run src/position.test.ts`
Expected: FAIL — cannot find `./position`.

- [ ] **Step 4: Implement `position.ts`**

`packages/core/src/position.ts`:
```ts
import { generateKeyBetween } from "fractional-indexing";

/** A value carrying a fractional-index position string. */
export interface Positioned {
  position: string;
}

/** Returns a key strictly between `before` and `after` (either may be null for an open end). */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** Returns a key that sorts after every existing sibling (append to end). */
export function appendPosition(siblings: readonly string[]): string {
  const max = siblings.length === 0 ? null : siblings.reduce((m, p) => (p > m ? p : m));
  return generateKeyBetween(max, null);
}

/** Stable ascending sort by position (does not mutate input). */
export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}
```

- [ ] **Step 5: Export from index, run tests + typecheck**

Append to `packages/core/src/index.ts`:
```ts
export * from "./position";
```

Run:
```bash
pnpm --filter @veritra/core exec vitest run src/position.test.ts && pnpm typecheck
```
Expected: PASS, `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): fractional-index position helpers (positionBetween/appendPosition/sortByPosition)"
```

---

## Task 5: Pure placement operations (`packages/core/src/placement.ts`)

**Why:** Spec §3.3 invariants and kickoff §B require pure edge operations: add/remove/reorder a placement, the same-project guard, and the "remove-from-here vs delete" distinction (a child may live under multiple parents — removing one edge must not lose the child if it is still placed elsewhere). These are pure array transforms; the DB write happens in Plan 3.

**Files:**
- Create: `packages/core/src/placement.ts`, `packages/core/src/placement.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/placement.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  addPlacement,
  removePlacement,
  reorderPlacement,
  childPlacementCount,
  assertSameProject,
  type PlacementEdge,
} from "./placement";

const edge = (parentId: string, childId: string, position: string): PlacementEdge => ({
  parentId,
  childId,
  position,
});

describe("placement", () => {
  it("adds a new placement with the given position", () => {
    const { edges, added } = addPlacement([], "p1", "c1", "a0");
    expect(added).toBe(true);
    expect(edges).toEqual([edge("p1", "c1", "a0")]);
  });

  it("is idempotent: re-adding the same (parent,child) pair does not duplicate", () => {
    const start = [edge("p1", "c1", "a0")];
    const { edges, added } = addPlacement(start, "p1", "c1", "a5");
    expect(added).toBe(false);
    expect(edges).toEqual(start); // unchanged, original position kept
  });

  it("removes exactly the named placement", () => {
    const start = [edge("p1", "c1", "a0"), edge("p2", "c1", "a0")];
    const { edges, removed } = removePlacement(start, "p1", "c1");
    expect(removed).toBe(true);
    expect(edges).toEqual([edge("p2", "c1", "a0")]);
  });

  it("reorder changes only the position of the named edge", () => {
    const start = [edge("p1", "c1", "a0"), edge("p1", "c2", "a1")];
    const edges = reorderPlacement(start, "p1", "c1", "a2");
    expect(edges.find((e) => e.childId === "c1")!.position).toBe("a2");
    expect(edges.find((e) => e.childId === "c2")!.position).toBe("a1");
  });

  it("childPlacementCount tells remove-from-here from delete (shared child)", () => {
    const shared = [edge("p1", "c1", "a0"), edge("p2", "c1", "a0")];
    expect(childPlacementCount(shared, "c1")).toBe(2); // removing one edge keeps the child
    const sole = [edge("p1", "c1", "a0")];
    expect(childPlacementCount(sole, "c1")).toBe(1); // removing the only edge orphans it
  });

  it("assertSameProject throws on a cross-project pair", () => {
    expect(() => assertSameProject({ projectId: "P" }, { projectId: "P" })).not.toThrow();
    expect(() => assertSameProject({ projectId: "P" }, { projectId: "Q" })).toThrow(
      /same project/i,
    );
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @veritra/core exec vitest run src/placement.test.ts`
Expected: FAIL — cannot find `./placement`.

- [ ] **Step 3: Implement `placement.ts`**

`packages/core/src/placement.ts`:
```ts
export interface PlacementEdge {
  parentId: string;
  childId: string;
  position: string;
}

/** Add a (parent,child) placement. Idempotent on the pair: re-adding keeps the original edge. */
export function addPlacement(
  edges: readonly PlacementEdge[],
  parentId: string,
  childId: string,
  position: string,
): { edges: PlacementEdge[]; added: boolean } {
  const exists = edges.some((e) => e.parentId === parentId && e.childId === childId);
  if (exists) return { edges: [...edges], added: false };
  return { edges: [...edges, { parentId, childId, position }], added: true };
}

/** Remove a single (parent,child) placement ("remove from here"). */
export function removePlacement(
  edges: readonly PlacementEdge[],
  parentId: string,
  childId: string,
): { edges: PlacementEdge[]; removed: boolean } {
  const next = edges.filter((e) => !(e.parentId === parentId && e.childId === childId));
  return { edges: next, removed: next.length !== edges.length };
}

/** Change the position of an existing (parent,child) placement. */
export function reorderPlacement(
  edges: readonly PlacementEdge[],
  parentId: string,
  childId: string,
  position: string,
): PlacementEdge[] {
  return edges.map((e) =>
    e.parentId === parentId && e.childId === childId ? { ...e, position } : e,
  );
}

/** How many parents a child is placed under. 1 → removing its only edge orphans it; >1 → still placed. */
export function childPlacementCount(edges: readonly PlacementEdge[], childId: string): number {
  return edges.reduce((n, e) => (e.childId === childId ? n + 1 : n), 0);
}

/** Guard: a placement may only link a parent and child in the same project (spec §3.2). */
export function assertSameProject(
  parent: { projectId: string },
  child: { projectId: string },
): void {
  if (parent.projectId !== child.projectId) {
    throw new Error(
      `placement must link entities in the same project (parent=${parent.projectId} child=${child.projectId})`,
    );
  }
}
```

- [ ] **Step 4: Export from index, run tests + typecheck**

Append to `packages/core/src/index.ts`:
```ts
export * from "./placement";
```

Run:
```bash
pnpm --filter @veritra/core exec vitest run src/placement.test.ts && pnpm typecheck
```
Expected: PASS, `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): pure placement ops (add/remove/reorder, childPlacementCount, same-project guard)"
```

---

## Task 6: Drizzle entity tables + remove spike `notes` (`packages/db/src/schema.ts`)

**Why:** Replace the spike `notes` table with the six real domain tables. Each domain entity (except `project`, which is the tenant root) carries `project_id` (FK → project, `ON DELETE CASCADE`), `created_at`/`updated_at`/`created_by` (plain text, no FK — survives user deletion), `archived_at` (nullable soft-archive), and a **`UNIQUE(project_id, id)`** so edge tables (Task 7) can composite-reference it. `provenance`/`steps`/`derivation` are JSON columns typed from `@veritra/core`.

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/package.json`, `packages/db/src/schema.test.ts`

- [ ] **Step 1: Let `@veritra/db` import domain types from `@veritra/core`**

```bash
pnpm --filter @veritra/db add @veritra/core@workspace:*
```
(Types only — no runtime coupling; `packages/core` does not import `packages/db`, so there is no cycle.)

- [ ] **Step 2: Rewrite the domain part of `schema.ts` (keep the 4 auth tables as-is)**

In `packages/db/src/schema.ts`: **delete the `notes` table**. Keep the existing `user`/`session`/`account`/`verification` tables unchanged. Add the imports and the six entity tables. The full new top of the file:

```ts
import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";
import type { Provenance, Step, Priority, Role } from "@veritra/core";

// ---- domain entities ----

export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by").notNull(), // plain text: survives user deletion (spec §3.4)
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
});

export const requirement = sqliteTable(
  "requirement",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    source: text("source"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("uq_requirement_project_id").on(t.projectId, t.id)],
);

export const viewpoint = sqliteTable(
  "viewpoint",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    memo: text("memo"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("uq_viewpoint_project_id").on(t.projectId, t.id)],
);

export const condition = sqliteTable(
  "condition",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("uq_condition_project_id").on(t.projectId, t.id)],
);

export const testCase = sqliteTable(
  "test_case",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    precondition: text("precondition"),
    steps: text("steps", { mode: "json" }).$type<Step[]>().notNull(),
    expected: text("expected"),
    priority: text("priority").$type<Priority>(),
    provenance: text("provenance", { mode: "json" }).$type<Provenance>(), // nullable
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("uq_test_case_project_id").on(t.projectId, t.id)],
);

export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }), // spec: User削除→Membership除去
    role: text("role").$type<Role>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [unique("uq_membership_project_user").on(t.projectId, t.userId)],
);

// ---- better-auth core tables (unchanged from Plan 1) ----
// (existing user / session / account / verification definitions remain below)
```

> Keep the existing `user`/`session`/`account`/`verification` declarations exactly as they are, after this block. `membership.userId` references `user.id`, so `user` must be defined — it already is, later in the file; Drizzle resolves the `() => user.id` thunk lazily, so declaration order does not matter.

- [ ] **Step 3: Migrate the schema to libSQL**

Check DB is up (`curl .../health` → 200), then:
```bash
pnpm db:migrate
```
Expected: `drizzle-kit push` applies cleanly. The `notes` table is dropped; the six new tables exist.

> drizzle-kit push against an existing dev container may prompt about dropping `notes` — accept it (this is a dev DB; data is disposable).

- [ ] **Step 4: Rewrite `schema.test.ts` — drop notes round-trip, add an entity round-trip**

Replace the `notes` test in `packages/db/src/schema.test.ts` with a Project→Requirement round-trip (FK/CASCADE is verified separately in Task 8). Full file:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { project, requirement } from "./schema";

const db = createDb(process.env.LIBSQL_URL ?? "http://127.0.0.1:8080");

describe("domain entities round-trip", () => {
  it("inserts and reads back a project and a requirement", async () => {
    const pid = `proj-${crypto.randomUUID()}`;
    const now = new Date();
    await db.insert(project).values({
      id: pid,
      title: "Veritra",
      createdAt: now,
      updatedAt: now,
      createdBy: "user-1",
    });

    const rid = `req-${crypto.randomUUID()}`;
    await db.insert(requirement).values({
      id: rid,
      projectId: pid,
      title: "Login works",
      createdAt: now,
      updatedAt: now,
      createdBy: "user-1",
    });

    const rows = await db.select().from(requirement).where(eq(requirement.id, rid));
    expect(rows[0]?.title).toBe("Login works");
    expect(rows[0]?.projectId).toBe(pid);
  });

  it("stores typed JSON columns (steps array) on a test case round-trip", async () => {
    const { testCase } = await import("./schema");
    const pid = `proj-${crypto.randomUUID()}`;
    const now = new Date();
    await db
      .insert(project)
      .values({ id: pid, title: "P", createdAt: now, updatedAt: now, createdBy: "u" });
    const cid = `case-${crypto.randomUUID()}`;
    await db.insert(testCase).values({
      id: cid,
      projectId: pid,
      title: "C",
      steps: ["open", "click"],
      createdAt: now,
      updatedAt: now,
      createdBy: "u",
    });
    const rows = await db.select().from(testCase).where(eq(testCase.id, cid));
    expect(rows[0]?.steps).toEqual(["open", "click"]);
  });
});
```

- [ ] **Step 5: Run the db tests, verify green**

Run (DB up):
```bash
pnpm --filter @veritra/db exec vitest run
```
Expected: PASS (2 tests). Row round-trips; `steps` deserializes to an array.

- [ ] **Step 6: CONTROLLER VERIFY typecheck**

Run:
```bash
pnpm typecheck
```
Expected: GREEN — `@veritra/db` typechecks with the `@veritra/core` type imports and `$type<>()` columns.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): real domain entity tables (project/requirement/viewpoint/condition/test_case/membership); remove spike notes"
```

---

## Task 7: Drizzle edge tables — composite-FK many-to-many (`packages/db/src/schema.ts`)

**Why:** The three join tables encode the DAG. Each edge has a **composite PK `(parent_id, child_id)`** (= the spec's `(親,子)` UNIQUE), a `project_id`, a fractional `position`, and (for `condition_case`) a nullable JSON `derivation`. The parent/child FKs are **composite** `(project_id, X_id) → parent(project_id, id)` with `ON DELETE CASCADE` — this is what enforces same-project at the DB level and cascades edges when an entity is deleted.

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add the edge-table imports**

At the top of `packages/db/src/schema.ts`, extend the `drizzle-orm/sqlite-core` import to include `primaryKey` and `foreignKey`, and import `Derivation` from core:
```ts
import { sqliteTable, text, integer, unique, primaryKey, foreignKey } from "drizzle-orm/sqlite-core";
import type { Provenance, Step, Priority, Role, Derivation } from "@veritra/core";
```

- [ ] **Step 2: Append the three edge tables (after the entity tables)**

```ts
// ---- many-to-many placement edges (DAG) ----

export const requirementViewpoint = sqliteTable(
  "requirement_viewpoint",
  {
    projectId: text("project_id").notNull(),
    requirementId: text("requirement_id").notNull(),
    viewpointId: text("viewpoint_id").notNull(),
    position: text("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.requirementId, t.viewpointId] }),
    foreignKey({
      columns: [t.projectId, t.requirementId],
      foreignColumns: [requirement.projectId, requirement.id],
      name: "fk_rv_requirement",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.viewpointId],
      foreignColumns: [viewpoint.projectId, viewpoint.id],
      name: "fk_rv_viewpoint",
    }).onDelete("cascade"),
  ],
);

export const viewpointCondition = sqliteTable(
  "viewpoint_condition",
  {
    projectId: text("project_id").notNull(),
    viewpointId: text("viewpoint_id").notNull(),
    conditionId: text("condition_id").notNull(),
    position: text("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.viewpointId, t.conditionId] }),
    foreignKey({
      columns: [t.projectId, t.viewpointId],
      foreignColumns: [viewpoint.projectId, viewpoint.id],
      name: "fk_vc_viewpoint",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.conditionId],
      foreignColumns: [condition.projectId, condition.id],
      name: "fk_vc_condition",
    }).onDelete("cascade"),
  ],
);

export const conditionCase = sqliteTable(
  "condition_case",
  {
    projectId: text("project_id").notNull(),
    conditionId: text("condition_id").notNull(),
    caseId: text("case_id").notNull(),
    position: text("position").notNull(),
    derivation: text("derivation", { mode: "json" }).$type<Derivation>(), // nullable, on the edge
  },
  (t) => [
    primaryKey({ columns: [t.conditionId, t.caseId] }),
    foreignKey({
      columns: [t.projectId, t.conditionId],
      foreignColumns: [condition.projectId, condition.id],
      name: "fk_cc_condition",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.caseId],
      foreignColumns: [testCase.projectId, testCase.id],
      name: "fk_cc_case",
    }).onDelete("cascade"),
  ],
);
```

- [ ] **Step 3: Migrate and confirm the FK target indexes exist**

Run (DB up):
```bash
pnpm db:migrate
```
Expected: clean push. The composite FKs require the parents' `UNIQUE(project_id, id)` (added in Task 6) as their target index — if push errors with "foreign key mismatch" or "no unique index", the column **order** in the parent `unique(...).on(projectId, id)` must match the FK `foreignColumns: [parent.projectId, parent.id]` order. They do in this plan; if you changed either, realign them.

- [ ] **Step 4: CONTROLLER VERIFY typecheck + existing tests**

Run (DB up):
```bash
pnpm typecheck && pnpm --filter @veritra/db exec vitest run
```
Expected: GREEN (Task 6 entity tests still pass; no new test yet — FK behavior is Task 8).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): many-to-many edge tables with composite-FK same-project enforcement and CASCADE"
```

---

## Task 8: Verify FK enforcement — CASCADE + cross-project rejection (prereq #6) — HARD GATE

**Why:** The composite-FK design (user's chosen integrity model) only works if `PRAGMA foreign_keys=ON` is in effect over the `@libsql/client/web` HTTP client. SQLite defaults FK enforcement **off**; libSQL server *may* default it on. **Verify empirically.** This is the gate that proves the whole integrity decision holds; if it fails and cannot be fixed via the web client, escalate.

**Files:**
- Modify: `packages/db/src/schema.test.ts` (add the FK test block below)
- Possibly modify: `packages/db/src/client.ts` (only if FK is not enforced by default)

> **Coverage requirement (this is the gate — do not narrow it):** the tests must exercise **all three edge tables** (`requirement_viewpoint`, `viewpoint_condition`, `condition_case`), **both endpoint cascades** per edge (deleting the parent *and* deleting the child each remove the edge), and **real cross-project rejection** using **two distinct, actually-inserted projects** (not a fabricated non-existent `project_id`). A single FK direction passing is not sufficient evidence that the other five composite FKs are wired and ordered correctly.

- [ ] **Step 1: Write the failing/abort tests**

Append to `packages/db/src/schema.test.ts`. (Extend the existing top-of-file imports from `./schema` to include all the tables used here: `project, requirement, viewpoint, condition, testCase, requirementViewpoint, viewpointCondition, conditionCase`.)
```ts
describe("foreign-key enforcement (composite FK: both-endpoint cascade + cross-project rejection)", () => {
  const now = new Date();
  const mkProject = async () => {
    const pid = `proj-${crypto.randomUUID()}`;
    await db.insert(project).values({ id: pid, title: "P", createdAt: now, updatedAt: now, createdBy: "u" });
    return pid;
  };
  const mkReq = async (pid: string) => {
    const id = `req-${crypto.randomUUID()}`;
    await db.insert(requirement).values({ id, projectId: pid, title: "R", createdAt: now, updatedAt: now, createdBy: "u" });
    return id;
  };
  const mkVp = async (pid: string) => {
    const id = `vp-${crypto.randomUUID()}`;
    await db.insert(viewpoint).values({ id, projectId: pid, title: "V", createdAt: now, updatedAt: now, createdBy: "u" });
    return id;
  };
  const mkCond = async (pid: string) => {
    const id = `cond-${crypto.randomUUID()}`;
    await db.insert(condition).values({ id, projectId: pid, title: "C", createdAt: now, updatedAt: now, createdBy: "u" });
    return id;
  };
  const mkCase = async (pid: string) => {
    const id = `case-${crypto.randomUUID()}`;
    await db.insert(testCase).values({ id, projectId: pid, title: "T", steps: [], createdAt: now, updatedAt: now, createdBy: "u" });
    return id;
  };

  // ---- requirement_viewpoint ----
  it("RV: cascades when the requirement (parent) is deleted", async () => {
    const pid = await mkProject();
    const rid = await mkReq(pid), vid = await mkVp(pid);
    await db.insert(requirementViewpoint).values({ projectId: pid, requirementId: rid, viewpointId: vid, position: "a0" });
    await db.delete(requirement).where(eq(requirement.id, rid));
    expect(await db.select().from(requirementViewpoint).where(eq(requirementViewpoint.requirementId, rid))).toHaveLength(0);
  });
  it("RV: cascades when the viewpoint (child) is deleted", async () => {
    const pid = await mkProject();
    const rid = await mkReq(pid), vid = await mkVp(pid);
    await db.insert(requirementViewpoint).values({ projectId: pid, requirementId: rid, viewpointId: vid, position: "a0" });
    await db.delete(viewpoint).where(eq(viewpoint.id, vid));
    expect(await db.select().from(requirementViewpoint).where(eq(requirementViewpoint.viewpointId, vid))).toHaveLength(0);
  });
  it("RV: rejects an edge linking a requirement and viewpoint from different projects", async () => {
    const pA = await mkProject(), pB = await mkProject();
    const rid = await mkReq(pA), vid = await mkVp(pB);
    // edge.project_id = pA matches the requirement but NOT the viewpoint → (pA, vid) has no parent row → reject
    await expect(
      db.insert(requirementViewpoint).values({ projectId: pA, requirementId: rid, viewpointId: vid, position: "a0" }),
    ).rejects.toThrow();
  });

  // ---- viewpoint_condition ----
  it("VC: cascades when the viewpoint (parent) is deleted", async () => {
    const pid = await mkProject();
    const vid = await mkVp(pid), cid = await mkCond(pid);
    await db.insert(viewpointCondition).values({ projectId: pid, viewpointId: vid, conditionId: cid, position: "a0" });
    await db.delete(viewpoint).where(eq(viewpoint.id, vid));
    expect(await db.select().from(viewpointCondition).where(eq(viewpointCondition.viewpointId, vid))).toHaveLength(0);
  });
  it("VC: cascades when the condition (child) is deleted", async () => {
    const pid = await mkProject();
    const vid = await mkVp(pid), cid = await mkCond(pid);
    await db.insert(viewpointCondition).values({ projectId: pid, viewpointId: vid, conditionId: cid, position: "a0" });
    await db.delete(condition).where(eq(condition.id, cid));
    expect(await db.select().from(viewpointCondition).where(eq(viewpointCondition.conditionId, cid))).toHaveLength(0);
  });
  it("VC: rejects an edge linking a viewpoint and condition from different projects", async () => {
    const pA = await mkProject(), pB = await mkProject();
    const vid = await mkVp(pA), cid = await mkCond(pB);
    await expect(
      db.insert(viewpointCondition).values({ projectId: pA, viewpointId: vid, conditionId: cid, position: "a0" }),
    ).rejects.toThrow();
  });

  // ---- condition_case ----
  it("CC: cascades when the condition (parent) is deleted", async () => {
    const pid = await mkProject();
    const cid = await mkCond(pid), tid = await mkCase(pid);
    await db.insert(conditionCase).values({ projectId: pid, conditionId: cid, caseId: tid, position: "a0" });
    await db.delete(condition).where(eq(condition.id, cid));
    expect(await db.select().from(conditionCase).where(eq(conditionCase.conditionId, cid))).toHaveLength(0);
  });
  it("CC: cascades when the test case (child) is deleted", async () => {
    const pid = await mkProject();
    const cid = await mkCond(pid), tid = await mkCase(pid);
    await db.insert(conditionCase).values({ projectId: pid, conditionId: cid, caseId: tid, position: "a0" });
    await db.delete(testCase).where(eq(testCase.id, tid));
    expect(await db.select().from(conditionCase).where(eq(conditionCase.caseId, tid))).toHaveLength(0);
  });
  it("CC: rejects an edge linking a condition and case from different projects", async () => {
    const pA = await mkProject(), pB = await mkProject();
    const cid = await mkCond(pA), tid = await mkCase(pB);
    await expect(
      db.insert(conditionCase).values({ projectId: pA, conditionId: cid, caseId: tid, position: "a0" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests**

Run (DB up):
```bash
pnpm --filter @veritra/db exec vitest run src/schema.test.ts
```

- **If all nine new tests PASS:** FK enforcement is on by default over the web client for every edge/endpoint/direction. No client change needed. Skip to Step 4.
- **If any FAIL** (a cross-project insert succeeds / a cascade leaves edges): FK enforcement is off or a composite FK is mis-wired. If *all* cross-project/cascade tests fail uniformly, FK enforcement is globally off → Step 3. If only one edge/direction fails, the corresponding `foreignKey(...)` column order in Task 7 is wrong (realign `[t.projectId, t.Xid]` with the parent's `unique(...).on(projectId, id)`) before Step 3.

- [ ] **Step 3: (Conditional) Enable FK enforcement in `createDb`**

Only if Step 2 failed. The libSQL HTTP protocol runs statements per-request, so a one-off `PRAGMA foreign_keys=ON` does not persist. Options, in order of preference — try (a), re-run Step 2; if still failing try (b); if neither works, **stop and report to the user** (their composite-FK integrity choice cannot be enforced over `@libsql/client/web` and needs a design revisit):

(a) Set the pragma at client creation if the installed `@libsql/client` version supports a connection option (check `createClient` options for a foreign-keys / pragma hook in the resolved version). 

(b) If the dev container controls the default, document that the libSQL server must be started with foreign keys enabled, and add a startup `PRAGMA foreign_keys=ON` issued inside every write batch in the db/API layer (Plan 3). For Plan 2, at minimum make `createDb` issue `PRAGMA foreign_keys=ON` and add a comment that per-request HTTP may require batch-level pragmas; re-run Step 2.

Record the outcome (which option, or the escalation) in `.git/sdd/progress.md`.

- [ ] **Step 4: CONTROLLER VERIFY**

Run (DB up): the controller itself runs
```bash
pnpm --filter @veritra/db exec vitest run && pnpm typecheck
```
Expected: GREEN, including all nine FK tests (3 edges × {parent-cascade, child-cascade, cross-project-reject}). Do not accept the subagent's word on this gate.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(db): verify composite-FK same-project rejection + cascade enforcement"
```

---

## Task 9: Replace the spike `notes` slice with a minimal Project tRPC slice + integration-seam test (prereqs #1, #7)

**Why:** Plan 1's spike `notes` slice is wired across four files: the `notes` sub-router in `router.ts` (uses `schema.notes`), `notes-fn.ts` (a `createServerFn` that calls `appRouter.createCaller(...).notes.list()`), `routes/index.tsx` (loader calls `listNotes()` from `notes-fn.ts`), and `tests/trpc.integration.test.ts`. After Task 6 dropped the `notes` table, **all four break** — in particular `notes-fn.ts` will not compile (`caller.notes` no longer exists). Replace the slice with a **minimal** real-entity (Project) slice — `project.create` / `project.list` — so nothing references `notes`, and add a seam test that genuinely crosses the `globalThis.__env__` → `getWorkerEnv()` → Hono → tRPC → libSQL boundary (prereq #7). **Keep it minimal: no authz/roles — that is Plan 3.**

> **Ground truth (verified):** `router.ts` imports `{ schema }` from `@veritra/db` and uses `schema.notes` — so the Project slice uses `schema.project` (namespace import, matching the existing pattern). The real SSR seam is `routes/api/$.tsx` → `app.fetch(request, getWorkerEnv())` and `notes-fn.ts` → `getWorkerEnv()` + `createDb` + `createCaller`. Importing `app` from `worker.ts` (a re-export of the standalone Hono `app`) and calling `app.request(path, init, env)` with `env` passed directly — as Plan 1's `auth.integration.test.ts` does — does **not** go through `getWorkerEnv()`/`__env__`. The seam test below therefore sets `globalThis.__env__` and reads it via `getWorkerEnv()` so the `__env__` binding is actually exercised.

**Files:**
- Modify: `apps/web/src/server/router.ts`, `apps/web/src/routes/index.tsx`, `apps/web/tests/trpc.integration.test.ts`
- Rename + rewrite: `apps/web/src/server/notes-fn.ts` → `apps/web/src/server/projects-fn.ts`
- Create: `apps/web/tests/seam.integration.test.ts`

- [ ] **Step 1: Read the current wiring (all four touch points)**

```bash
cat apps/web/src/server/router.ts apps/web/src/server/notes-fn.ts apps/web/src/routes/index.tsx apps/web/tests/trpc.integration.test.ts apps/web/src/routes/api/\$.tsx apps/web/src/server/env.ts
```
Note: `router.ts` uses `schema.notes` via the `{ schema }` namespace import; `notes-fn.ts` exports `listNotes = createServerFn().handler(...)` calling `caller.notes.list()` with `getWorkerEnv()` + `createDb`; `index.tsx` imports `listNotes` and renders `notes`; `api/$.tsx` is the real seam (`app.fetch(request, getWorkerEnv())`).

- [ ] **Step 2: Rewrite the integration test (notes → project)**

`apps/web/tests/trpc.integration.test.ts` — replace the `notes` cases, keep `ping`:
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

describe("appRouter.project", () => {
  it("creates a project and lists it back", async () => {
    const title = `P-${crypto.randomUUID()}`;
    const { id } = await caller().project.create({ title, createdBy: "user-1" });
    const all = await caller().project.list();
    expect(all.some((p) => p.id === id && p.title === title)).toBe(true);
  });

  it("rejects an empty title (valibot)", async () => {
    await expect(caller().project.create({ title: "", createdBy: "u" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run (DB up):
```bash
pnpm --filter @veritra/web exec vitest run tests/trpc.integration.test.ts
```
Expected: FAIL — `project` router not defined.

- [ ] **Step 4: Implement the Project slice in the router**

In `apps/web/src/server/router.ts`: remove the `notes` sub-router (and its `schema.notes` usage), add a `project` sub-router, and add the `import * as v from "valibot"` if it is not already present (Plan 1's router already imports valibot as `v` for `ping` — reuse it). Keep `me`, `ping`, and the existing `{ schema }` namespace import. The router becomes:
```ts
import * as v from "valibot";
import { router, publicProcedure, protectedProcedure } from "./trpc";
import { schema } from "@veritra/db";

const PingInput = v.object({ name: v.pipe(v.string(), v.minLength(1)) });
const ProjectCreateInput = v.object({
  title: v.pipe(v.string(), v.minLength(1)),
  createdBy: v.pipe(v.string(), v.minLength(1)),
});

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({ userId: ctx.session.userId })),

  ping: publicProcedure
    .input((raw) => v.parse(PingInput, raw))
    .query(({ input }) => ({ message: `hello ${input.name}` })),

  project: router({
    create: publicProcedure
      .input((raw) => v.parse(ProjectCreateInput, raw))
      .mutation(async ({ ctx, input }) => {
        const id = `proj-${crypto.randomUUID()}`;
        const now = new Date();
        await ctx.db.insert(schema.project).values({
          id,
          title: input.title,
          createdAt: now,
          updatedAt: now,
          createdBy: input.createdBy,
        });
        return { id };
      }),
    list: publicProcedure.query(({ ctx }) => ctx.db.select().from(schema.project)),
  }),
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run the test, verify it passes**

Run (DB up):
```bash
pnpm --filter @veritra/web exec vitest run tests/trpc.integration.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 6: Rename `notes-fn.ts` → `projects-fn.ts` and point it at `project.list`**

This is required for compilation: `notes-fn.ts` calls `caller.notes.list()`, which no longer exists. Create `apps/web/src/server/projects-fn.ts` (and `git rm apps/web/src/server/notes-fn.ts`):
```ts
import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@veritra/db";
import { appRouter } from "./router";
import { getWorkerEnv } from "./env";

// SSR-safe project fetch: the index loader runs on the server during SSR and on
// the client during navigation. Wrapping the tRPC call in a server function
// keeps DB access server-only and avoids the relative-URL httpBatchLink problem
// during SSR. We call the router directly (createCaller) — project.list is a
// publicProcedure needing only ctx.db, so no auth/session plumbing here.
export const listProjects = createServerFn().handler(async () => {
  const env = getWorkerEnv();
  const db = createDb(env.LIBSQL_URL, env.LIBSQL_AUTH_TOKEN);
  const caller = appRouter.createCaller({ db, session: null });
  return caller.project.list();
});
```

- [ ] **Step 7: Update the SSR `/` route to render projects**

`apps/web/src/routes/index.tsx` — swap the import and the loader/render from notes to projects (keep the `createServerFn` SSR pattern; do not introduce a relative-URL `httpBatchLink`):
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { listProjects } from "../server/projects-fn";

export const Route = createFileRoute("/")({
  loader: async () => ({ projects: await listProjects() }),
  component: Home,
});

function Home() {
  const { projects } = Route.useLoaderData();
  return (
    <main>
      <h1>Veritra</h1>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>{p.title}</li>
        ))}
      </ul>
      <a href="/login">login</a>
    </main>
  );
}
```

- [ ] **Step 8: Write the integration-seam test (prereq #7)**

This crosses the real seam: `globalThis.__env__` → `getWorkerEnv()` → Hono (`app`) → tRPC → `createDb` → libSQL — the same composition `routes/api/$.tsx` uses (`app.fetch(request, getWorkerEnv())`). `apps/web/tests/seam.integration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import app from "../src/worker"; // standalone Hono entry (re-exports server/hono-app `app`)
import { getWorkerEnv } from "../src/server/env";

const testEnv = {
  LIBSQL_URL: process.env.LIBSQL_URL ?? "http://127.0.0.1:8080",
  AUTH_SECRET: "test-secret-please-change",
  BASE_URL: "http://localhost",
};

describe("integration seam: __env__ → getWorkerEnv → Hono → tRPC → libSQL", () => {
  it("reads worker env from globalThis.__env__ and round-trips a project through the mounted Hono app", () => {
    // The Start server route (routes/api/$.tsx) does app.fetch(request, getWorkerEnv()).
    // getWorkerEnv() reads globalThis.__env__ (the Nitro cloudflare_module binding).
    // Set it, prove it resolves, then drive the exact same composition.
    (globalThis as { __env__?: typeof testEnv }).__env__ = testEnv;
    const env = getWorkerEnv(); // throws if the __env__ binding seam is broken
    expect(env.LIBSQL_URL).toBe(testEnv.LIBSQL_URL);

    return (async () => {
      const title = `Seam-${crypto.randomUUID()}`;
      const create = await app.fetch(
        new Request("http://localhost/api/trpc/project.create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, createdBy: "seam-user" }),
        }),
        env,
      );
      expect(create.ok).toBe(true);

      const list = await app.fetch(new Request("http://localhost/api/trpc/project.list"), env);
      expect(list.ok).toBe(true);
      expect(await list.text()).toContain(title);
    })();
  });
});
```

> **tRPC HTTP shape:** a single (non-batched) mutation is `POST /api/trpc/project.create` with the raw input JSON as the body (matches the Plan 1 `notes.add` curl in the foundation plan); a no-input query is `GET /api/trpc/project.list`. If the resolved `@hono/trpc-server` expects batching, align with how Plan 1's `hono-app.ts` mounts it (`endpoint: "/api/trpc"`) and the foundation plan's `ping` curl. The full Nitro HTTP → Start-route dispatch + SSR rendering of `index.tsx` is **not** unit-testable here; it stays covered by Plan 1's `wrangler dev` acceptance (run `pnpm dev` and `curl` `/` if you want to re-confirm), while this test covers `__env__` + Hono + tRPC + db deterministically in-process.

- [ ] **Step 9: Run the seam test, verify it passes**

Run (DB up):
```bash
pnpm --filter @veritra/web exec vitest run tests/seam.integration.test.ts
```
Expected: PASS.

- [ ] **Step 10: CONTROLLER VERIFY — full suite + build + typecheck**

The controller runs (DB up):
```bash
pnpm build && pnpm typecheck && pnpm test:run
```
Expected: all green; no reference to `notes` remains (`grep -rn "notes" apps/web/src packages/db/src` returns nothing meaningful — `notes-fn.ts` is renamed to `projects-fn.ts`).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): replace spike notes slice with minimal project tRPC slice; add SSR integration-seam test"
```

---

## Task 10: Coverage — types + local gap rules (`packages/core/src/coverage.ts`)

**Why:** The deterministic coverage core (spec §4). This task lands the input/output types and the three local child-count gap rules (`uncovered-requirement`, `uncovered-viewpoint`, `uncovered-condition`). Pure functions over an in-memory, already-active-filtered graph; core additionally drops edges whose endpoints are not in the active node sets.

**Files:**
- Create: `packages/core/src/coverage.ts`, `packages/core/src/coverage.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test (local gap rules)**

`packages/core/src/coverage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeCoverage, type CoverageInput } from "./coverage";

const node = (id: string, createdAt: number) => ({ id, projectId: "P", createdAt });
const edge = (parentId: string, childId: string) => ({ parentId, childId, position: "a0" });

function emptyInput(): CoverageInput {
  return {
    projectId: "P",
    requirements: [],
    viewpoints: [],
    conditions: [],
    testCases: [],
    requirementViewpoint: [],
    viewpointCondition: [],
    conditionCase: [],
  };
}

describe("computeCoverage — local gap rules", () => {
  it("flags a requirement with zero viewpoint edges", () => {
    const input = { ...emptyInput(), requirements: [node("r1", 1)] };
    const { gaps } = computeCoverage(input);
    expect(gaps).toContainEqual({
      id: "requirement:r1:uncovered-requirement",
      type: "requirement",
      entityId: "r1",
      rule: "uncovered-requirement",
    });
  });

  it("does not flag a requirement that has a viewpoint edge", () => {
    const input = {
      ...emptyInput(),
      requirements: [node("r1", 1)],
      viewpoints: [node("v1", 2)],
      requirementViewpoint: [edge("r1", "v1")],
    };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.rule === "uncovered-requirement")).toBe(false);
  });

  it("flags a viewpoint with zero condition edges", () => {
    const input = {
      ...emptyInput(),
      requirements: [node("r1", 1)],
      viewpoints: [node("v1", 2)],
      requirementViewpoint: [edge("r1", "v1")],
    };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.id === "viewpoint:v1:uncovered-viewpoint")).toBe(true);
  });

  it("flags a condition with zero case edges (core gap)", () => {
    const input = {
      ...emptyInput(),
      viewpoints: [node("v1", 2)],
      conditions: [node("c1", 3)],
      viewpointCondition: [edge("v1", "c1")],
    };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.id === "condition:c1:uncovered-condition")).toBe(true);
  });

  it("ignores an edge that points to a node absent from the active set", () => {
    // condition c1 has an edge to case x1, but x1 is not in testCases (archived/filtered out)
    const input = {
      ...emptyInput(),
      conditions: [node("c1", 3)],
      conditionCase: [edge("c1", "x1")],
    };
    const { gaps } = computeCoverage(input);
    // c1 still counts as uncovered-condition because the edge's child is not active
    expect(gaps.some((g) => g.id === "condition:c1:uncovered-condition")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @veritra/core exec vitest run src/coverage.test.ts`
Expected: FAIL — cannot find `./coverage`.

- [ ] **Step 3: Implement `coverage.ts` (types + local rules)**

`packages/core/src/coverage.ts`:
```ts
export type EntityType = "requirement" | "viewpoint" | "condition" | "testCase";

export interface CoverageNode {
  id: string;
  projectId: string;
  createdAt: number; // epoch ms, for stable sort
}

export interface CoverageEdge {
  parentId: string;
  childId: string;
  position: string;
}

export interface CoverageInput {
  projectId: string;
  requirements: CoverageNode[];
  viewpoints: CoverageNode[];
  conditions: CoverageNode[];
  testCases: CoverageNode[];
  requirementViewpoint: CoverageEdge[]; // parent=requirement, child=viewpoint
  viewpointCondition: CoverageEdge[]; //   parent=viewpoint,   child=condition
  conditionCase: CoverageEdge[]; //        parent=condition,   child=testCase
}

export type GapRule =
  | "uncovered-requirement"
  | "uncovered-viewpoint"
  | "uncovered-condition"
  | "orphan";

export interface Gap {
  id: string; // `${type}:${entityId}:${rule}`
  type: EntityType;
  entityId: string;
  rule: GapRule;
}

export interface ReachCount {
  requirementId: string;
  reachableCaseCount: number; // COUNT(DISTINCT case_id) over requirement→viewpoint→condition→case
}

export interface CoverageResult {
  gaps: Gap[];
  reachCounts: ReachCount[];
}

function idSet(nodes: readonly CoverageNode[]): Set<string> {
  return new Set(nodes.map((n) => n.id));
}

/** Keep only edges whose parent and child are both present in the given active id sets. */
function liveEdges(
  edges: readonly CoverageEdge[],
  parents: Set<string>,
  children: Set<string>,
): CoverageEdge[] {
  return edges.filter((e) => parents.has(e.parentId) && children.has(e.childId));
}

function gap(type: EntityType, entityId: string, rule: GapRule): Gap {
  return { id: `${type}:${entityId}:${rule}`, type, entityId, rule };
}

export function computeCoverage(input: CoverageInput): CoverageResult {
  const reqIds = idSet(input.requirements);
  const vpIds = idSet(input.viewpoints);
  const condIds = idSet(input.conditions);
  const caseIds = idSet(input.testCases);

  const rv = liveEdges(input.requirementViewpoint, reqIds, vpIds);
  const vc = liveEdges(input.viewpointCondition, vpIds, condIds);
  const cc = liveEdges(input.conditionCase, condIds, caseIds);

  const parentsWithChild = (edges: readonly CoverageEdge[]) => new Set(edges.map((e) => e.parentId));
  const reqHasVp = parentsWithChild(rv);
  const vpHasCond = parentsWithChild(vc);
  const condHasCase = parentsWithChild(cc);

  const gaps: Gap[] = [];

  // local child-count gap rules (spec §4.2)
  for (const r of input.requirements) {
    if (!reqHasVp.has(r.id)) gaps.push(gap("requirement", r.id, "uncovered-requirement"));
  }
  for (const v of input.viewpoints) {
    if (!vpHasCond.has(v.id)) gaps.push(gap("viewpoint", v.id, "uncovered-viewpoint"));
  }
  for (const c of input.conditions) {
    if (!condHasCase.has(c.id)) gaps.push(gap("condition", c.id, "uncovered-condition"));
  }

  // orphan + reach-count are added in Tasks 11 and 12.
  return { gaps, reachCounts: [] };
}
```

- [ ] **Step 4: Run the test + typecheck, verify green**

Run:
```bash
pnpm --filter @veritra/core exec vitest run src/coverage.test.ts && pnpm typecheck
```
Expected: PASS, `tsc` clean.

- [ ] **Step 5: Export + commit**

Append to `packages/core/src/index.ts`:
```ts
export * from "./coverage";
```

```bash
git add -A
git commit -m "feat(core): coverage types + local gap rules (uncovered requirement/viewpoint/condition)"
```

---

## Task 11: Coverage — orphan rule

**Why:** Spec §4.1/§4.2: a Viewpoint/Condition/TestCase with **no parent edge** is an orphan. Requirement is the root and is never an orphan.

**Files:**
- Modify: `packages/core/src/coverage.ts`, `packages/core/src/coverage.test.ts`

- [ ] **Step 1: Add the failing orphan tests**

Append to `packages/core/src/coverage.test.ts`:
```ts
describe("computeCoverage — orphan rule", () => {
  it("flags a viewpoint with no parent requirement edge", () => {
    const input = { ...emptyInput(), viewpoints: [node("v1", 2)] };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.id === "viewpoint:v1:orphan")).toBe(true);
  });

  it("flags a condition and a test case with no parent edge", () => {
    const input = {
      ...emptyInput(),
      conditions: [node("c1", 3)],
      testCases: [node("t1", 4)],
    };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.id === "condition:c1:orphan")).toBe(true);
    expect(gaps.some((g) => g.id === "testCase:t1:orphan")).toBe(true);
  });

  it("never flags a requirement as orphan (root)", () => {
    const input = { ...emptyInput(), requirements: [node("r1", 1)] };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.rule === "orphan" && g.type === "requirement")).toBe(false);
  });

  it("does not flag a placed viewpoint as orphan", () => {
    const input = {
      ...emptyInput(),
      requirements: [node("r1", 1)],
      viewpoints: [node("v1", 2)],
      requirementViewpoint: [edge("r1", "v1")],
    };
    const { gaps } = computeCoverage(input);
    expect(gaps.some((g) => g.id === "viewpoint:v1:orphan")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify the orphan tests fail**

Run: `pnpm --filter @veritra/core exec vitest run src/coverage.test.ts`
Expected: FAIL on the new orphan assertions (no orphan gaps produced yet).

- [ ] **Step 3: Add orphan detection to `computeCoverage`**

In `packages/core/src/coverage.ts`, after the local-rule loops and before `return`, add (reusing the already-computed live edges `rv`, `vc`, `cc`):
```ts
  // orphan rule: child types with no parent edge (Requirement is root → excluded)
  const placedViewpoints = new Set(rv.map((e) => e.childId));
  const placedConditions = new Set(vc.map((e) => e.childId));
  const placedCases = new Set(cc.map((e) => e.childId));

  for (const v of input.viewpoints) {
    if (!placedViewpoints.has(v.id)) gaps.push(gap("viewpoint", v.id, "orphan"));
  }
  for (const c of input.conditions) {
    if (!placedConditions.has(c.id)) gaps.push(gap("condition", c.id, "orphan"));
  }
  for (const t of input.testCases) {
    if (!placedCases.has(t.id)) gaps.push(gap("testCase", t.id, "orphan"));
  }
```

- [ ] **Step 4: Run, verify green**

Run:
```bash
pnpm --filter @veritra/core exec vitest run src/coverage.test.ts && pnpm typecheck
```
Expected: PASS (local + orphan). Note: an unplaced viewpoint with no condition child legitimately yields **two** gaps (`uncovered-viewpoint` and `orphan`) — distinct gap IDs, both correct.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): coverage orphan rule for viewpoint/condition/test-case"
```

---

## Task 12: Coverage — reach-count, stable sort, final assembly

**Why:** Spec §4.1/§4.2: per-requirement `COUNT(DISTINCT case_id)` reachable via `requirement→viewpoint→condition→case` (multi-path deduped), and the deterministic output order — gaps stably sorted by `(type, created_at, id)`.

**Files:**
- Modify: `packages/core/src/coverage.ts`, `packages/core/src/coverage.test.ts`

- [ ] **Step 1: Add the failing reach-count + ordering tests**

Append to `packages/core/src/coverage.test.ts`:
```ts
describe("computeCoverage — reach count (distinct cases)", () => {
  it("counts distinct reachable cases per requirement, deduping multi-path", () => {
    // r1 → v1 → c1 → t1 ; r1 → v1 → c2 → t1 (same case via two conditions) ⇒ distinct = 1
    const input: CoverageInput = {
      ...emptyInput(),
      requirements: [node("r1", 1)],
      viewpoints: [node("v1", 2)],
      conditions: [node("c1", 3), node("c2", 4)],
      testCases: [node("t1", 5)],
      requirementViewpoint: [edge("r1", "v1")],
      viewpointCondition: [edge("v1", "c1"), edge("v1", "c2")],
      conditionCase: [edge("c1", "t1"), edge("c2", "t1")],
    };
    const { reachCounts } = computeCoverage(input);
    expect(reachCounts).toContainEqual({ requirementId: "r1", reachableCaseCount: 1 });
  });

  it("reports zero reachable cases for a requirement with no full path", () => {
    const input = { ...emptyInput(), requirements: [node("r1", 1)] };
    const { reachCounts } = computeCoverage(input);
    expect(reachCounts).toContainEqual({ requirementId: "r1", reachableCaseCount: 0 });
  });
});

describe("computeCoverage — deterministic ordering", () => {
  it("sorts gaps by (type, createdAt, id)", () => {
    const input = {
      ...emptyInput(),
      // intentionally out of order; all are orphans/uncovered
      testCases: [node("t1", 10)],
      conditions: [node("c1", 5)],
      viewpoints: [node("v2", 3), node("v1", 3)], // same createdAt → tie-break by id
      requirements: [node("r1", 1)],
    };
    const { gaps } = computeCoverage(input);
    const order = gaps.map((g) => g.id);
    // requirement gaps first, then viewpoint (v1 before v2 at equal createdAt), then condition, then testCase
    expect(order.indexOf("requirement:r1:uncovered-requirement")).toBeLessThan(
      order.indexOf("viewpoint:v1:uncovered-viewpoint"),
    );
    expect(order.indexOf("viewpoint:v1:uncovered-viewpoint")).toBeLessThan(
      order.indexOf("viewpoint:v2:uncovered-viewpoint"),
    );
    expect(order.indexOf("viewpoint:v2:orphan")).toBeLessThan(
      order.indexOf("condition:c1:uncovered-condition"),
    );
    expect(order.indexOf("condition:c1:orphan")).toBeLessThan(
      order.indexOf("testCase:t1:orphan"),
    );
  });

  it("uses each entity's own createdAt even when an id collides across entity types", () => {
    // A requirement and a condition share the id "dup". If createdAt were keyed by
    // id alone, the condition's createdAt (1) would overwrite the requirement's (5),
    // wrongly ordering "dup" before "zzz" among the requirement gaps.
    const input = {
      ...emptyInput(),
      requirements: [node("dup", 5), node("zzz", 4)],
      conditions: [node("dup", 1)],
    };
    const { gaps } = computeCoverage(input);
    const order = gaps.map((g) => g.id);
    expect(order.indexOf("requirement:zzz:uncovered-requirement")).toBeLessThan(
      order.indexOf("requirement:dup:uncovered-requirement"),
    );
  });
});
```

- [ ] **Step 2: Run, verify the new tests fail**

Run: `pnpm --filter @veritra/core exec vitest run src/coverage.test.ts`
Expected: FAIL — `reachCounts` empty; gap order not guaranteed.

- [ ] **Step 3: Implement reach-count + stable sort**

In `packages/core/src/coverage.ts`:

(a) Add reach-count computation before `return`, reusing `rv`/`vc`/`cc`:
```ts
  // reach-count: distinct cases reachable per requirement via rv→vc→cc
  const vpToConds = new Map<string, string[]>();
  for (const e of vc) (vpToConds.get(e.parentId) ?? vpToConds.set(e.parentId, []).get(e.parentId)!).push(e.childId);
  const condToCases = new Map<string, string[]>();
  for (const e of cc) (condToCases.get(e.parentId) ?? condToCases.set(e.parentId, []).get(e.parentId)!).push(e.childId);
  const reqToVps = new Map<string, string[]>();
  for (const e of rv) (reqToVps.get(e.parentId) ?? reqToVps.set(e.parentId, []).get(e.parentId)!).push(e.childId);

  const reachCounts: ReachCount[] = input.requirements.map((r) => {
    const cases = new Set<string>();
    for (const vpId of reqToVps.get(r.id) ?? []) {
      for (const condId of vpToConds.get(vpId) ?? []) {
        for (const caseId of condToCases.get(condId) ?? []) cases.add(caseId);
      }
    }
    return { requirementId: r.id, reachableCaseCount: cases.size };
  });
```

(b) Build a `createdAt` lookup **keyed by `${type}:${id}`** and stable-sort the gaps before returning. Keying by id alone is a bug: ids are per-table primary keys, not globally unique, so a Requirement and a Condition sharing an id would overwrite each other's timestamp and corrupt the same-type `createdAt` comparison. Key by type+id:
```ts
  const typeOrder: Record<EntityType, number> = {
    requirement: 0,
    viewpoint: 1,
    condition: 2,
    testCase: 3,
  };
  const createdAtByKey = new Map<string, number>();
  const remember = (type: EntityType, nodes: readonly CoverageNode[]) => {
    for (const n of nodes) createdAtByKey.set(`${type}:${n.id}`, n.createdAt);
  };
  remember("requirement", input.requirements);
  remember("viewpoint", input.viewpoints);
  remember("condition", input.conditions);
  remember("testCase", input.testCases);

  gaps.sort((a, b) => {
    if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
    const ca = createdAtByKey.get(`${a.type}:${a.entityId}`) ?? 0;
    const cb = createdAtByKey.get(`${b.type}:${b.entityId}`) ?? 0;
    if (ca !== cb) return ca - cb;
    if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
    return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0; // stable tie-break within same entity
  });
```

(c) Change the return to `return { gaps, reachCounts };`.

> The `(map.get(k) ?? map.set(k, []).get(k)!)` idiom both initializes and returns the array; if the subagent finds it hard to read, replace with a plain `if (!map.has(k)) map.set(k, []); map.get(k)!.push(...)` — behavior must be identical.

- [ ] **Step 4: Run the full coverage suite + typecheck**

Run:
```bash
pnpm --filter @veritra/core exec vitest run src/coverage.test.ts && pnpm typecheck
```
Expected: PASS (local + orphan + reach-count + ordering).

- [ ] **Step 5: CONTROLLER VERIFY — whole repo green**

The controller runs (DB up):
```bash
pnpm lint && pnpm build && pnpm typecheck && pnpm test:run
```
Expected: all green across `packages/core`, `packages/db`, `apps/web`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): coverage reach-count (distinct cases) + deterministic (type,createdAt,id) ordering"
```

---

## Self-Review (against spec §3 and §4)

- **§3.1 entities** (Project/Requirement/Viewpoint/Condition/TestCase/User+Membership; `project_id`, `created_at/updated_at/created_by`, `archived_at`; TestCase `provenance`; Viewpoint `memo`; Requirement `source`): Tasks 6 (+ existing `user`). ✓ `created_by` is plain text by design decision #6. ✓
- **§3.2 links** (3 join tables, `project_id`, `position` fractional, `(親,子)` UNIQUE via composite PK, `derivation` on `condition_case`, same-project enforced): Tasks 4 (position), 7 (edges + composite FK), 8 (enforcement verified across **all 3 edges × both endpoint cascades × cross-project rejection with two real projects** — the hard gate is not narrowed to one FK). ✓
- **§3.3 invariants** (id independent of placement; child under multiple parents; derivation on edge; TestCase separate from Run/Result): schema places order/derivation on edges (Task 7); `childPlacementCount` expresses multi-parent sharing (Task 5); no Run/Result fields on TestCase. ✓
- **§3.4 delete/integrity** (edge FK CASCADE; no direct entity-entity FK; project_id cascade; created_by retained; last-admin not in schema): Tasks 6–8; decisions #6, #7. ✓ ("remove-from-here vs delete" pure semantics = `removePlacement` + `childPlacementCount`, Task 5; archive/physical-delete API is Plan 3.)
- **§4.1 contract** (active-only target set; `COUNT(DISTINCT case_id)`; covered definition; orphan target types incl. Requirement excluded; stable `(type,created_at,id)` sort; deterministic `type:entity_id:rule` gap IDs): Tasks 10–12. ✓ (Active-filter is the caller's job per decision #2; core defensively drops dangling edges — Task 10 test.)
- **§4.2 rules** (uncovered requirement/viewpoint/condition, orphan, reach-count): Tasks 10–12. ✓ (Gap ordering keys `createdAt` by `${type}:${id}` to survive cross-type id collisions — Task 12 regression test.)
- **valibot validation scope:** Task 3 *defines + unit-tests* the JSON/enum validators; **runtime row parsing at the read/write boundary is deferred to Plan 3** (decision #5). Plan 2 deliberately does not claim runtime enforcement — `$type<>()` is compile-time only.
- **Prereqs / Plan-1 backlog**: #1 spike residue (core: Task 3; db notes: Task 6; notes slice: Task 9) ✓ · #2 typecheck-all (Task 2) ✓ · #3 drop node types (Task 2) ✓ · #4 core tsconfig (Task 2) ✓ · #5 drizzle-orm version + CI build (Tasks 1, 2) ✓ · #6 FK CASCADE/PRAGMA (Task 8) ✓ · #7 integration-seam test (Task 9) ✓
- **Out of scope (correctly deferred):** tRPC CRUD/authz/roles/invites/last-admin enforcement → Plan 3; tree + case-table UI + coverage view + Storybook + E2E → Plan 4. The Task 9 Project slice is deliberately minimal (no authz) and exists only to remove `notes` and cover the seam.

## Type-consistency check

- Core public names are stable across tasks: `positionBetween`/`appendPosition`/`sortByPosition` (Task 4), `addPlacement`/`removePlacement`/`reorderPlacement`/`childPlacementCount`/`assertSameProject`/`PlacementEdge` (Task 5), `computeCoverage`/`CoverageInput`/`CoverageNode`/`CoverageEdge`/`Gap`/`GapRule`/`ReachCount`/`CoverageResult`/`EntityType` (Tasks 10–12). db value types `Role`/`Priority`/`Provenance`/`Step`/`Derivation` (Task 3) are the exact names imported in `schema.ts` (Tasks 6–7).
- `CoverageNode.createdAt` is epoch-ms `number` in core; db stores `timestamp_ms` — the db/API mapping layer (Plan 3) converts `Date → number` when building `CoverageInput`. Noted so Plan 3 does not pass `Date` objects into core.
```
