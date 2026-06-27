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
- `data/` — **生成物**。`scenes/<locale>/*.json`（build-scenes 経由。jp/cn 別ディレクトリ）/ `flow.json`（extract-flow.py 経由＝SMAIN 機械抽出）/ `sprites.json`・`backgrounds.json` / `manifest.json`。いずれも手編集禁止。`flow.routemap.json`（build-flow 二次出力）は git 外。
- `public/assets/` — **git 外**。素材実体は `npm run assets:fetch` で配置。

## コマンド

| コマンド                                                       | 用途                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                                                  | Vite 開発（http://localhost:5173）                        |
| `npm run build` / `preview`                                    | 本番ビルド / プレビュー                                   |
| `npm run lint` / `format` / `typecheck`                        | ESLint(`--max-warnings 0`) / Prettier / `tsc -b --noEmit` |
| `npm run test` / `test:watch`                                  | Vitest                                                    |
| `npm run assets:fetch -- --scene <code>`                       | 素材を public/assets へ同期＋manifest 生成                |
| `npm run data:defs` / `data:scenes` / `data:flow` / `data:all` | sprites/backgrounds・scenes(jp+cn)・flow を生成           |
| `npm run data:scenes:cn` / `validate:cn`                       | cn シーン生成 / cn の未解決参照照合                       |
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
- 効果音(se): `[id]` の se コード（`^\d{4}[A-Za-z]$`、例 `8351A`）を `parseScene` が `Beat.se` に取り込み、manifest で実ファイルへ解決（大小文字無視）。bytecode RE で `0x6c` が se 再生命令と確認（HU-28、[ADR 0006](../../docs/adr/0006-audio-cues.md) / [`smain_flow_guide.md` §3.9](../../data_extract/text/_tools/smain_flow_guide.md)）。
- BGM: **トラック選択は原データに無い**（網羅確認済）。シーンの character（ルート）→ M01-M16 を `src/pipeline/audio.ts` の `BGM_BY_CHARACTER` で**curated 割当**（編集可。`Scene.bgm`）。エンジンはシーン跨ぎ継続＋track 変化でクロスフェード。
- 言語: **日本語(jp)主軸**＋**中国語(cn)対応済（HU-29）**。cn ソースは別タグ語彙（`[cn]`/`[ascii]`/`[jp]`）を `parseScene` が正準タグへ正規化。note は日本語ラベルのままなので bg/sprite は jp 定義で解決、voice/se/bgm は jp/cn 同一素材を共用。エンジンは store の `locale` で jp⇄cn をリアルタイム切替（ボタン / `L` キー、再生位置維持はベストエフォート）。詳細は [ADR 0007](../../docs/adr/0007-cn-locale-i18n.md)。

## フロー復元の出典（重要）

分岐（選択肢/JUMP/フラグ）は**原データ `md_scr.med` に存在する**（旧 `extract_text.py` が破棄/誤分類）。`flow.json` は一次ソースから機械生成する（→ [ADR 0005](../../docs/adr/0005-flow-reconstruction.md)）。

- **一次（実装済・HU-15）** = `scripts/extract-flow.py`（`npm run data:flow`）が `SMAIN` バイトコードを逆アセンブルし `data/flow.json` を機械生成（全ルート・全分岐・全エンドの完全グラフ）。形式は [`smain_flow_guide.md`](../../data_extract/text/_tools/smain_flow_guide.md)。`condition.flags` は select id（`SEL_xx`）。原データは git 外のため未配置時はスキップ（committed の flow.json 維持）。
- **二次（照合・降格）** = `scripts/route-map.data.ts`＋`scripts/build-flow.ts`（`npm run data:flow:routemap`）。`../prototype/route_map.html` の N/E ポート。出力は `data/flow.routemap.json`（git 外・**flow.json は上書きしない**）。`build_ayan_end1.py` と併せ HU-16 の制御構造 diff・ラベル補完用。
- 選択肢メニュー文言の jp/cn i18n は `FlowNode.choices` に取り込み済（HU-18 ID 方式／HU-19 `_VIEW` 方式）。JP/CN 制御構造一致は `npm run data:flow:diff`（HU-16）。`condition.flags` の `_DEF` 実フラグ名解決済（HU-20）。
- **選択肢→分岐先（HU-21・実装済）**: シーン脚本 bytecode のフラグ set opcode を RE し SMAIN の len-8 switch と突合。`FlowChoice.options[*]` に `flag`/`target`/`targetTitle` を付与＋分岐ラベル付きエッジを新設（→ [`smain_flow_guide.md`](../../data_extract/text/_tools/smain_flow_guide.md) §3.8）。hub 合流後の goto 継続先解決は別 issue（full CFG）。
- **`flow.json` は手編集しない**（生成物。`data:flow` 再生成で上書き）。

## やってはいけない

- CG/音声/`original_game` をコミットしない（`.gitignore` 済、manifest のみ管理）。Git LFS も使わない。
- `../prototype/` を改変しない（仕様・演出パラメータの参照源）。
- `data/scenes/*.json`・`data/flow.json` を手編集しない（build-scenes / extract-flow 経由で再生成）。

## ADR を書く条件

スキーマ変更・解決規則変更・素材取得方式変更・フロー復元方式の決定時は `../../docs/adr/` に追記。
