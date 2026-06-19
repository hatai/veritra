# Veritra 設計ドキュメント（MVP）

- **作成日**: 2026-06-20
- **ステータス**: 設計合意済み（実装計画は別途 writing-plans で作成）
- **コードネーム**: Veritra（verify + trace ＝「検証して追跡する」）

## 1. 背景と目的

テスト分析・テスト設計・テスト結果記録・バグ管理（GitHub / Linear 連携）までを扱うテスト管理 web アプリ。
利用者は社内の少人数の開発 / QA チーム（数人〜十数人）。ログインと簡易な権限を持つ。

最終的には「分析 → 設計 → 結果記録 → バグ連携」を一気通貫で繋ぐが、**本 MVP は「テスト分析・テスト設計」に集中する**。
既存ツール（TestRail 等）との差別化は、ツリー UI そのものではなく **トレーサビリティ＋カバレッジ（未カバー）可視化＋設計根拠の保持**に置く。

## 2. スコープ

### 2.1 MVP に含む

- 要件/テストベース → 観点 → 条件 → テストケースの作成・編集（**ツリー＋ケース表が home**）
- **カバレッジ可視化**（未カバーの検出・ハイライト）← 設計のみ MVP の中核価値
- ログイン＋簡易ロール（admin / member）
- プロジェクト単位の管理

### 2.2 MVP に含まない（次マイルストーン以降）

| 機能 | 備考 |
|------|------|
| 実行(Run)/結果記録 | データモデルは将来の Run/Result 追加を見越して分離設計しておく |
| バグ管理・GitHub / Linear 連携 | |
| ドキュメント埋め込み（Notion 風） | ツリー＋表を散文ドキュメントにライブ埋め込みする発展形。下記 §8 参照 |
| AI 支援（観点提案・ケース生成・漏れ指摘） | 後から足せるよう設計だけ意識 |
| リアルタイム共同編集 | |
| 高度なマトリクスビュー / デシジョンテーブル / 状態遷移からの生成 | |

## 3. データモデル（型付きエンティティ＋多対多）

4 つのドメインエンティティを**多対多リンク（実体は DAG）**で繋ぐ。ツリー UI はこの DAG のナビゲーション表現にすぎない。

```
Requirement(要件/テストベース)
   └─ requirement_viewpoint (多対多)
Viewpoint(観点)
   └─ viewpoint_condition (多対多)
Condition(テスト条件)
   └─ condition_case (多対多)
TestCase(テストケース)
```

### 3.1 エンティティ

- **Project** — ワークスペース境界。すべてのエンティティは project に属する
- **Requirement** — `title`, `description`, `source`(URL/参照ID), `order`
- **Viewpoint** — `title`, `memo`（根拠・気づきを散文で記述可能）
- **Condition** — `title`, `description`
- **TestCase** — `title`, `precondition`, `steps`, `expected`, `derivation`（導出根拠: 境界値/同値クラス/リスク… の enum＋メモ）, `priority`
- **User**, **Membership** — `role`(admin / member)、project への所属

### 3.2 リンク（多対多 placement）

各リンクは独立した join テーブルとして持ち、**並び順(order)は edge 側**に保持する。

- `requirement_viewpoint(requirement_id, viewpoint_id, order)`
- `viewpoint_condition(viewpoint_id, condition_id, order)`
- `condition_case(condition_id, case_id, order)`

### 3.3 不変条件（設計の肝）

1. **識別子は配置から独立**。エンティティ（特に TestCase）の id・履歴は、ツリー上の移動・並べ替えで変わらない。配置は join テーブルの edge として表現し、order も edge 側に持つ。
2. **1 つの子は複数の親に属せる**（タグではなく真の多対多 placement）。ツリー UI では共有ノードに「共有」バッジを表示し、どこか 1 箇所での編集が全箇所に反映される（single source of truth）。
3. **導出根拠（derivation）は第一級フィールド**。なぜそのケースが必要か（境界値/同値クラス/リスク等）を構造化して保持する。
4. **ケース定義は将来の Run/Result と分離**。実行に関する情報（環境・実行日時・Pass/Fail）を TestCase に混ぜない。将来 `TestRun` / `Result` を別エンティティとして追加できる形を保つ。

## 4. カバレッジ・ルール（決定論的に計算。AI ではない）

純粋関数として `packages/core` に実装し、単体テストで固める。ツリーノードにバッジ＋カウントを表示し、サマリパネルにギャップ一覧を出す。

| ルール | 検出対象 | ラベル |
|--------|----------|--------|
| 要件に紐づく観点が 0 | 未分析の要件 | uncovered requirement |
| 観点に紐づく条件が 0 | 未展開の観点 | |
| 条件に紐づくケースが 0 | **未カバーの条件** | 中核 |
| （補助）要件単位の到達ケース数 | 条件経由で到達できるケースの合計 | |
| （補助）どの親にも属さないエンティティ | 未配置ノード | orphan |

## 5. アーキテクチャ

