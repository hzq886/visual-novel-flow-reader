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
- ~~スコープ外: 多体立ち絵（`0x12` 複数スロット）は単一 sprite へ投影（現行踏襲）。~~ **HU-77 で解消**（下記）。
  ~~改ページ `0x04` は現行同様 line 粒度に集約（beat 境界にしない）。~~ **HU-78 で解消**（下記）。
  se 変種 `0x16` は当面 se 扱い。必要時に別チケット。

## 追補: 多体立ち絵の同時表示（HU-77）

`0x12` は `<mode> <count> <slot u16>*count` で左右複数スロット（実データ 1〜3 体）の立ち絵を同時表示する。
当初は単一 `SpriteRef` へ最後の実ラベルを投影していたが、HU-77 で**全スロットを保持**する形へ拡張した。

- **スキーマ**: `Beat.sprite`（単一）→ `Beat.sprites`（`SpriteRef[]`。占有スロットのみをスロット順で保持）。
- **`sprite` イベント**: `["sprite", slots, reset?]`。`slots[i]` は `null`=変更なし / `"-"`=当該スロットをクリア /
  ラベル=そのスロットへ配置。`buildScene` が **per-slot sticky** で保持（`count` 未満の上位スロットは増分更新で保持）。
- **`mode` の `reset`**: `0x12` の `mode` bit `0x80` 無し（`0x00`）= **establishing shot**＝適用前に**全スロットをクリア**。
  シーン転換で構図を丸ごと差し替える用途（例 `001_PRO001F`/`001_PRO002D` の回想終わり）。これを無視すると過去シーンの
  残留スロットが二重表示される（`extract-scenes.py` が `mode` から `reset` フラグを起こして emit）。
- **配置**: `SpriteLayer` が表示体数で水平均等配置（1=中央 / 2=左右 / 3=左中右）。忠実な x 座標を持つ配置 opcode
  （`0x13`/`0x17`/`0x19` 等）の RE は未実施＝スコープ外。
- 全 286 内容シーンで beat 数不変（`002_AYAN001A` は `sprite`→`sprites` 配列化のみ）。実機で 1/2/3 体を確認済。

## 追補: 改ページ 0x04 のページ粒度（HU-78）

原作は改ページ op `0x04`（テキスト窓クリア・クリック待ち）で地の文を**ページ単位（1〜2 行）**にまとめて
表示する。当初は現行の 1 行送りモデルに合わせ `0x04` を無視していたが、HU-78 で**ページ単位の送り**へ
拡張した（原作テンポの再現。UX 判断の上で採用）。差が出るのは地の文のみ（セリフは 1 発話まるごと表示で既に忠実）。

- **スキーマ**: `NarrationBeat.lines`（`string[]`）→ `pages`（`string[][]`）。各ページ = 同時表示する行の配列
  （1〜2 行）。`LineBeat.lines` は不変（発話）。
- **`page` イベント**: `extract-scenes.py` が `0x04` を `["page"]` として emit。`buildScene` が地の文を
  ページへ集約（`page` で改ページ）。セリフ beat は 1 発話まるごと表示のため `page` を無視。
  セクションカード（`\N`）は独立ページにして題字描画（`Stage.isSectionCard`）を維持。
- **再生モデル**: `store` の beat 内サブインデックス（`line`）を**ページ index** に再解釈。
  `beatSteps(narration) = pages.length`（旧: `lines.length`）。`SubtitleLayer` はページの行を `\n` 連結で
  まとめて中央表示。**beat 数は不変**（ページは beat 内の下位区切り）＝ブックマーク・位置カウンタは安定。
- 効果: 地の文のクリック数を約 21% 削減（2 行ページは 1 クリックで 2 行同時表示）。実機で 2 行ページ・
  ページ送り・セクションカードを確認済。
