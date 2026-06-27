# ADR 0002: シーン / フロー データスキーマ

- ステータス: 採択（2026-06-22）

## コンテキスト
原データは独自マークアップ `[text]`（本文/セリフ）/ `[id]`（背景ID・ボイスID・ラベル）/ `[note]`（#立ち絵/背景の演出指示）。これをアプリが消費できる構造化 JSON に変換する必要がある。日本語/中国語の2言語、立ち絵差分（body/face レイヤ）、ボイス紐付けを扱う。

## 決定
- データ契約は `app/player/src/pipeline/types.ts` の **zod スキーマ＋型推論**で一元管理。
- **Scene**: `{ code, route, locale, title?, beats[] }`。**Beat** は `kind` の判別共用体: `narration {lines, bg?, sprite?}` / `line {who, voice?, lines, bg?, sprite?}`。
- 素材参照は `BgRef{label,file|null}` / `SpriteRef{label,body|null,face|null,offset?}` / `VoiceRef{id,file|null}`。**`file=null` は未解決**を表し `validate` が検出する。
- **Flow**: `{ nodes[], edges[] }`。node は `route_map` の id/kind/character/groups を踏襲、edge は `label`（選択肢/条件）＋ `condition.flags`。node の `choices[]`（`FlowChoice{scene, options[]}`）は選択肢メニュー（HU-18/19）。**ルート分岐（SMAIN len-8 switch）の選択肢には `options[*].flag`（`S###/軸…=値`）/`target`（分岐先ノード id）/`targetTitle` を付与**（HU-21。[ADR 0005](0005-flow-reconstruction.md)）。
  - **任意挿入シーン（HU-23）**: SMAIN の **len-7 等値テスト**（`if S<slot>==<val>`）でトリガされる条件付き挿入ブロックは、`options[*].inserts`（挿入ブロック先頭ノード id）/`insertsTitle` で表現する。`target`（恒久分岐＝END へ抜ける道筋）と**排他で区別**する：挿入は再生後に合流するため恒久分岐ではない。例外として、len-7 テストのブロック先頭が hub-goto（別ルートへの恒久分岐＝S12/S77 系）なら `target` を用いる（len-8 と同義）。スロットが脚本内で scratch 再利用される（S12/S16）ため、紐付けは書き込みシーンと len-7 テストの**位置認識マッチ**で解決する。詳細は [`smain_flow_guide.md`](../../data_extract/text/_tools/smain_flow_guide.md) §3.8。
- **locale 対応**: スキーマは jp/cn 両対応。ただし Sprint 0/1 は **jp のみ実データ生成**、cn は後続で同パイプラインを流す（ボイス/CG は共通、`beats[].text` のみ差し替え）。
- 生成物の置き場: `data/scenes/<code>.json`（手編集禁止）/ `data/flow.json`（手編集可）/ `data/sprites.json`・`data/backgrounds.json` / `data/manifest.json`。

## 帰結
- 型でパース実装の前提が固定され、ゴールデンテスト（`002_AYAN001A`）で回帰を防げる。
- フロー条件（`_DEF` の S###/軸フラグ）は当面 `description` 自然文で保持し、VN-11 で `condition.flags` に機械復元する。