### 5.1 技術スタック（確定）

| 層 | 採用 |
|----|------|
| ランタイム / パッケージマネージャ | **Node.js**（ローカル開発ランタイム）+ **pnpm**（PM、pnpm workspaces）。本番は Cloudflare Workers(workerd) で Node でも Bun でもないため、アプリコードは Workers 互換を維持し Node 専用 API を避ける |
| ツールチェーン | **Vite+**（Vite 8/Rolldown・Vitest・Oxlint・Oxfmt・tsdown・Vite Task）。`vite.config.ts` 一枚で構成 |
| 言語 | **TypeScript v7 (RC)** |
| フロント / メタフレームワーク | **TanStack Start**（React, SSR/CSR） |
| サーバ / エッジ | **Hono.js**（Cloudflare Worker のエントリ） |
| RPC | **tRPC** |
| スキーマ検証 | **valibot**（tRPC 入力・フォーム検証。Standard Schema 対応、Workers 向きで軽量） |
| ORM / DB | **Drizzle**（sqlite 方言）+ **Turso**（libSQL） |
| UI | React + **TanStack Table** + **shadcn/ui** |
| 認証 | **better-auth**（DIY。Hono/Drizzle/Cloudflare と相性良。外部 SaaS 依存なし） |
| コンポーネント開発 | **Storybook**（Vite ビルダー上で動作、Vite+ とは別管理） |
| デプロイ | 本番（将来）: 単一 Cloudflare Worker + Turso／開発: Docker Compose。**当面ローカル開発のみ** |

### 5.2 モノレポ構成（pnpm workspaces）

```
apps/web        … TanStack Start アプリ（React）。UI 一式
server (Hono)   … Cloudflare Worker エントリ
                    /api/trpc/*  → tRPC ルーター
                    /api/auth/*  → better-auth
                    それ以外     → TanStack Start ハンドラ
packages/db     … Drizzle schema + クエリ（sqlite 方言 → libSQL/Turso）
packages/core   … ドメインロジック（カバレッジ計算・placement 操作）。純粋・テスタブル
packages/ui     … shadcn/ui + TanStack Table 製の共有コンポーネント（Storybook）
```

### 5.3 ローカル開発 / 本番

- **ローカル開発**: Docker Compose で libSQL(sqld) を起動。Vite dev で TanStack Start、Hono は同一プロセスで mount。`.env` の DB URL で接続先を切替
- **本番（将来）**: 単一 Cloudflare Worker（Hono がエントリ、TanStack Start を内包）＋ Turso。Workers 互換のため Node 専用 API を避ける

## 6. エラー処理・整合性

- tRPC の型付きエラー＋ **valibot** 入力検証
- **共有ノードの削除を 2 操作に分離**: 「ここから外す（placement = edge 削除）」と「完全に削除（エンティティ削除）」を UI・API で明確に区別する
- DB 制約で参照整合性を担保。どの親にも属さないノードはカバレッジ上「未配置」として検出
- tRPC は `protectedProcedure` で認可ガード（project メンバーシップを検証）

## 7. テスト方針

- `packages/core`（カバレッジ・DAG/placement 操作）= **Vitest 単体テストで TDD**（純粋関数）
- tRPC ルーター = テスト用 libSQL に対する統合テスト
- UI = Storybook ＋ 主要コンポーネントのインタラクションテスト
- E2E（Playwright 等）は次マイルストーン以降

## 8. 将来拡張の指針（MVP では作らないが設計で意識）

- **ドキュメント埋め込み**: ツリー＋ケース表を Notion 風ブロック文書に**ライブ埋め込み**できる発展形。地の文（仕様要約・リスク・設計方針）を散文で書きつつ、構造データを同じ面で編集する。データモデルは正準エンティティ参照（コピーではない）なので、埋め込みビューは「スコープ参照付きの読み書きビュー」として後付けできる
- **実行・結果記録**: `TestRun` / `Result` を別エンティティで追加。TestCase は不変のまま、同じケースを複数環境・リリースで実行できる
- **バグ管理 / GitHub・Linear 連携**: バグを同じ参照グラフ上のノードとして繋ぐ
- **AI 支援**: 仕様 → 観点候補生成、ケースの抜け漏れ指摘。`packages/core` の決定論的カバレッジとは別レイヤーで足す
- **俯瞰ビュー**: 観点×機能のカバレッジ・マトリクス、デシジョンテーブル / 状態遷移からのケース生成

## 9. 設計上の根拠（議論の要点）

- 単一ツリーを唯一のデータモデルにするのは脆い（ケースの多重所属・再利用・移動時の識別子安定性に耐えない）。よって**型付きエンティティ＋多対多リンク**を採用し、ツリーは表現の一形態とした。
- 「設計のみ MVP」の唯一の差別化価値はカバレッジ可視化なので、§4 のルールを決定論的に明文化した。
- 要件/テストベースを第一級エンティティにすることで、最も鋭いカバレッジ指標「観点の無い要件」を成立させた。
