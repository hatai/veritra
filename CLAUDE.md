# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Veritra（verify + trace）は社内向けの**テスト設計 web アプリ**。要件 → 観点 → 条件 → テストケースを多対多リンク（実体は DAG）で繋ぎ、**トレーサビリティとカバレッジ（未カバー）の可視化**を中核価値とする。MVP は「テスト分析・テスト設計」に集中。設計の詳細は `docs/superpowers/specs/2026-06-20-veritra-design.md` を参照。

現状はまだ基盤＋統合スパイク段階（Plan 1 完了）。`notes` テーブルや `ping` プロシージャは配線確認用のサンプルで、ドメインモデル（Requirement/Viewpoint/Condition/TestCase）は未実装。

## コマンド

```sh
pnpm install            # 依存インストール
pnpm db:up              # libSQL を Docker で起動（test/migrate の前提）
pnpm db:migrate         # drizzle-kit push でスキーマ反映（要 LIBSQL_URL）
pnpm dev                # build → wrangler dev（http://localhost:8787）
pnpm build              # SSR ビルド（@veritra/web → apps/web/.output/）
pnpm lint               # vp lint
pnpm format             # vp format
pnpm typecheck          # tsc -p apps/web/tsconfig.json

# テスト（libSQL が http://127.0.0.1:8080 で起動している必要あり）
LIBSQL_URL=http://127.0.0.1:8080 pnpm test:run   # 全テスト一括
pnpm test                                         # watch モード
# 単一テスト: vp test run apps/web/tests/trpc.integration.test.ts
```

テストは libSQL に実接続する統合テスト。`pnpm db:up && pnpm db:migrate` を済ませてから実行すること。

## アーキテクチャ

pnpm モノレポ（`apps/*` + `packages/*`）。**単一の Cloudflare Worker** が SSR と API を両方提供する。

- **`apps/web`** — TanStack Start（React 19, SSR）+ Hono（API）。本番エントリ。
- **`packages/db`** — Drizzle ORM + libSQL スキーマ／クライアント（`@veritra/db`）。
- **`packages/core`** — 共有ロジック（`@veritra/core`、現状ほぼ空）。

### スタック統合 = Approach B（最重要）

TanStack Start + Nitro（`cloudflare_module` preset）が **Worker エントリを所有**し、Hono アプリ（tRPC・better-auth・`/healthz`）はその下に **Start サーバールートとしてマウント**される。

- API のマウント点: `apps/web/src/routes/api/$.tsx`（`/api/*` catch-all）と `routes/healthz.tsx`。どちらも `app.fetch(request, getWorkerEnv())` で Hono に委譲。
- ページルート（`/`, `/login`）は `server.handlers` を持たないため SSR にフォールスルーする。
- Approach A（生の esbuild Worker に Start の SSR ハンドラを import）は**実現不可**と確認済み（Start の build-time 仮想モジュールが解決できないため）。詳細・経緯は README「Stack integration outcome」に記録。
- `apps/web/src/worker.ts` は Hono アプリを再エクスポートするだけの standalone エントリ。**本番エントリではない**。ルートの `wrangler.toml` の `main` も standalone 用。

### 落とし穴（変更時に必ず守る）

- **CF env は `globalThis.__env__` 経由**。Nitro `cloudflare_module` preset が毎リクエストで設定する**非公開内部**（`apps/web/src/server/env.ts` の `getWorkerEnv()`）。**nitro アップグレードのたびに preset ソースで再検証すること**。Hono を `app.fetch(request)` だけで呼ぶと `c.env` が空になるため、必ず `app.fetch(request, getWorkerEnv())` で env を明示的に渡す。
- **SSR での tRPC 呼び出し**は `httpBatchLink`（相対 URL ＝ サーバー側で origin が無い）を使わず、`createServerFn` + `appRouter.createCaller()` を使う（`apps/web/src/server/notes-fn.ts` 参照）。`httpBatchLink` クライアント（`src/lib/trpc-client.ts`）はブラウザ専用アクション用。
- **libSQL の import は必ず `@libsql/client/web`** から。`@libsql/client` や `/node` サブパスは Workers 非互換で、lint（`no-restricted-imports`）が弾く。
- **vite.config.ts が 2 つある**。ルートの `vite.config.ts` は Vite+（`vp`）の **test/lint 専用**設定。`apps/web/vite.config.ts` は plain `vite build` による **SSR ビルド**設定。役割が別なので混同しない。
- **`pnpm dev` はビルドしてから `wrangler dev -c apps/web/.output/server/wrangler.json`** を起動する（`.dev.vars` を出力ディレクトリにコピーして wrangler に `AUTH_SECRET`/`BASE_URL` を読ませる）。bare `wrangler dev` では SSR が動かない。

### tRPC コンテキスト・認証

- tRPC のコンテキストは `{ db, session }`（`apps/web/src/server/trpc.ts`）。`protectedProcedure` は session 必須、`publicProcedure` は不要。
- 認証は better-auth（email/password、drizzle adapter）。スキーマの `user`/`session`/`account`/`verification` は better-auth のコアテーブル。

## ツールチェーンの注意

- **Vite+**（`vite-plus@0.2.1`）: CLI バイナリは **`vp`**。ルートの `test`/`test:run`/`lint`/`format` はすべて `vp` を呼ぶ。
- **TypeScript 7.0.1-rc**: `pnpm-workspace.yaml` の `overrides` + `peerDependencyRules` で全ワークスペースに強制。Vite+ は peer で `^5||^6` を要求するが override で 7 を通している（README の「6.0.3」記述は古い）。
- **vitest 4.1.9**: Vite+ にバンドルされているが、ルート devDependency としても固定（`tsconfig.base.json` の `types: ["vitest/globals"]` 解決のため）。
- **pnpm 10.32.1** / **Node ≥ 22**。

## Agent skills

### Issue tracker

GitHub Issues（`gh` CLI 使用）。外部 PR はトリアージ対象外。詳細は `docs/agents/issue-tracker.md`。

### Triage labels

canonical 5ロール（`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`）をそのまま使用。詳細は `docs/agents/triage-labels.md`。

### Domain docs

Single-context レイアウト（ルートの `CONTEXT.md` + `docs/adr/`）。詳細は `docs/agents/domain.md`。
