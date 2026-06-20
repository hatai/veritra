Veritra（テスト分析・設計を核とするテスト管理 web アプリ）の **Plan 2（データモデル＋ドメインコア）** を、計画作成から実装まで行ってほしい。作業ディレクトリは `/home/hatai/repos/hatai/veritra`（git リポジトリ、`main` ブランチ）。

## まず読むべきもの（この順で）
1. 設計仕様: `docs/superpowers/specs/2026-06-20-veritra-design.md`（特に §3 データモデル・§4 カバレッジ・ルール・§5 スタック）
2. Plan 1（完了済み・基盤スパイク）: `docs/superpowers/plans/2026-06-20-veritra-foundation-spike.md`
3. 進捗 ledger（Plan 1 の経緯・Minor バックログ・Plan 2 前提）: `.git/sdd/progress.md`
4. 既存コード: `packages/db/src/schema.ts`, `packages/core/src/`, `apps/web/src/server/`

## プロジェクトの目的（北極星）
AI エージェント開発で実装が高速化した結果テストが追いつかない → テスト分析・設計〜実施を「速く・確実に」回す。"確実に" の担保がトレーサビリティ＋カバレッジ（未カバー）可視化。MVP は「テスト分析・設計のみ」（実行/結果記録・バグ連携・AI 支援は将来）。

## 確定済みスタック（Plan 1 で実証。再調査不要）
- Node 24 / pnpm 10.32.1。**Vite+ 0.2.1（CLI は `vp`）**、vite 8.0.16、vitest 4.1.9。
- **TypeScript 7.0.1-rc**（`pnpm-workspace.yaml` の `overrides` + `peerDependencyRules` で Vite+ の peer `^5||^6` を上書きして TS7 を強制している。維持すること）。
- TanStack Start 1.168.26 / react-router 1.170.16 / react 19.2.7 / **nitro-nightly 3.0.1-20260619-111502-ca57c6e5（exact-pin。動かさない）**。
- Hono 4.12.26 / @hono/trpc-server 0.3.4 / @trpc/server 11.18.0 / **valibot 1.4.1（検証は valibot。zod 禁止）**。
- Drizzle: drizzle-orm 0.38.4 / drizzle-kit 0.30.6（dialect `turso`）/ @libsql/client 0.14.0。**libSQL クライアントは `@libsql/client/web` のみ（素の `@libsql/client` import は lint で禁止済み）**。
- better-auth 1.6.19（cookie セッション、auth テーブル 4 つは `packages/db/src/schema.ts` に存在）。
- **アーキテクチャ = Approach B**: TanStack Start + Nitro が Worker エントリを所有し、Hono（tRPC `/api/trpc/*` + auth `/api/auth/*` + `/healthz`）を Start の server route `apps/web/src/routes/api/$.tsx` 配下にマウント。SSR からの tRPC 呼び出しは `createServerFn` + `appRouter.createCaller`（相対 URL httpBatchLink は SSR で不可）。CF env は `globalThis.__env__`（`apps/web/src/server/env.ts` の `getWorkerEnv`、Nitro cloudflare_module の内部仕様。nitro 更新時は要再検証）。
- スクリプト: `pnpm test:run`（vp test run）/ `pnpm lint`（vp lint）/ `pnpm typecheck`（現状 `tsc -p apps/web/tsconfig.json` のみ — Plan 2 で全パッケージへ拡張）/ `pnpm build`（Start+Nitro SSR ビルド）/ `pnpm dev`（build → wrangler dev）/ `pnpm db:migrate`（drizzle-kit push）。

## 環境の重要な注意点（必読）
- **`pnpm db:up`（docker）は WSL の docker socket 切断で動かない。** libSQL コンテナは Windows 側（PowerShell）で起動し、`http://127.0.0.1:8080` に接続して使う。作業開始時に `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/health` で 200 を確認すること。落ちていたらユーザーに「Windows 側でコンテナ起動」を依頼する（自分では起動不可）。
- テスト（packages/db, apps/web）は libSQL 稼働が前提。`LIBSQL_URL=http://127.0.0.1:8080`。

## Plan 2 のスコープ（仕様 §3・§4）
### A. Drizzle スキーマ（型付きエンティティ＋多対多）— `packages/db`
- エンティティ: `Project`, `Requirement`, `Viewpoint`, `Condition`, `TestCase`, `User`(既存), `Membership`。
  全エンティティに `project_id`（テナント境界）, `created_at`/`updated_at`/`created_by`, `archived_at`(nullable ソフトアーカイブ)。
  - `Requirement`: title, description, source(URL/参照ID)
  - `Viewpoint`: title, memo
  - `Condition`: title, description
  - `TestCase`: title, precondition, steps(**順序付きリスト**。当面は文字列要素、将来 step 単位の結果記録のため構造拡張可), expected, priority, **provenance**(nullable: human/ai・モデル・承認状態。MVP は human 記録のみ)
  - `Membership`: `(project_id, user_id)` UNIQUE, role(admin/member)（ロール"enforcement"は Plan 3。スキーマ定義はここ）
