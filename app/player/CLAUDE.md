# app/player — 催眠4 Web プレイヤー（Claude Code 向けガイド）

「催眠4」ビジュアルノベルの Web 再構築アプリ本体。VN 再生＋ルート分岐ビューアの2機能。

## 技術スタック（確定・不変）

Vite + TypeScript + React / VN描画=**PixiJS**(WebGL) / ルート図=**React Flow**(@xyflow/react) / 音声=**Howler.js** / 状態=**Zustand** / スキーマ=**zod**。

## ディレクトリ規約

- `src/pipeline/` — 原データ→構造化の**純関数**（Node/ブラウザ両用、Vitest 対象）。`types.ts` がデータ契約（zod）。
- `src/engine/` — PixiJS レンダラ（背景/立ち絵/字幕レイヤ）。演出は `../prototype/picturebook_v3.html` から移植。
- `src/flow/` — React Flow（`../prototype/route_map.html` の N/E を移植）。
- `src/audio/` — Howler ラッパ（voice/se/bgm）。
- `src/store/` — Zustand（再生位置・現在シーン・フラグ）。
- `scripts/` — ビルドスクリプト（tsx 実行、Node）。
- `data/` — **生成物**。`scenes/*.json`（build-scenes 経由）/ `flow.json`（build-flow 経由。暫定期の補正は `scripts/route-map.data.ts` へ）/ `sprites.json`・`backgrounds.json` / `manifest.json`。いずれも手編集禁止。
- `public/assets/` — **git 外**。素材実体は `npm run assets:fetch` で配置。

## コマンド

| コマンド                                                       | 用途                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                                                  | Vite 開発（http://localhost:5173）                        |
| `npm run build` / `preview`                                    | 本番ビルド / プレビュー                                   |
| `npm run lint` / `format` / `typecheck`                        | ESLint(`--max-warnings 0`) / Prettier / `tsc -b --noEmit` |
| `npm run test` / `test:watch`                                  | Vitest                                                    |
| `npm run assets:fetch -- --scene <code>`                       | 素材を public/assets へ同期＋manifest 生成                |
| `npm run data:defs` / `data:scenes` / `data:flow` / `data:all` | sprites/backgrounds・scenes・flow を生成                  |
| `npm run validate`                                             | 未解決参照・flow とシーンの相互照合                       |

## git 運用（GitHub Flow）

`main` は保護ブランチ（**CI 必須・PR 必須**、直 push / force-push / 削除 不可、管理者にも適用）。**直接 push せず必ず PR 経由**でマージする。

1. `git checkout main && git pull`
2. `git checkout -b hzq886/hu-<N>-<slug>`（Linear issue 単位＝1 issue 1 ブランチ。issue 着手時に状態を In Progress に）
3. 実装 → ローカルで `typecheck`/`lint`/`format:check`/`test`（CI と同一）を緑に → commit（メッセージ末尾に `Co-Authored-By: Claude`）
4. `git push -u origin <branch>` → `gh pr create --base main`
5. **CI 緑を確認**（緑でなければマージ不可）→ `gh pr merge --merge --delete-branch`
6. Linear issue を Done に更新

- CI = `../../.github/workflows/ci.yml`（PR と `main` への push で typecheck/lint/format:check/test/build、node24）。
- リポジトリは **public**（同人創作・元ゲーム素材は git 外）。設計判断は ADR、進行は Linear（Team `Hu`）。

## データ規約

- シーンコード: `NNN_XXX###[suffix]`（例 `002_AYAN001A`）。
- ボイスID: `CHAR_ROUTE_SCENE_serial`（例 `AYAN_002_AYAN001A_001`）→ ファイル名は **manifest を真実の源**に照合（大小文字変換は不確実）。
- 立ち絵/背景: `[note]` ラベル経由で `_SPRSET.txt`/`_BGSET.txt` から解決（`sprites.json`/`backgrounds.json`）。
- 言語: **日本語(jp)主軸**。スキーマは locale 対応、cn は後続スプリントで同パイプラインを流す。

## フロー復元の出典（重要）

分岐（選択肢/JUMP/フラグ）は**原データ `md_scr.med` に存在する**（現行 `extract_text.py` が破棄/誤分類）。`flow.json` は2段構えで復元する（→ [ADR 0005](../../docs/adr/0005-flow-reconstruction.md)）。

- **暫定（実装済・HU-13）** = `scripts/route-map.data.ts`（`../prototype/route_map.html` の N/E を逐語ポート）→ `scripts/build-flow.ts`（`npm run data:flow`）が `data/flow.json` を生成。`build_ayan_end1.py`(SCENES/KEEP) は照合・ラベル補完の参照。**分岐フラグ（`condition.flags`）は未付与**（ノード `description` に自然文で保持）。
- **一次（未実装・HU-15）** = `scripts/extract-flow.py` が `SMAIN`＋select オペコードを再抽出し `flow.json` を機械生成、`_DEF` 軸を `condition.flags` に機械表現。完成時に暫定を置換。
- 補正は **`route-map.data.ts`** に対して行う（`flow.json` は生成物で `data:flow` 再生成のたび上書き）。

## やってはいけない

- CG/音声/`original_game` をコミットしない（`.gitignore` 済、manifest のみ管理）。Git LFS も使わない。
- `../prototype/` を改変しない（仕様・演出パラメータの参照源）。
- `data/scenes/*.json`・`data/flow.json` を手編集しない（build-scenes / build-flow 経由。flow の補正は `scripts/route-map.data.ts` へ）。

## ADR を書く条件

スキーマ変更・解決規則変更・素材取得方式変更・フロー復元方式の決定時は `../../docs/adr/` に追記。
