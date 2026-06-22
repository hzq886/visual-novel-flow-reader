# ADR 0001: 技術スタック

- ステータス: 採択（2026-06-22）

## コンテキスト
催眠4 を Web 再構築する。要件は (a) VN 再生（背景/立ち絵/CG クロスフェード・字幕・ボイス/BGM/SE・テキスト送り・セーブ/バックログ）と (b) ルート分岐フロー図、の2機能同居。Claude Code first のアジャイル開発で高速反復したい。既存は vanilla HTML 3枚のプロトタイプ（`app/prototype/`、実証済みだが手書きハードコード）。

## 決定
- **Vite + TypeScript + React** をアプリ基盤に採用（`app/player/`）。
- **PixiJS**(WebGL) で VN ステージを描画（背景/立ち絵差分合成/クロスフェード/Ken Burns）。
- **React Flow (@xyflow/react)** でルート分岐図（自前 659行の `route_map.html` を置換）。
- **Howler.js** で音声（voice/se/bgm の多重・フェード・ループ）。
- **Zustand** で再生状態、**zod** でデータ契約。
- `app/prototype/` は**参照用に温存**（演出パラメータ・同期APIの仕様源）。ロジックは TS へ再実装。
- 専用VNエンジン（Monogatari/Ren'Py/Naninovel）は不採用（ノード図機能を持たず、独自データのDSL変換制約と演出カスタムの窮屈さが上回るため）。

## 帰結
- React/TS/Vite のエコシステム密度が高く Claude Code の反復が安定。React Flow と Pixi/Howler に分岐図・再生を任せ、自前実装は「シーンデータ解釈とトランジション制御」に集中できる。
- 依存が増え初期セットアップはやや重い。バンドルに PixiJS が乗る（gzip 約150KB）— 将来 code-split を検討。
- React 19 / Node v24 系を採用（`.nvmrc`=24）。
