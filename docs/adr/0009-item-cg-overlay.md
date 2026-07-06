# ADR 0009: アイテムCGのオーバーレイ窓モデルと表示区間抽出

- ステータス: 採択（2026-07-05）。**更新（2026-07-06・HU-74）**: 表示区間の抽出方式を items.json から
  scene-events のイベント（`item`/`itemclose`）へ統合（下記「更新」節）。
- 関連: [0002 データスキーマ](0002-data-schema.md) / [0005 フロー復元](0005-flow-reconstruction.md) / [0010 bytecode 一次化](0010-bytecode-primary-scenes.md) / [`smain_flow_guide.md` §3.12](../../data_extract/text/_tools/smain_flow_guide.md)（HU-70）

## コンテキスト

HU-69 でアイテムCG（`ITEM_*`・400×400）を「原寸・中央」表示に修正したが、周辺は Stage の
黒背景が見えていた（HU-70）。原ゲームの周辺仕様を bytecode RE で確認した結果:

- アイテムCGは背景（`0x10 0x83`）ではなく**専用のオーバーレイ窓命令**で表示される:
  `0x3b 00 <u16 idx> <u16 x> <u16 y> 00`（表示）／`0x3d`（イン/アウト演出）／`0x3c 00`（破棄）。
- 表示区間（0x3b〜0x3c）中、**背景レイヤの変更は 0 件**＝直前の背景/EV が周辺に見えたまま。
- **立ち絵も表示継続**し、13 シーン中 7 シーンでは窓表示中に表情差分も変わる（窓は閉じない）。
- 座標はシーン毎指定（x=180/440/700/800/850、y=120 固定）。x=440 が (1280−400)/2 に一致し
  **左上基準**と確定。立ち絵と重ならない側に配置する運用。jp/cn 完全一致。

従来モデル（HU-63 の「被せCG」）は EV/黒一色には正しいが、ITEM には誤りだった
（beat の `bg` に平坦化 → 下層が失われ周辺黒・立ち絵消失・区間も note 近似で早期クローズ）。

副産物として、シーン脚本の文字列参照が **0 始まり**（SMAIN は 1 始まり）と判明し、
描画/音声系 opcode 台帳が確定した（→ `smain_flow_guide.md` §3.12。0x15=se 再生、0x6c=EFFECT。
[ADR 0006](0006-audio-cues.md) の「0x6c=se」は 1 始まり誤読だが、se をテキスト `[id]` マーカーから
抽出する決定自体は不変）。

## 決定

### スキーマ（types.ts）

- `ItemRef{code, file|null, x, y}` を追加。`Beat.item?: ItemRef`（narration/line とも）。
- `bg`/`sprite` は ITEM 表示中も**下層の値を保持**する（ITEM を `bg` に入れない）。
- `file=null` は未解決を表し `validate` が検出する（既存 `BgRef` と同流儀）。

### 表示区間・座標の抽出（`extract-items.py` → `data/items.json`）

- 窓の破棄（`0x3c`）は文字列表ダンプ（`md_scr_text_*`）に現れないため、bytecode から
  機械抽出する: シーンコード → `{item, x, y, texts, nextText}`。
  - `texts` = 区間内に表示される本文（`0x01` 参照）の行数。全 13 シーンで参照が一意・単調増加、
    jp/cn で行数一致を抽出時に assert（ズレたら生成が fail）。
  - `nextText` = 閉じ直後の本文（locale 別）。`parseScene` が閉じ位置で照合し、不一致なら
    **build を fail-fast** させる（txt 再生成とのズレ検知）。
- `npm run data:items` で再生成（`data:all` に組込。原データ未配置時はスキップ＝committed 維持）。

### parseScene（ITEM の独立 sticky）

- `[id] ITEM_*` マーカーで `items.json` の仕様を引き、`item` sticky を開く（無ければ throw）。
- 開いている間、本文行を `texts` 行消費したら閉じる（beat 粒度でスナップショット）。
- **立ち絵/話者 note では閉じない**（原仕様）。`#背景`/`#EV`/黒一色への変更時は防御的に閉じる
  （原データでは区間内に出現しないことを確認済）。

### エンジン（ItemLayer）

- `CgLayer`（背景）と `SpriteLayer`（立ち絵）の**上**、`FlashLayer`/`SubtitleLayer` の下に
  `ItemLayer` を新設。`beat.item` を論理座標 (x, y) に原寸表示、150ms フェード
  （0x3d の演出パラメータ 0x96=150 に倣う）。
- HU-69 で `CgLayer` に入れた ITEM 特例（原寸・中央・Ken Burns 抑止）は撤去
  （ITEM が `bg` に入らなくなるため）。

## 結果

- アイテム表示が原作構図と一致: 直前の背景/EV＋立ち絵の上に、シーン毎の位置で原寸表示。
- 表示区間も原作一致（note 近似による早期クローズ 7 シーンを解消）。
- `data/items.json` は committed 生成物（手編集禁止）。スキーマ変更のため scenes 再生成が必要。

## 更新（HU-74・[ADR 0010](0010-bytecode-primary-scenes.md)）

beat 生成を bytecode イベント一次化（scene-events）した際、アイテム窓も同じ命令列から取れるため
**イベント（`item`/`itemclose`）へ統合**した。窓の破棄位置が `0x3c`（itemclose イベント）で正確に
得られるため、本 ADR の「本文行数 texts で表示区間を近似・nextText で照合」する仕組みは不要になり:

- `scripts/extract-items.py`・`data/items.json`・`types.ts` の `ItemsTable`・`package.json` の
  `data:items` を**廃止**。
- `buildScene` は `item` イベントで sticky を開き（座標は `0x3b` 由来）、`itemclose` で閉じる。

`ItemRef`・`Beat.item`・`ItemLayer`・座標/原寸表示・150ms フェードは**不変**（本 ADR の描画方針は
そのまま有効）。
