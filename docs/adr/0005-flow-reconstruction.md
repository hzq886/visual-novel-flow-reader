# ADR 0005: ルートフロー復元方式（暫定 = route_map ポート → 一次 = extract-flow）

- ステータス: 採択（2026-06-25）
- 関連: [0002 データスキーマ](0002-data-schema.md) / `prototype/route_map.html`・`prototype/build_ayan_end1.py`

## コンテキスト

催眠4 の分岐（選択肢 / JUMP / フラグ）は原データ `md_scr.med` の `SMAIN` ＋ select オペコードに存在するが、現行 `extract_text.py` はこれを破棄/誤分類するため失われている。アプリのルート図（React Flow）と将来の分岐再生には、機械可読な `data/flow.json`（`FlowNode`/`FlowEdge`、[ADR 0002](0002-data-schema.md)）が要る。

一方、一次抽出（`SMAIN` 生バイトコードの解読）は本プラン最大の不確実性であり、縦串（`002_AYAN001A`）の先行リリースをここで待たせたくない。

## 決定

`flow.json` を **2 段構え**で復元する。

### 1. 暫定（二次ソース）— 実装済（HU-13）

- `scripts/route-map.data.ts` に `prototype/route_map.html` の N（ノード）/ E（エッジ）を逐語ポートする（人手で精査済みのルートグラフ。プロトタイプ本体は改変せず転記）。
- `scripts/build-flow.ts`（`npm run data:flow`）が N/E を `Flow` スキーマへ写像して `data/flow.json` を生成する。
  - `scenes` は実シーンコードのみ採用（`→ …` の結末ラベル・`_START` 等の擬似入口は除外）。`npm run validate` の flow ↔ 原テキスト相互照合を満たす。
  - `build_ayan_end1.py` の SCENES/KEEP は綾菜 END1 の読み順・select 行範囲のクロス参照であり、route_map ノードに内包済みのため構造追加はしない（KEEP の select 範囲はテキストレベル分岐＝一次の出典）。
- **分岐フラグ（`FlowEdge.condition.flags`）は付与しない**。hub 等の分岐条件は当面ノード `description` の自然文で保持する。
- 描画は `src/flow/FlowMap.tsx`（React Flow）。再生中シーンの所有ノードは `findNodeIdByScene` でハイライトする。

### 2. 一次（未実装）— HU-15

- `scripts/extract-flow.py` が `md_scr.med` の `SMAIN` 生 blob ＋ select/jump/flag オペコードを解析し `flow.json` を機械生成する。`_DEF` 軸フラグを `condition.flags` に機械表現する。
- 完成時に暫定生成器を置換する（route_map は照合・ラベル補完の二次に降格）。

### flow.json の編集方針（[ADR 0002](0002-data-schema.md) の「手編集可」を更新）

`flow.json` は **生成物**（`scenes`/`sprites`/`backgrounds` と同様、`data:flow` で再生成される）。暫定期の分岐ラベル・ノード補正は **`route-map.data.ts`** に対して行う（`flow.json` の直接編集は再生成で失われる）。一次移行後は `extract-flow` の出力が真実の源。

## 帰結

- 縦串と同時にルート図を提供でき、再生中シーンの連動ハイライトが成立する（受入 HU-13）。
- フラグ駆動の分岐（実際のルート選択・到達可否）は一次（HU-15）まで保留。暫定 `flow.json` はグラフの可視化と所有者特定に限る。
- 一次抽出が `SMAIN` を解読でき次第、**同じ `Flow` スキーマ・同じ `data/flow.json` 出力先**のまま中身を差し替えられる（描画側 `src/flow` は無改修）。
