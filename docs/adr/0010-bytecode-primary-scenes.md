# ADR 0010: シーン beat 生成の bytecode 一次化

- ステータス: 採択（2026-07-06）
- 関連: [0002 データスキーマ](0002-data-schema.md) / [0006 音声キュー](0006-audio-cues.md) / [0009 アイテムCG](0009-item-cg-overlay.md) / [`smain_flow_guide.md` §3.12](../../data_extract/text/_tools/smain_flow_guide.md)（HU-71〜75）

## コンテキスト

シーン再生データ（beat）は `parseScene` が `extract_text.py` の出力 txt（`md_scr_text_<locale>/*.txt`）を
読んで生成していた。この txt は**シーン脚本 bytecode の文字列表を初出順にダンプしたもの**で、同一
文字列がデデュープされるため、**2 回目以降の参照（再表示・反復）が原理的に欠落**していた（HU-71 で定量化）:

- 背景/EV/暗転の再表示 589 件・245 シーン（例: `001_PRO001A` は原作で回想転換ごとに 5 回暗転するが
  現状は 1 回のみ）
- 立ち絵の「戻り」443 件・110 シーン、本文の反復 387 件、se の反復 389 件

HU-70 で**シーン脚本の文字列参照は 0 始まり**と判明し、全描画/音声 opcode が 100% 純度で確定した
（§3.12）。これにより beat 生成を bytecode 一次ソース化でき、失われた再参照を完全復元できる。

## 決定

**txt パースを廃止し、bytecode 由来のイベント列から beat を生成する**（完全置換）。Scene スキーマ・
再生側（Stage/store/layers）は不変で、影響はビルドパイプライン＋テストに限定。

### パイプライン

```
md_scr.med ──(extract-scenes.py)──▶ data/scene-events/<locale>.json ──(buildScene)──▶ Scene ──(resolveScene)──▶ data/scenes/<locale>/*.json
   (bytecode)          [HU-73]         (committed 中間物・イベント列)      [HU-74]      (labels)      (不変)          (再生成物)
```

- **`extract-scenes.py`（HU-73）**: 本編シーン（数字始まり）ごとにシーン脚本 bytecode を正規化イベント列
  へ写す。opcode → イベント（§3.12）: `0x01`=text / `0x0d`=speaker / `0x14`=voice / `0x15,0x16`=se /
  `0x10`(全 byte1)=bg(EV/黒含む) / `0x12`=sprite(スロット列) / `0x3b,0x3c`=item 開閉 / `0x6a`=off,bgv /
  `0x6c`=flash / `0x2c`=title(idx0)・セクションカード(idx≥1)。flow/flag/timing 命令は beat 非関与で無視。
- **`data/scene-events/<locale>.json`**: committed 生成物（flow.json/items.json と同格）。txt に代わる
  beat 生成の一次ソース。原データ未配置時はスキップ（committed を維持）。`.prettierignore` 対象。
- **`buildScene(events)`（HU-74）**: イベント列 → Scene beats。従来 parseScene の状態機械（narration/
  「」集約・sticky bg/overlay/sprite/item/bgv・HU-63 レイヤ規則）を流用し入力のみ差替。出力 Scene は同一。

### 文字列の言語別復号

note ラベル（`#背景…`/`#EV…`/`#<キャラ>…`）は **jp/cn とも日本語（Shift-JIS）で格納**されるため常に
cp932。本文・話者名・タイトルのみロケール言語（jp=cp932 / cn=gbk）で復号する（`extract_text.py` の
classify と同一規則）。これにより cn の bg/sprite ラベルが jp と一致し、既存 backgrounds/sprites.json で
解決できる（[ADR 0007](0007-cn-locale-i18n.md) の前提を維持）。行頭の全角インデント等は strip して現行
挙動との parity を保つ。

### 話者

`speaker` イベント（bytecode `0x0d`。主人公含む全発話に明示）を**一次ソース**とする。ボイス ID 接頭辞→
話者の学習辞書（HU-67）・未収録主人公（KAZU）フォールバックは `0x0d` 欠落時のみ適用する安全網に降格。

### アイテムCG窓（HU-70 の統合）

アイテム窓の座標・表示区間は `item`/`itemclose` イベント（bytecode `0x3b`/`0x3c`）から直接得る。HU-70 の
`items.json`（本文行数 texts・nextText 照合）は不要になり、`extract-items.py`・`data/items.json`・
`ItemsTable`・`data:items` を廃止（[ADR 0009](0009-item-cg-overlay.md) 追記参照）。ItemRef・Beat.item・
ItemLayer・座標/原寸表示は不変。

## 結果

- txt デデュープで失われていた再参照を復元: `001_PRO001A` の黒一色 beat 0→5 等。jp/cn 全 286 内容シーンで
  beat 減少 0（再参照 beat の加算のみ）。`002_AYAN001A` の scenes JSON はリファクタ前とバイト一致（parity）。
- `data_extract/text/` の txt は**人間可読リファレンス・validate の flow 照合用**として残す（beat 生成には
  不使用）。
- スコープ外: 多体立ち絵（`0x12` 複数スロット）は単一 sprite へ投影（現行踏襲）。se 変種 `0x16` は当面 se 扱い。
  改ページ `0x04` は現行同様 line 粒度に集約（beat 境界にしない）。いずれも必要時に別チケット。
