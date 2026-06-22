# 1_webアプリ — 催眠4 再構築ビューア

抽出した本編テキスト・CG・シナリオ分岐構造をもとに、ゲームを再構築したブラウザアプリ一式。
**エントリは `linked.html`**（ストーリー再生 ⇄ ルート分岐ノード図 の連動ビューア）。

## ファイル構成

```
1_webアプリ/
├── linked.html          ★エントリ。2画面を重ね、Tabで切替＋双方向同期する親ページ
├── picturebook_v3.html  シネマ字幕リーダー（CG全画面＋下部字幕、タップで進行・音声・差分）
├── route_map.html       n8n風ノードエディタ（全ルート・分岐の相関図）
├── cg_out/              picturebookが参照するCG（PRSデコード済みPNG）
├── extract_gra.py       汎用CG抽出ツール（md_gra系→PNG、出力先=この cg_out/）
├── build_ayan_end1.py   綾菜END1ルート読み物テキスト生成（雛形・他ルートにも流用可）
└── README.md            （本ファイル）
```

## 起動方法

`file://` だと iframe 間連携（`contentWindow`）と画像読込がブロックされるため、**簡易HTTPサーバー必須**。

```bash
cd 1_webアプリ
python3 -m http.server 8765
# ブラウザで http://localhost:8765/linked.html を開く
```

## 各アプリ

### linked.html（連動ビューア｜推奨）
- 起動時は **ストーリー（picturebook）** を表示。
- **Tabキー**（または上部トグル）で **ストーリー ⇄ ノード図** を切替。
- ストーリーが進むと、ノード図側で**今いる個別シーンの子ノードが金色に発光**（所属アークを自動展開）。
- ノード図で子ノードを手動クリック → Tabでストーリーへ戻ると、**その個別シーンへジャンプ**。

### picturebook_v3.html（単体でも動作）
- 表紙タップで開始。画面タップ / Space / → で進行。字幕タップで音声リプレイ。
- CGはA/Bクロスフェード＋Ken Burns、感情に応じたモノクロ→カラー演出。
- 音声は現状ブラウザTTS（zh-CN）のプレースホルダ。

### route_map.html（単体でも動作）
- 共通ルート → ★大分岐(MAIN003A) → 4ルート（姉妹／翼／真琴／翼真琴）→ 各エンドの全体図。
- ドット背景・ベジェ配線・パン/ズーム・ノードドラッグ・クリックで内包シーン表示。
- ノードの「⊞展開」で、そのアークの内訳を**入れ子グループ**（子シーン）として表示。

## 連携アーキテクチャ（同一オリジン・疎結合）

| 役割 | 公開API / 通知 |
|---|---|
| `linked.html`（親） | ルーター。`toggleView()` で表示切替、`onSceneFromPB(code)` / `onNodePick(code)` を受ける |
| `picturebook_v3.html` | 各 `BEATS` に `scene`（個別シーンコード）。`window.gotoScene(code)` / `getScene()` 公開、進行時に親へ `onSceneFromPB` 通知 |
| `route_map.html` | `window.highlightNode(code)`（コードから所属アーク特定→自動展開→子ノード発光＋センタリング）/ `selectNode(id)` 公開、手動選択時に親へ `onNodePick` 通知 |

- **同期キー = 個別シーンコード**（例 `001_PRO001A`）。picturebookのシーンIDと、ノード図 `groups[].kids[].c` が一致。

## デモ範囲・拡張方法

- 現在の同期実装は **3シーン**：`001_PRO001A`（幼少回想・三人）/ `001_PRO001B`（幼少回想・楠木翼）/ `002_AYAN001A`（綾菜・カフェ）。
- CGは `cg_out/` の7枚（EV003_01/02・BG01_01_00・BG02_01_00/02_00・CH01A_01_01_001_01・PRO_TITLE_A）で代用。
- **シーンを増やすには**：`picturebook_v3.html` の `BEATS` に `scene:"<コード>"` のビートを追加し、`route_map.html` の対象アークノードに `groups:[{kids:[{c:"<コード>",l:"…"}]}]` を定義するだけで自動的に同期対象になる。`linked.html` の `SCENE_NAME` に表示名を足すとトーストにも反映。

## 同梱ツール（このフォルダ内で実行）

- **`extract_gra.py`** — 汎用CG抽出。`python3 extract_gra.py [<med> <entry…>]`（既定入力 `../2_元ゲーム/saimin4/md_gra2.med`）。出力は同フォルダの `cg_out/` に入るため、抽出したCGをそのままpicturebookで使える。CG/シーンを増やす際の標準手段。
- **`build_ayan_end1.py`** — 綾菜END1ルートの連貫読み物テキストを生成（入力 `../3_抽出データ/文字/md_scr_text`）。`SCENES`/`KEEP` を差し替えれば他ルートの台本も生成可能で、picturebookの `BEATS` 作成の元ネタになる。

## 関連（このフォルダ外）

- **本編テキスト**：`3_抽出データ/文字/md_scr_text/`（339ファイル）。route_map の全シーンはここが出典。
- **音声**：`3_抽出データ/音声/`（`cv_out` にボイス約7,300本 .ogg）。picturebookのTTSを実ボイスへ差し替える将来素材。命名はシーンコード準拠（例 `ayan_001_pro001A_001.ogg`）。
