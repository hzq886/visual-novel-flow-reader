# ADR 0002: シーン / フロー データスキーマ

- ステータス: 採択（2026-06-22）

## コンテキスト
原データは独自マークアップ `[text]`（本文/セリフ）/ `[id]`（背景ID・ボイスID・ラベル）/ `[note]`（#立ち絵/背景の演出指示）。これをアプリが消費できる構造化 JSON に変換する必要がある。日本語/中国語の2言語、立ち絵差分（body/face レイヤ）、ボイス紐付けを扱う。

## 決定
- データ契約は `app/player/src/pipeline/types.ts` の **zod スキーマ＋型推論**で一元管理。
- **Scene**: `{ code, route, locale, title?, beats[] }`。**Beat** は `kind` の判別共用体: `narration {lines, bg?, sprite?}` / `line {who, voice?, lines, bg?, sprite?}`。
- 素材参照は `BgRef{label,file|null}` / `SpriteRef{label,body|null,face|null,offset?}` / `VoiceRef{id,file|null}`。**`file=null` は未解決**を表し `validate` が検出する。
- **Flow**: `{ nodes[], edges[] }`。node は `route_map` の id/kind/character/groups を踏襲、edge は `label`（選択肢/条件）＋ `condition.flags`。node の `choices[]`（`FlowChoice{scene, options[]}`）は選択肢メニュー（HU-18/19）。**ルート分岐（SMAIN len-8 switch）の選択肢には `options[*].flag`（`S###/軸…=値`）/`target`（分岐先ノード id）/`targetTitle` を付与**（HU-21。[ADR 0005](0005-flow-reconstruction.md)）。
- **locale 対応**: スキーマは jp/cn 両対応。ただし Sprint 0/1 は **jp のみ実データ生成**、cn は後続で同パイプラインを流す（ボイス/CG は共通、`beats[].text` のみ差し替え）。
- 生成物の置き場: `data/scenes/<code>.json`（手編集禁止）/ `data/flow.json`（手編集可）/ `data/sprites.json`・`data/backgrounds.json` / `data/manifest.json`。

## 帰結
- 型でパース実装の前提が固定され、ゴールデンテスト（`002_AYAN001A`）で回帰を防げる。
- フロー条件（`_DEF` の S###/軸フラグ）は当面 `description` 自然文で保持し、VN-11 で `condition.flags` に機械復元する。
