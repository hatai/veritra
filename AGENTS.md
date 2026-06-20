# AGENTS.md

OpenCode セッション向けガイダンス。**プロジェクトの本ガイダンス（概要・コマンド・アーキテクチャ・落とし穴・ツールチェーン）はすべて `CLAUDE.md` に集約されている** — まず **@CLAUDE.md** を読むこと。本ファイルは `CLAUDE.md` と重複しない OpenCode 向けの運用・検証メモのみを置く。

## 一次情報源

- **@CLAUDE.md** — コマンド・アーキテクチャ・落とし穴・ツールチェーン（最重要）
- `README.md` — スタック統合（Approach A/B）の経緯・バージョン表
- `docs/superpowers/specs/2026-06-20-veritra-design.md` — 設計の根拠

## 検証（CI / pre-commit なし — 手動で走らせる）

CI も pre-commit フックも未設定。タスク完了前に以下を**全て**通すこと：

```sh
LIBSQL_URL=http://127.0.0.1:8080 pnpm test:run   # libSQL 起動が前提（先に pnpm db:up && pnpm db:migrate）
pnpm lint                                         # vp lint（@libsql/client/web 強制ルールを含む）
pnpm typecheck                                    # tsc -p apps/web/tsconfig.json
```

- 順序の強制はないが `pnpm build` は型チェックを行わないので `pnpm typecheck` を別途実行すること。
- `pnpm test` は watch モード。一括実行は `pnpm test:run`（`LIBSQL_URL` 明示必須）。
- 単一テスト: `vp test run <path>`（`vp` = Vite+ バイナリ）。

## 環境変数・シークレット（3 系統を使い分ける）

| ファイル             | 読み手                       | 内容                                   | tracked |
| -------------------- | ---------------------------- | -------------------------------------- | ------- |
| `.env`               | Node / `vp`（test/lint）     | `LIBSQL_URL` 等                        | 否      |
| `.dev.vars`          | wrangler dev                 | `AUTH_SECRET` / `BASE_URL`             | 否      |
| `wrangler.toml [vars]` | wrangler（dev 本体）       | `LIBSQL_URL`（ローカル値）のみ         | 是      |
| `.env.example`       | （テンプレ）                 | 上記の雛形                             | 是      |

- `pnpm dev` が `.dev.vars` を `apps/web/.output/server/.dev.vars` へコピーして wrangler に読ませる（CLAUDE.md「落とし穴」参照）。
- `.env` / `.env.*` / `.dev.vars` は `.gitignore` 対象。**実ファイルを commit しない**こと。
- 本番シークレットは `wrangler secret put` で別途設定（現状未設定・デプロイフロー未整備）。

## 作業上のルール

- **コミット・push・PR はユーザーから明示的に指示された時のみ**。デフォルトは変更を作業ツリーに残す。
- 既存コード編集時は `CLAUDE.md` の「落とし穴」セクションを厳守（特に `app.fetch(request, getWorkerEnv())` の env 明示渡し・`@libsql/client/web` 限定 import・2 つの `vite.config.ts` の役割違い）。
- `notes` テーブル・`ping` プロシージャは配線確認用サンプル。ドメインモデル（Requirement/Viewpoint/Condition/TestCase）は未実装 — これらを触る場合は先に設計 doc を読む。
