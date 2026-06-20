# Veritra 設計ドキュメント（MVP）

- **作成日**: 2026-06-20
- **ステータス**: 設計合意済み（実装計画は別途 writing-plans で作成）
- **コードネーム**: Veritra（verify + trace ＝「検証して追跡する」）

## 1. 背景と目的

**課題**: AI エージェントを使った開発で実装速度が大きく上がった結果、**テストが追いつかない**。テスト分析・設計・実施が実装スピードのボトルネックになっている。

**目的**: テスト分析 → 設計 → 実施までを **より高速に、かつ確実に**回せるようにする。「確実に」を担保する手段が、トレーサビリティとカバレッジ（未カバー）の可視化である。

利用者は社内の少人数の開発 / QA チーム（数人〜十数人）。ログインと簡易な権限を持つ。
最終的には「分析 → 設計 → 結果記録 → バグ連携」を一気通貫で繋ぐが、**本 MVP は「テスト分析・テスト設計」に集中する**。
既存ツール（TestRail 等）との差別化は、ツリー UI そのものではなく **トレーサビリティ＋カバレッジ可視化＋設計根拠の保持**に置く。

AI エージェント開発が前提のため、**将来 AI 支援（観点提案・ケース生成・漏れ指摘）を第一級で足せること**を設計の制約とする（MVP では実装しないが、データモデルに provenance 余地を持たせる）。

## 2. スコープ

### 2.1 MVP に含む

- 要件/テストベース → 観点 → 条件 → テストケースの作成・編集（**ツリー＋ケース表が home**）
- **カバレッジ可視化**（未カバーの検出・ハイライト）← 設計のみ MVP の中核価値
- ログイン＋簡易ロール（admin / member）、プロジェクト単位の管理
- 主要 1 経路の最小 E2E テスト

### 2.2 MVP に含まない（次マイルストーン以降）

| 機能 | 備考 |
|------|------|
| 実行(Run)/結果記録 | データモデルは将来の Run/Result 追加を見越して分離設計する（§3.3, §8） |
| バグ管理・GitHub / Linear 連携 | 外部参照テーブルとして設計（§8） |
| ドキュメント埋め込み（Notion 風） | ツリー＋表を散文ドキュメントにライブ埋め込みする発展形（§8） |
| AI 支援（観点提案・ケース生成・漏れ指摘） | provenance 余地のみ MVP で確保（§3, §8） |
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
   └─ condition_case (多対多)  ← derivation(導出根拠) はこの edge に持つ