- 多対多リンク（独立 join テーブル。`project_id` を含み、並び順は edge の **`position`（fractional index 文字列、O(1)挿入）**）:
  - `requirement_viewpoint(project_id, requirement_id, viewpoint_id, position)`
  - `viewpoint_condition(project_id, viewpoint_id, condition_id, position)`
  - `condition_case(project_id, condition_id, case_id, position, **derivation**)` ← derivation(導出根拠: 境界値/同値クラス/リスク… enum+メモ)は **edge** に置く（ケース共有時の衝突回避）
  - 各 edge は `(親_id, 子_id)` 複合 UNIQUE。親子が同一 project であることを制約 or 書込み時検証で保証。
- 不変条件（§3.3）: ①識別子は配置から独立（移動・並べ替えで TestCase の id/履歴不変。配置は edge、順序は edge の position）②1 子が複数親に属せる（真の多対多 placement、タグでない）③derivation は edge ④TestCase 定義は将来の Run/Result と分離（実行情報を混ぜない）。
- 削除・整合（§3.4）: 「ここから外す（edge 削除）」と「削除（既定はソフトアーカイブ archived_at、物理削除は admin）」を分離。edge の FK は親子削除時 CASCADE。エンティティ間に直接 FK は張らず placement 経由。Project 削除=配下一括 archive。User 削除=Membership 除去・created_by 保持。最後の admin 降格/削除不可（enforcement は Plan 3 でも、スキーマ/型で表現可能なら）。

### B. ドメインコア（カバレッジ・placement 操作）— `packages/core`（純粋関数・TDD）
仕様 §4 の入出力契約を厳密に実装し、Vitest で TDD。
- 対象集合: 指定 project_id かつ `archived_at IS NULL`（active）のみ。
- distinct: 到達ケース数は `COUNT(DISTINCT case_id)`（多経路でも重複なし）。
- covered: あるノードが active な TestCase に placement 経由で 1 つ以上到達できる。
- orphan 対象型: 親を持つべき Viewpoint/Condition/TestCase でどの親 edge も持たないもの（**Requirement は根なので対象外**）。
- 出力: 安定ソート `(type, created_at, id)`、各ギャップに決定論的 gap ID `type:entity_id:rule`。
- ルール: 観点ゼロの要件 / 条件ゼロの観点 / ケースゼロの条件（中核）/ orphan / （補助）要件単位の到達ケース数。
- placement 操作（純粋）: edge の追加/削除/並べ替え、共有ノードの「ここから外す vs 削除」のセマンティクス。

> 注: tRPC API・認可・ロール enforcement は **Plan 3**、ツリー＋ケース表 UI とカバレッジ表示は **Plan 4**。Plan 2 は「スキーマ＋純粋ドメインロジック」に集中。

## Plan 2 の冒頭で必ず片付ける前提タスク（Plan 1 最終レビューで defer 判定された項目）
1. **スパイク残骸の除去**: `packages/db` の `notes` テーブルと `packages/core` の `add()`/`health.ts`（throwaway）を実エンティティ/ロジックへ置換。
2. **CI 強化**（`.github/workflows/ci.yml`）: `pnpm build`（Nitro SSR ビルド）と `tsc --noEmit`（typecheck）を追加。typecheck を全パッケージへ拡張。CI は `pnpm install --frozen-lockfile` + libSQL サービス + readiness 待ち + `pnpm db:migrate` を維持。
3. **型レベル Workers ガード**: `apps/web/tsconfig.json` の `types` から `"node"` を外す（`@cloudflare/workers-types` 等へ。Node-only グローバルが型で素通りするのを防ぐ）。
4. **packages/core に tsconfig.json**（`tsconfig.base.json` を extends）を追加。
5. **drizzle-orm のバージョン整合**: drizzle-orm 0.38.4 と @better-auth/drizzle-adapter の peer `^0.45.2` が不一致（現状 optional peer で動作）。9 テーブルのスキーマを敷く前に決着（drizzle-orm を ^0.45 へ bump、または better-auth を 0.38 互換版に pin）。
6. **FK CASCADE 検証**: libSQL は `PRAGMA foreign_keys=ON` が接続毎に必要。edge の CASCADE が実際に効くか検証し、必要なら `createDb`（`packages/db/src/client.ts`）で pragma を設定。
7. **統合シームのテスト**（Plan 1 で未カバー）: SSR/`__env__`/Start server-route 経路を 1 本でも自動テストで叩く（Plan 2 の API がまだ無ければ最小限でも）。

## 進め方
1. 上記を読み、libSQL 到達を確認したうえで **writing-plans スキル**で Plan 2 を `docs/superpowers/plans/2026-06-20-veritra-data-model-core.md` に書く（バイトサイズ TDD、前提タスク 1〜7 を Task 0 群として先頭に）。書いたらユーザーにレビューを求める。
2. 承認後、**subagent-driven-development スキル**で実行（タスクごとに新規実装者 Agent → 各タスクのレビューゲート → 修正ループ → ledger 更新 `.git/sdd/progress.md`）。
3. ユーザーが ultracode（Workflow オーケストレーション）を希望する場合のみ、**レビューゲートの多視点ファンアウト**に Workflow を使う（逐次依存の実装本体は Workflow ドライバにしない。Plan 1 と同方針）。希望しなければ通常の Agent ディスパッチで。
4. 各タスクは TDD・頻繁なコミット。green は subagent 自己申告に頼らず、要所でコントローラ自身が `pnpm test:run` / `pnpm typecheck` を実行して実証。
5. ロール enforcement・tRPC API は Plan 3、UI は Plan 4（このセッションでは作らない）。

まず上記ファイル群を読み、libSQL 到達を確認し、Plan 2 を書き始めてほしい。

