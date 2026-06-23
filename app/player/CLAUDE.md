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
- `data/` — **生成物**。`scenes/*.json`（手編集禁止＝build-scenes 経由）/ `flow.json`（手編集可＝分岐の人手定義）/ `sprites.json`・`backgrounds.json` / `manifest.json`。
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

分岐（選択肢/JUMP/フラグ）は**原データ `md_scr.med` に存在する**（現行 `extract_text.py` が破棄/誤分類）。

- **一次** = `scripts/extract-flow.py`（VN-11）で `SMAIN`＋select オペコードを再抽出 → `data/flow.json`。
- **二次** = `../prototype/route_map.html`(N/E) と `build_ayan_end1.py`(SCENES/KEEP) を照合・ラベル補完。
- 編集は `data/flow.json` に対して行う。

## やってはいけない

- CG/音声/`original_game` をコミットしない（`.gitignore` 済、manifest のみ管理）。Git LFS も使わない。
- `../prototype/` を改変しない（仕様・演出パラメータの参照源）。
- `data/scenes/*.json` を手編集しない（パイプライン経由。`flow.json` は手編集可）。

## ADR を書く条件

スキーマ変更・解決規則変更・素材取得方式変更・フロー復元方式の決定時は `../../docs/adr/` に追記。