TestCase(テストケース)
```

### 3.1 エンティティ

すべてのエンティティは **`project_id`（テナント境界）**、**`created_at` / `updated_at` / `created_by`**、**`archived_at`（nullable, ソフトアーカイブ）**を持つ。

- **Project** — ワークスペース境界
- **Requirement** — `title`, `description`, `source`(URL/参照ID)
- **Viewpoint** — `title`, `memo`（根拠・気づきを散文で記述可能）
- **Condition** — `title`, `description`
- **TestCase** — `title`, `precondition`, `steps`（**順序付きリスト**。当面は文字列要素、将来 step 単位の結果記録のため構造拡張可）, `expected`, `priority`
  - **`provenance`**（nullable）: 生成元（human / ai）、モデル名、承認状態。MVP では human 固定で記録のみ
- **User**, **Membership** — `(project_id, user_id)` に UNIQUE、`role`(admin / member)

### 3.2 リンク（多対多 placement）

各リンクは独立した join テーブル。**`project_id` を含み**、**並び順は edge 側の `position`（fractional index 文字列。O(1) 挿入・再採番不要）**で保持する。

- `requirement_viewpoint(project_id, requirement_id, viewpoint_id, position)`
- `viewpoint_condition(project_id, viewpoint_id, condition_id, position)`
- `condition_case(project_id, condition_id, case_id, position, derivation)`
  - **`derivation`（導出根拠）は edge に置く**。「この条件からこのケースを導いた理由」（境界値/同値クラス/リスク… の enum＋メモ）であり、ケースを複数条件で共有しても根拠が衝突しないため。

各 edge は **`(親_id, 子_id)` に複合 UNIQUE**（同一親子の重複リンク禁止）。**親子は同一 project に属することを制約で保証**（join の `project_id` ＋ 複合 FK、または書込み時のアプリ層検証）。

### 3.3 不変条件（設計の肝）

1. **識別子は配置から独立**。エンティティ（特に TestCase）の id は、ツリー上の移動・並べ替えで変わらない。配置は join テーブルの edge で表現し、順序も edge の `position` に持つ。
2. **1 つの子は複数の親に属せる**（タグではなく真の多対多 placement）。ツリー UI では共有ノードに「共有」バッジを表示し、どこか 1 箇所での編集が全箇所に反映される（single source of truth）。
3. **TestCase の内容は MVP では編集可能、id は安定**。「不変」とは id・参照の安定性を指し、内容は可変。
   - **将来 Run/Result を足す際は、Result が実行時のケース定義をスナップショット保存する**方針とする（フル Revision システムは導入しない）。これにより「何を実行したか」の再現性を確保しつつ MVP を軽く保つ。
4. **ケース定義は将来の Run/Result と分離**。実行情報（環境・実行日時・Pass/Fail）を TestCase に混ぜない。

### 3.4 制約・削除方針

- **削除は 2 操作に分離**: 「ここから外す（placement = edge 削除）」と「完全に削除（エンティティの archive または物理削除）」を UI・API で明確に区別
- **エンティティ削除はソフトアーカイブ（`archived_at` 設定）を既定**とし、物理削除は admin 操作に限定
- **edge の FK は親子削除時 CASCADE**（edge は従属物）。**エンティティ間に直接 FK は張らず** placement 経由とするため、孤児化はカバレッジ側で検出（§4）
- **Project 削除**は配下を一括 archive（物理削除は別途確認フロー）。**User 削除**時は Membership を外し、`created_by` は保持（表示は "削除済みユーザー"）
- **最後の admin は降格・削除不可**

## 4. カバレッジ・ルール（決定論的に計算。AI ではない）

純粋関数として `packages/core` に実装し、単体テストで固める。ツリーノードにバッジ＋カウントを表示し、サマリパネルにギャップ一覧を出す。

### 4.1 入出力契約（曖昧さを排除するため明文化）

- **対象集合**: 指定 `project_id` に属し、かつ `archived_at IS NULL`（= active）なエンティティ・edge のみ
- **distinct**: 到達ケース数は **`COUNT(DISTINCT case_id)`**（多対多で複数経路があっても重複カウントしない）
- **covered の定義**: あるノードは、**active な TestCase に（placement 経由で）少なくとも 1 つ到達できる**とき covered
- **orphan の対象型**: 親を持つべきエンティティ（Viewpoint / Condition / TestCase）のうちどの親 edge も持たないものを orphan とする。**Requirement は根なので orphan 判定の対象外**
- **出力順序**: 安定ソート（`(type, created_at, id)`）。各ギャップに決定論的な **gap ID**（`type:entity_id:rule`）を付与し、UI のハイライト・再計算で同一性を保つ

### 4.2 ルール一覧

| ルール | 検出対象 | ラベル |
|--------|----------|--------|
| 要件に紐づく観点が 0 | 未分析の要件 | uncovered-requirement |
| 観点に紐づく条件が 0 | 未展開の観点 | uncovered-viewpoint |
| 条件に紐づくケースが 0（active） | **未カバーの条件** | uncovered-condition（中核） |
| Viewpoint/Condition/TestCase がどの親 edge も持たない | 未配置ノード | orphan |
| （補助）要件単位の到達ケース数 | `COUNT(DISTINCT case_id)`（条件経由） | reach-count |

## 5. アーキテクチャ

### 5.1 技術スタック（確定）

> **先端依存の方針**: TypeScript v7 (RC)・Vite+・Vite 8・TanStack Start を**全て採用**する（先端を試す意図を尊重）。リスク（RC/新興ツールの不安定性・破壊的変更・情報の少なさ）は本書に記載のうえ受容する。緩和策として、Vite+ は置換可能なツール層として扱い、致命的問題時は素の Vite + Vitest + ESLint/Prettier へフォールバック可能な構成を保つ。

| 層 | 採用 |
|----|------|
| ランタイム / パッケージマネージャ | **Node.js**（ローカル開発ランタイム）+ **pnpm**（PM、pnpm workspaces）。本番 Cloudflare Workers(workerd) は Node でも Bun でもないため、アプリコードは Workers 互換を維持し Node 専用 API を避ける |
| ツールチェーン | **Vite+**（Vite 8/Rolldown・Vitest・Oxlint・Oxfmt・tsdown・Vite Task）。`vite.config.ts` 一枚で構成。**置換可能層として扱う** |
| 言語 | **TypeScript v7 (RC)**（`typescript@7.0.1-rc`）。Vite+ 0.2.1 の peer dep は `^5\|\|^6` だが、`pnpm-workspace.yaml` の `overrides` + `peerDependencyRules.allowedVersions` で TS7 を強制し Vite+ と併存（lint/test/build/typecheck すべて TS7 で緑を確認） |
| フロント / メタフレームワーク | **TanStack Start**（React, SSR/CSR） |
| サーバ / エッジ | **Hono.js**（Cloudflare Worker のエントリ） |
| RPC | **tRPC** |
| スキーマ検証 | **valibot**（tRPC 入力・フォーム検証。Standard Schema 対応、Workers 向きで軽量） |
| ORM / DB | **Drizzle**（sqlite 方言）+ **Turso**（libSQL）。**Workers では libSQL の HTTP/Web client（`@libsql/client/web`）を使用**し、Node/native client は使わない |
| UI | React + **TanStack Table** + **shadcn/ui** |
| 認証 | **better-auth**（DIY）。下記 §5.4・§6 に Workers 具体設定を記載 |
| コンポーネント開発 | **Storybook**（Vite ビルダー上、Vite+ とは別管理） |
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

- **ローカル開発**: Docker Compose で libSQL(sqld) を起動。Vite dev で TanStack Start、Hono を同一プロセスで mount。`.env` の DB URL で接続先を切替
- **本番（将来）**: 単一 Cloudflare Worker（Hono がエントリ、TanStack Start を内包）＋ Turso。Workers 互換のため Node 専用 API を避ける
- **差分検出**: ローカル Node と本番 workerd の乖離を早期に捉えるため、**Wrangler/workerd 上の統合テストを最初から CI に入れる**

### 5.4 技術検証スパイク（実装計画の最初の Must タスク）

TanStack Start × Hono の統合（SSR context・CF bindings・static assets・streaming・エラー処理が境界）は自明に成立しないため、本格実装前に**最小スパイク**で成立を確認する：

1. Hono が `/api/trpc` を配信し tRPC が往復する
2. better-auth の cookie セッションが Worker 上で機能する（adapter, `nodejs_compat`, secure cookie, `trustedOrigins`）
3. TanStack Start の SSR 1 ページが Hono fallback 経由で描画される
4. Turso への read/write（HTTP client）が成立する
5. 実 Cloudflare Worker へデプロイできる

スパイクで重大な非互換が出た場合は §5.1 のフォールバック方針を発動する。

## 6. 認証・権限

- **better-auth** + Drizzle(sqlite/libSQL) adapter、email+password、cookie セッション
- Workers 設定: `nodejs_compat` 有効化、secure/SameSite cookie、`trustedOrigins`、reverse proxy header の取り扱いを固定。migration は better-auth/Drizzle のスキーマに統合
- tRPC は `protectedProcedure` で認可ガード（project メンバーシップを検証）

**権限表**

| 操作 | admin | member |
|------|:----:|:------:|
| エンティティ CRUD（要件/観点/条件/ケース・edge） | ✓ | ✓ |
| 閲覧・カバレッジ参照 | ✓ | ✓ |
| メンバー招待・ロール変更 | ✓ | – |
| プロジェクト設定変更・物理削除 | ✓ | – |

- **初期 admin** = プロジェクト作成者
- **招待**は admin による email 招待
- **最後の admin** は降格・削除不可

## 7. エラー処理・テスト方針

- tRPC の型付きエラー＋ **valibot** 入力検証。DB 制約で参照整合性を担保
- `packages/core`（カバレッジ・DAG/placement 操作）= **Vitest 単体テストで TDD**（純粋関数）
- tRPC ルーター = テスト用 libSQL に対する統合テスト
- UI = Storybook ＋ 主要コンポーネントのインタラクションテスト
- **最小 E2E**: 「要件作成 → 観点/条件/ケース追加 → カバレッジに未カバーが反映される」主要 1 経路を MVP に含める
- **workerd/Wrangler 統合テスト**を CI に早期投入（§5.3）

## 8. 将来拡張の指針（MVP では作らないが設計で意識）

- **実行・結果記録**: `TestRun` / `Result` を別エンティティで追加。TestCase は id 安定のまま、Result が実行時定義をスナップショット保存（§3.3）。同じケースを複数環境・リリースで実行可能
- **バグ管理 / GitHub・Linear 連携**: 「同じグラフのノード」に押し込めず、**外部参照テーブル**（外部 ID・provider・同期状態・最終同期時刻）として設計し、複数 provider と同期状態を扱えるようにする
- **ドキュメント埋め込み**: ツリー＋ケース表を Notion 風ブロック文書にライブ埋め込み。正準エンティティ参照（コピーでない）なので「スコープ参照付き読み書きビュー」として後付け
- **AI 支援**: 仕様 → 観点候補生成、ケースの抜け漏れ指摘。`TestCase.provenance`（生成元/モデル/承認状態）を MVP から確保済み。決定論的カバレッジ（§4）とは別レイヤーで足す
- **俯瞰ビュー**: 観点×機能のカバレッジ・マトリクス、デシジョンテーブル / 状態遷移からのケース生成
- **横断機能**: 全文検索、監査ログ（`created_at/updated_at/created_by` は MVP で確保済み）

## 9. 設計上の根拠（議論の要点）

- 北極星は「AI 高速開発に追従できる、速く確実なテスト」。"確実" の担保がカバレッジ／トレーサビリティ可視化。
- 単一ツリーを唯一のデータモデルにするのは脆い（多重所属・再利用・移動時の識別子安定性に耐えない）。よって**型付きエンティティ＋多対多リンク**を採用し、ツリーは表現の一形態とした。
- 「設計のみ MVP」の唯一の差別化価値はカバレッジ可視化なので、§4 を決定論的な入出力契約として明文化した。
- 要件/テストベースを第一級エンティティにすることで、最も鋭いカバレッジ指標「観点の無い要件」を成立させた。
- 北極星の「速く」は、MVP では**効率的な手動 UX（キーボード駆動・quick-add 等）**で追求し、AI 支援・高速取込は将来拡張とする（スコープを軽く保つための明示的判断）。
- 先端スタック（TS7 RC・Vite+ 等）を全採用するリスクは受容し、Vite+ を置換可能層として緩和（§5.1）。TanStack Start×Hono の成立は §5.4 のスパイクで先に検証する。
